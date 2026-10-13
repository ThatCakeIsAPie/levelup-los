-- Your list and the customer pipeline. Client contract:
-- src/data/customerPipeline/types.ts; the rules mirror
-- src/data/customerPipeline/rules.ts and the recruiting pipeline's
-- (20261013000400_pipeline.sql), which this follows table for table.
--
--  * list_entries: names on someone's list (an apprentice's or IBO's). The
--    owner and their uplines read and write them (owner_id in
--    visible_person_ids(), the same as the owner's other data); crosslines
--    never do, candidates have no list. An entry links to the customer its
--    first sale made (customer_id, set only by move_customer_card()) and to
--    the prospect it became on the recruiting pipeline (prospect_id).
--  * The board: two start columns (not_contacted, new_contact), four fixed
--    milestones (contact, first_meeting, first_sale, on_ditto: codes, not
--    rows), leader steps between them (customer_steps, inherited down the
--    sponsor line and hidden per team like pipeline_steps) and two outcomes
--    (not_interested, do_not_contact).
--  * customer_cards: one per entry; an entry without one sits in "Not
--    contacted yet". The column changes only through move_customer_card()
--    (or an undo / a step delete).
--  * customer_moves: every move, written only by move_customer_card(). Moving
--    to First sale (or past it) makes the entry a customer owned by the list's
--    owner (customers stay private to their owner); moving to On Ditto sets
--    the customer's ditto_since. Undo: delete your own latest move of an entry
--    within the hour; the card goes back, and a customer the move made is
--    removed again (with anything logged for them), a Ditto mark cleared.

-- ---------------------------------------------------------------------------
-- People: on Ditto (the monthly product subscription) since a day
-- ---------------------------------------------------------------------------

alter table public.people add column ditto_since date;
comment on column public.people.ditto_since is 'Customers: on Ditto (the monthly subscription) since this day.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.list_entries (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  owner_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  how_known text check (how_known is null or length(how_known) <= 60),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  notes text check (notes is null or length(notes) <= 1000),
  rating text check (rating in ('warm', 'hot')),
  customer_id text references public.people (id) on delete set null,
  prospect_id text references public.people (id) on delete set null,
  added_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index list_entries_owner_idx on public.list_entries (owner_id);
create index list_entries_workspace_idx on public.list_entries (workspace_id);
create index list_entries_customer_idx on public.list_entries (customer_id) where customer_id is not null;
create index list_entries_prospect_idx on public.list_entries (prospect_id) where prospect_id is not null;
comment on table public.list_entries is 'A name on someone''s list; feeds the customer pipeline.';

create table public.customer_steps (
  id text primary key default gen_random_uuid()::text
    check (id not in ('contact', 'first_meeting', 'first_sale', 'on_ditto', 'not_contacted',
                      'new_contact', 'not_interested', 'do_not_contact')),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  owner_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  band text not null check (band in ('contact', 'first_meeting', 'first_sale')),
  label text not null check (
    length(trim(label)) between 1 and 24
    and lower(trim(label)) not in ('contact', 'first meeting', 'first sale', 'on ditto',
                                   'not contacted yet', 'new contacts', 'not interested',
                                   'do not contact')
  ),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);
create unique index customer_steps_label_idx on public.customer_steps (owner_id, band, lower(trim(label)));
create index customer_steps_workspace_idx on public.customer_steps (workspace_id);
comment on table public.customer_steps is 'A leader''s step between two customer milestones; their downline inherits it.';

create table public.customer_step_hides (
  person_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  step_id text not null references public.customer_steps (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, step_id)
);
create index customer_step_hides_step_idx on public.customer_step_hides (step_id);
comment on table public.customer_step_hides is 'An inherited customer step hidden by person_id for their own team.';

create table public.customer_cards (
  entry_id text primary key references public.list_entries (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- A milestone code, a fixed column or a customer_steps id (a deleted step falls back to its milestone).
  column_id text not null,
  entered_at timestamptz not null default now(),
  next_step text check (next_step is null or length(next_step) <= 60),
  next_step_date date,
  updated_at timestamptz not null default now()
);
create index customer_cards_workspace_idx on public.customer_cards (workspace_id);
comment on table public.customer_cards is 'One card per list entry on the customer board.';

create table public.customer_moves (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- Kept after the entry is removed (the activity still happened): no link.
  entry_id text not null,
  -- Whose list it was on.
  owner_id text references public.people (id) on delete set null,
  from_column text,
  to_column text not null,
  band text not null check (band in ('start', 'contact', 'first_meeting', 'first_sale', 'on_ditto', 'out')),
  moved_at timestamptz not null default now(),
  moved_by text references public.people (id) on delete set null,
  -- The customer this move made (First sale); undo removes them. Plain id.
  created_customer_id text,
  -- This move marked the customer on Ditto; undo clears it.
  set_ditto boolean not null default false
);
create index customer_moves_entry_idx on public.customer_moves (entry_id, moved_at);
create index customer_moves_owner_idx on public.customer_moves (owner_id, moved_at);
create index customer_moves_workspace_idx on public.customer_moves (workspace_id, moved_at);
comment on table public.customer_moves is 'Every move on the customer board; the source of truth for customer activity and conversions.';

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: they read people and entries without recursing RLS)
-- ---------------------------------------------------------------------------

-- Who can have a list: apprentices and IBOs.
create function public.can_own_list(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.people p
                 where p.id = p_person_id and p.biz_class in ('apprentice', 'ibo'))
$$;

-- May the caller read and write this person's list? (Themselves or their
-- downline, never a crossline; not candidates.) Mirror of visibleEntries.
create function public.list_owner_visible(p_workspace_id text, p_owner_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_workspace_id = public.current_workspace_id()
     and not public.is_candidate()
     and p_owner_id in (select public.visible_person_ids())
$$;

-- The entry exists and its list is one the caller may see.
create function public.list_entry_visible(p_entry_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.list_entries e
                 where e.id = p_entry_id
                   and public.list_owner_visible(e.workspace_id, e.owner_id))
$$;

-- Is this the entry's latest move (the only one that can be undone)?
create function public.customer_move_is_latest(p_move_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.customer_moves m
    where m.id = p_move_id
      and not exists (select 1 from public.customer_moves l
                      where l.entry_id = m.entry_id
                        and (l.moved_at, l.id) > (m.moved_at, m.id))
  )
$$;

-- ---------------------------------------------------------------------------
-- Guards and follow-ups
-- ---------------------------------------------------------------------------

-- An entry's owner, author and creation time never change, and its customer
-- link is the database's (move_customer_card() sets it; a deleted customer
-- clears it).
create function public.list_entries_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  if public.is_client_write()
     and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
          or new.owner_id is distinct from old.owner_id or new.added_by is distinct from old.added_by
          or new.created_at is distinct from old.created_at
          or new.customer_id is distinct from old.customer_id) then
    raise exception 'A name''s list, author and customer can''t change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger list_entries_guard before update on public.list_entries
  for each row execute function public.list_entries_guard();

-- A step's owner, band and workspace never change.
create function public.customer_steps_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write()
     and (new.owner_id is distinct from old.owner_id or new.band is distinct from old.band
          or new.workspace_id is distinct from old.workspace_id or new.id is distinct from old.id) then
    raise exception 'A step''s owner and milestone band can''t change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger customer_steps_guard before update on public.customer_steps
  for each row execute function public.customer_steps_guard();

-- Deleting a step: cards in it (anyone's) go back to its milestone.
create function public.customer_steps_before_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.customer_cards set column_id = old.band, updated_at = now()
   where column_id = old.id;
  return old;
end $$;
create trigger customer_steps_before_delete before delete on public.customer_steps
  for each row execute function public.customer_steps_before_delete();

-- A card's entry, column and entry time only change through moves.
create function public.customer_cards_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write()
     and (new.entry_id is distinct from old.entry_id or new.workspace_id is distinct from old.workspace_id
          or new.column_id is distinct from old.column_id or new.entered_at is distinct from old.entered_at) then
    raise exception 'A card moves only through move_customer_card()' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger customer_cards_guard before update on public.customer_cards
  for each row execute function public.customer_cards_guard();

-- Undoing a move: the card goes back to where it was (or away, if the move
-- created it); a customer the move made is removed again (their sales go by
-- cascade, the entry's link by "on delete set null"); a Ditto mark the move
-- set is cleared. Someone edited meanwhile into something else is left alone.
create function public.customer_moves_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.from_column is null then
    delete from public.customer_cards c
     where c.entry_id = old.entry_id and c.column_id = old.to_column;
  else
    update public.customer_cards c
       set column_id = old.from_column,
           entered_at = coalesce((select max(m.moved_at) from public.customer_moves m
                                  where m.entry_id = old.entry_id), c.entered_at),
           updated_at = now()
     where c.entry_id = old.entry_id and c.column_id = old.to_column;
  end if;

  if old.created_customer_id is not null then
    delete from public.people p
     where p.id = old.created_customer_id and p.biz_class = 'customer';
  elsif old.set_ditto then
    update public.people p set ditto_since = null
     where p.biz_class = 'customer'
       and p.id = (select e.customer_id from public.list_entries e where e.id = old.entry_id);
  end if;
  return old;
end $$;
create trigger customer_moves_after_delete after delete on public.customer_moves
  for each row execute function public.customer_moves_after_delete();

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------

-- Move a list entry's card (or create it) and record the move. `p_to` is a
-- milestone, a fixed column, or a step on the list owner's or the caller's
-- sponsor line. Reaching First sale (or past it) makes the entry a customer
-- of the list's owner (with `p_customer_id` when the app already shows one);
-- reaching On Ditto marks that customer. Returns {"move": ..., "card": ...}.
create function public.move_customer_card(
  p_entry_id text,
  p_to text,
  p_move_id text default null,
  p_customer_id text default null,
  p_next_step text default null,
  p_next_step_date date default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_ws text := public.current_workspace_id();
  v_e public.list_entries;
  v_card public.customer_cards;
  v_had_card boolean;
  v_band text;
  v_customer text;
  v_created text;
  v_ditto boolean := false;
  v_move public.customer_moves;
begin
  if v_me is null or public.is_candidate() then
    raise exception 'Candidates don''t have a customer pipeline yet' using errcode = '42501';
  end if;
  select * into v_e from public.list_entries e where e.id = p_entry_id for update;
  if not found or not public.list_owner_visible(v_e.workspace_id, v_e.owner_id) then
    raise exception 'Name not found' using errcode = 'P0002';
  end if;

  v_band := case
    when p_to in ('contact', 'first_meeting', 'first_sale', 'on_ditto') then p_to
    when p_to in ('not_contacted', 'new_contact') then 'start'
    when p_to in ('not_interested', 'do_not_contact') then 'out'
  end;
  if v_band is null then
    select s.band into v_band from public.customer_steps s
     where s.id = p_to and s.workspace_id = v_ws
       and (s.owner_id in (select c.person_id from public.sponsor_chain(v_e.owner_id) c)
            or s.owner_id in (select public.my_chain_ids()));
  end if;
  if v_band is null then
    raise exception 'That column isn''t on this board' using errcode = '22023';
  end if;

  select * into v_card from public.customer_cards c where c.entry_id = p_entry_id for update;
  v_had_card := found;
  if coalesce(v_card.column_id, 'not_contacted') = p_to then
    raise exception 'Already there' using errcode = '22023';
  end if;

  -- First sale: the name becomes a customer of the list's owner.
  v_customer := v_e.customer_id;
  if v_band in ('first_sale', 'on_ditto') and v_customer is null then
    v_created := coalesce(nullif(trim(p_customer_id), ''), gen_random_uuid()::text);
    insert into public.people (id, workspace_id, name, phone, email, biz_class, owner_id,
                               sponsor_id, joined_date, notes)
    values (v_created, v_ws, v_e.name, v_e.phone, v_e.email, 'customer', v_e.owner_id, null,
            public.workspace_today(v_ws),
            case when v_e.how_known is not null then 'From your list: ' || v_e.how_known end);
    update public.list_entries set customer_id = v_created where id = v_e.id;
    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                 related_person_id, kind, summary)
    values (v_ws, coalesce((select p.name from public.people p where p.id = v_me), 'Someone'), v_me,
            'person', v_created, v_created, 'created', format('Added %s (Customer)', v_e.name));
    v_customer := v_created;
  end if;

  -- On Ditto: a subscription customer from today.
  if v_band = 'on_ditto' then
    update public.people p set ditto_since = public.workspace_today(v_ws)
     where p.id = v_customer and p.biz_class = 'customer' and p.ditto_since is null;
    v_ditto := found;
  end if;

  insert into public.customer_moves (id, workspace_id, entry_id, owner_id, from_column, to_column,
                                     band, moved_at, moved_by, created_customer_id, set_ditto)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_entry_id,
          v_e.owner_id, case when v_had_card then v_card.column_id end, p_to, v_band, now(), v_me,
          v_created, v_ditto)
  returning * into v_move;

  insert into public.customer_cards (entry_id, workspace_id, column_id, entered_at, next_step,
                                     next_step_date, updated_at)
  values (p_entry_id, v_ws, p_to, v_move.moved_at, nullif(trim(p_next_step), ''), p_next_step_date, now())
  on conflict (entry_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_step = excluded.next_step,
         next_step_date = excluded.next_step_date,
         updated_at = now()
  returning * into v_card;

  return jsonb_build_object('move', to_jsonb(v_move), 'card', to_jsonb(v_card));
end $$;

revoke execute on function public.move_customer_card(text, text, text, text, text, date) from public, anon;
grant execute on function public.move_customer_card(text, text, text, text, text, date) to authenticated;
revoke execute on function public.customer_steps_before_delete() from public, anon, authenticated;
revoke execute on function public.customer_moves_after_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.list_entries enable row level security;
alter table public.customer_steps enable row level security;
alter table public.customer_step_hides enable row level security;
alter table public.customer_cards enable row level security;
alter table public.customer_moves enable row level security;

-- list entries: the owner and their uplines ------------------------------------
create policy "read lists of your team" on public.list_entries
  for select to authenticated
  using (public.list_owner_visible(workspace_id, owner_id));
create policy "add to lists of your team" on public.list_entries
  for insert to authenticated
  with check (public.list_owner_visible(workspace_id, owner_id)
              and public.can_own_list(owner_id)
              and added_by = (select public.current_person_id())
              and customer_id is null
              and (prospect_id is null or prospect_id in (select public.visible_person_ids())));
create policy "edit lists of your team" on public.list_entries
  for update to authenticated
  using (public.list_owner_visible(workspace_id, owner_id))
  with check (public.list_owner_visible(workspace_id, owner_id)
              and (prospect_id is null or prospect_id in (select public.visible_person_ids())));
create policy "remove names from lists of your team" on public.list_entries
  for delete to authenticated
  using (public.list_owner_visible(workspace_id, owner_id));

-- steps: the sponsor line reads, the owner writes --------------------------------
create policy "read team customer steps" on public.customer_steps
  for select to authenticated
  using (public.pipeline_team_row_visible(workspace_id, owner_id));
create policy "add your own customer steps" on public.customer_steps
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id())
              and not (select public.is_candidate()));
create policy "edit your own customer steps" on public.customer_steps
  for update to authenticated
  using (owner_id = (select public.current_person_id()))
  with check (owner_id = (select public.current_person_id()));
create policy "delete your own customer steps" on public.customer_steps
  for delete to authenticated
  using (owner_id = (select public.current_person_id()));

-- hides: hide an upline's step for your own team -----------------------------------
create policy "read team customer step hides" on public.customer_step_hides
  for select to authenticated
  using (public.pipeline_team_row_visible(workspace_id, person_id));
create policy "hide an inherited customer step" on public.customer_step_hides
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id())
              and not (select public.is_candidate())
              and exists (select 1 from public.customer_steps s
                          where s.id = step_id
                            and s.owner_id <> (select public.current_person_id())
                            and s.owner_id in (select public.my_chain_ids())));
create policy "show a customer step again" on public.customer_step_hides
  for delete to authenticated
  using (person_id = (select public.current_person_id()));

-- cards: of entries you can see; moved by move_customer_card() --------------------
create policy "read customer cards of your team" on public.customer_cards
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and public.list_entry_visible(entry_id));
-- A name still on the list gets a card (to hold a next step) in "Not contacted yet".
create policy "add a card to a name on the list" on public.customer_cards
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and public.list_entry_visible(entry_id)
              and column_id = 'not_contacted');
create policy "edit customer cards of your team" on public.customer_cards
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and public.list_entry_visible(entry_id))
  with check (workspace_id = (select public.current_workspace_id()));
create policy "remove customer cards of your team" on public.customer_cards
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and public.list_entry_visible(entry_id));

-- moves: by owner visibility; written by move_customer_card(); undo within the hour --
create policy "read customer moves of your team" on public.customer_moves
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and owner_id in (select public.visible_person_ids())
         and not (select public.is_candidate()));
create policy "undo your latest customer move within the hour" on public.customer_moves
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and moved_by = (select public.current_person_id())
         and moved_at > now() - interval '1 hour'
         and public.customer_move_is_latest(id));
