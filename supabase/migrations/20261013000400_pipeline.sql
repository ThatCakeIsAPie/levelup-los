-- Recruiting pipeline: leader-defined steps between four fixed milestones,
-- one card per prospect, every move recorded, team goals and targets, and
-- sharing per-person numbers. Client contract: src/data/pipeline/types.ts;
-- the rules mirror src/data/pipeline/rules.ts.
--
--  * Milestones are codes, not rows: contact, first_meeting, first_plan,
--    registered. Nobody renames, removes or reorders them. Steps live in the
--    band of the milestone before them (never after Registered).
--  * Steps, hides and team settings are read by everyone on the owner's
--    sponsor line below them (inheritance) and by their uplines (who can view
--    a downline leader's team). Only the owner writes their own.
--  * Cards and moves follow CRM visibility (the prospect / the owner must be
--    someone you can see). Moves are only written by move_pipeline_card();
--    the card's column changes only through it (or an undo / a step delete).
--  * Undo: you may delete your own latest move of a person within an hour;
--    the card goes back to where it was.
--  * Per-person numbers: yourself and your downline, or anyone who shared
--    with you (stat_shares). Requests (stat_requests) notify the owner;
--    answer_stat_request() approves or declines and notifies the requester.
--    pipeline_person_counts() returns totals only, so sharers' prospects stay
--    private.

-- ---------------------------------------------------------------------------
-- Notifications: two new types
-- ---------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'mention', 'reply', 'announcement_draft', 'announcement_posted', 'report',
  'event_post', 'win', 'checkin_logged', 'reaction', 'stat_request', 'stat_request_answered'
));

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.pipeline_steps (
  id text primary key default gen_random_uuid()::text
    check (id not in ('contact', 'first_meeting', 'first_plan', 'registered')),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  owner_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  band text not null check (band in ('contact', 'first_meeting', 'first_plan')),
  label text not null check (
    length(trim(label)) between 1 and 24
    and lower(trim(label)) not in ('contact made', 'first meeting', 'first plan', 'registered')
  ),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);
create unique index pipeline_steps_label_idx on public.pipeline_steps (owner_id, band, lower(trim(label)));
create index pipeline_steps_workspace_idx on public.pipeline_steps (workspace_id);
comment on table public.pipeline_steps is 'A leader''s step between two milestones; their downline inherits it.';

create table public.pipeline_step_hides (
  person_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  step_id text not null references public.pipeline_steps (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, step_id)
);
create index pipeline_step_hides_step_idx on public.pipeline_step_hides (step_id);
comment on table public.pipeline_step_hides is 'An inherited step hidden by person_id for their own team.';

create table public.pipeline_cards (
  person_id text primary key references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- A milestone code or a pipeline_steps id (a deleted step falls back to its milestone).
  column_id text not null,
  entered_at timestamptz not null default now(),
  next_step text check (next_step is null or length(next_step) <= 60),
  next_step_date date,
  hot boolean not null default false,
  source text check (source is null or length(source) <= 60),
  dropped_at timestamptz,
  updated_at timestamptz not null default now()
);
create index pipeline_cards_workspace_idx on public.pipeline_cards (workspace_id);
comment on table public.pipeline_cards is 'One card per prospect on the board.';

create table public.pipeline_moves (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- Kept after the person is deleted (the activity still happened): no link.
  person_id text not null,
  -- Whose prospect it was (their sponsor at the time).
  owner_id text references public.people (id) on delete set null,
  from_column text,
  to_column text not null,
  milestone text not null check (milestone in ('contact', 'first_meeting', 'first_plan', 'registered')),
  moved_at timestamptz not null default now(),
  moved_by text references public.people (id) on delete set null
);
create index pipeline_moves_person_idx on public.pipeline_moves (person_id, moved_at);
create index pipeline_moves_owner_idx on public.pipeline_moves (owner_id, moved_at);
create index pipeline_moves_workspace_idx on public.pipeline_moves (workspace_id, moved_at);
comment on table public.pipeline_moves is 'Every move on the board; the source of truth for activity and conversions.';

create table public.pipeline_team_settings (
  person_id text primary key default public.current_person_id()
    references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  mg1_goal integer check (mg1_goal is null or mg1_goal between 1 and 9999),
  target_contact_to_meeting integer check (target_contact_to_meeting between 1 and 100),
  target_meeting_to_plan integer check (target_meeting_to_plan between 1 and 100),
  target_plan_to_registered integer check (target_plan_to_registered between 1 and 100),
  updated_at timestamptz not null default now(),
  check ((target_contact_to_meeting is null) = (target_meeting_to_plan is null)
     and (target_meeting_to_plan is null) = (target_plan_to_registered is null))
);
comment on table public.pipeline_team_settings is 'A leader''s first-meeting goal and conversion targets (null: inherit from upline).';

create table public.stat_shares (
  owner_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  viewer_id text not null references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  check (owner_id <> viewer_id)
);
create index stat_shares_viewer_idx on public.stat_shares (viewer_id);
comment on table public.stat_shares is 'owner_id lets viewer_id see their per-person pipeline numbers.';

create table public.stat_requests (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  requester_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  owner_id text not null references public.people (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (requester_id <> owner_id)
);
create unique index stat_requests_pending_idx on public.stat_requests (requester_id, owner_id)
  where status = 'pending';
create index stat_requests_owner_idx on public.stat_requests (owner_id, status);
comment on table public.stat_requests is 'requester_id asks owner_id to see their per-person pipeline numbers.';

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: they read people / moves without recursing RLS)
-- ---------------------------------------------------------------------------

create function public.pipeline_milestone_index(p_milestone text) returns integer
language sql immutable set search_path = ''
as $$
  select case p_milestone
    when 'contact' then 0 when 'first_meeting' then 1
    when 'first_plan' then 2 when 'registered' then 3 end
$$;

-- The sponsor line of a person, root first (depth 0), ending with the person.
-- Signed-in callers only get it for themselves or someone they can see.
create function public.sponsor_chain(p_person_id text)
returns table (person_id text, depth integer, name text)
language sql stable security definer set search_path = ''
as $$
  with recursive up (id, sponsor, d) as (
    select p.id, p.sponsor_id, 0 from public.people p
    where p.id = p_person_id
      and (auth.uid() is null or p_person_id = public.current_person_id()
           or public.can_see_person(p_person_id))
    union all
    select s.id, s.sponsor_id, up.d + 1
    from public.people s join up on s.id = up.sponsor
    where up.d < 100
  )
  select up.id, (max(up.d) over () - up.d)::integer, p.name
  from up join public.people p on p.id = up.id
  order by 2
$$;

-- The caller's own sponsor line (themselves included).
create function public.my_chain_ids() returns setof text
language sql stable security definer set search_path = ''
as $$ select c.person_id from public.sponsor_chain(public.current_person_id()) c $$;

-- Rows that belong to a whole team (steps, hides, goals): readable by the
-- owner's downline (inheritance) and by anyone who can see the owner.
-- Candidates have no pipeline.
create function public.pipeline_team_row_visible(p_workspace_id text, p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_workspace_id = public.current_workspace_id()
     and not public.is_candidate()
     and (p_person_id in (select public.my_chain_ids())
          or public.can_see_person(p_person_id))
$$;

-- May the caller see this person's per-person numbers? Mirror of canSeeStatsOf.
create function public.pipeline_stats_visible(p_owner_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_person_id() is not null
     and not public.is_candidate()
     and (p_owner_id = public.current_person_id()
          or p_owner_id in (select public.visible_person_ids())
          or exists (select 1 from public.stat_shares s
                     where s.owner_id = p_owner_id and s.viewer_id = public.current_person_id()))
$$;

-- Is this the person's latest move (the only one that can be undone)?
create function public.pipeline_move_is_latest(p_move_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.pipeline_moves m
    where m.id = p_move_id
      and not exists (select 1 from public.pipeline_moves l
                      where l.person_id = m.person_id
                        and (l.moved_at, l.id) > (m.moved_at, m.id))
  )
$$;

-- ---------------------------------------------------------------------------
-- Guards and follow-ups
-- ---------------------------------------------------------------------------

-- A step's owner, band and workspace never change.
create function public.pipeline_steps_guard() returns trigger
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
create trigger pipeline_steps_guard before update on public.pipeline_steps
  for each row execute function public.pipeline_steps_guard();

-- Deleting a step: cards in it (anyone's) go back to its milestone.
create function public.pipeline_steps_before_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.pipeline_cards set column_id = old.band, updated_at = now()
   where column_id = old.id;
  return old;
end $$;
create trigger pipeline_steps_before_delete before delete on public.pipeline_steps
  for each row execute function public.pipeline_steps_before_delete();

-- A card's person, column and entry time only change through moves.
create function public.pipeline_cards_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write()
     and (new.person_id is distinct from old.person_id or new.workspace_id is distinct from old.workspace_id
          or new.column_id is distinct from old.column_id or new.entered_at is distinct from old.entered_at) then
    raise exception 'A card moves only through move_pipeline_card()' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger pipeline_cards_guard before update on public.pipeline_cards
  for each row execute function public.pipeline_cards_guard();

-- Undoing a move: the card goes back to where it was (or away, if the move
-- created it).
create function public.pipeline_moves_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.from_column is null then
    delete from public.pipeline_cards c
     where c.person_id = old.person_id and c.column_id = old.to_column;
  else
    update public.pipeline_cards c
       set column_id = old.from_column,
           entered_at = coalesce((select max(m.moved_at) from public.pipeline_moves m
                                  where m.person_id = old.person_id), c.entered_at),
           updated_at = now()
     where c.person_id = old.person_id and c.column_id = old.to_column;
  end if;
  return old;
end $$;
create trigger pipeline_moves_after_delete after delete on public.pipeline_moves
  for each row execute function public.pipeline_moves_after_delete();

create trigger pipeline_team_settings_touch before update on public.pipeline_team_settings
  for each row execute function public.touch_updated_at();

-- A new request notifies the owner; withdrawing it removes that notification.
create function public.stat_requests_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.notify(new.owner_id, 'stat_request', new.requester_id, null, null, new.id, new.created_at);
  return new;
end $$;
create trigger stat_requests_after_insert after insert on public.stat_requests
  for each row execute function public.stat_requests_after_insert();

create function public.stat_requests_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.notifications where type = 'stat_request' and ref_id = old.id;
  return old;
end $$;
create trigger stat_requests_after_delete after delete on public.stat_requests
  for each row execute function public.stat_requests_after_delete();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Move a prospect's card (or create it) and record the move. `p_to` is a
-- milestone code or a step on the prospect's owner's or the caller's sponsor
-- line. Moving into Registered makes the person an apprentice from today
-- (stage history, activity; team chats follow by trigger). Returns
-- {"move": ..., "card": ...}. `p_move_id` lets the client keep its own id.
create function public.move_pipeline_card(
  p_person_id text,
  p_to text,
  p_move_id text default null,
  p_next_step text default null,
  p_next_step_date date default null,
  p_source text default null,
  p_hot boolean default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_ws text := public.current_workspace_id();
  v_p public.people;
  v_card public.pipeline_cards;
  v_had_card boolean;
  v_band text;
  v_move public.pipeline_moves;
begin
  if v_me is null or public.is_candidate() then
    raise exception 'Candidates don''t have a pipeline yet' using errcode = '42501';
  end if;
  select * into v_p from public.people p where p.id = p_person_id for update;
  if not found or v_p.workspace_id is distinct from v_ws or not public.can_see_person(p_person_id) then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  if v_p.biz_class <> 'prospect' then
    raise exception 'Only prospects move on the board' using errcode = '22023';
  end if;

  if p_to in ('contact', 'first_meeting', 'first_plan', 'registered') then
    v_band := p_to;
  else
    select s.band into v_band from public.pipeline_steps s
     where s.id = p_to and s.workspace_id = v_ws
       and (s.owner_id in (select c.person_id from public.sponsor_chain(coalesce(v_p.sponsor_id, v_me)) c)
            or s.owner_id in (select public.my_chain_ids()));
  end if;
  if v_band is null then
    raise exception 'That column isn''t on this board' using errcode = '22023';
  end if;

  select * into v_card from public.pipeline_cards c where c.person_id = p_person_id for update;
  v_had_card := found;
  if v_had_card and v_card.dropped_at is not null then
    raise exception 'That card is off the board' using errcode = '22023';
  end if;
  if v_had_card and v_card.column_id = p_to then
    raise exception 'Already there' using errcode = '22023';
  end if;

  insert into public.pipeline_moves (id, workspace_id, person_id, owner_id, from_column, to_column,
                                     milestone, moved_at, moved_by)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_person_id,
          coalesce(v_p.sponsor_id, v_me), case when v_had_card then v_card.column_id end, p_to,
          v_band, now(), v_me)
  returning * into v_move;

  insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at, next_step,
                                     next_step_date, hot, source, dropped_at, updated_at)
  values (p_person_id, v_ws, p_to, v_move.moved_at, nullif(trim(p_next_step), ''), p_next_step_date,
          coalesce(p_hot, false), nullif(trim(p_source), ''), null, now())
  on conflict (person_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_step = excluded.next_step,
         next_step_date = excluded.next_step_date,
         hot = coalesce(p_hot, public.pipeline_cards.hot),
         source = coalesce(nullif(trim(p_source), ''), public.pipeline_cards.source),
         updated_at = now()
  returning * into v_card;

  if p_to = 'registered' then
    update public.people
       set biz_class = 'apprentice',
           pipeline_stage = 'apprentice',
           business_start_date = public.workspace_today(v_ws),
           stage_history = stage_history || jsonb_build_array(jsonb_build_object(
             'stage', 'apprentice',
             'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     where id = p_person_id;
    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                 related_person_id, kind, summary, meta)
    values (v_ws, coalesce((select p.name from public.people p where p.id = v_me), 'Someone'), v_me,
            'person', p_person_id, p_person_id, 'stage_changed', 'Pipeline → apprentice',
            jsonb_build_object('from', 'prospect', 'to', 'apprentice'));
  end if;

  return jsonb_build_object('move', to_jsonb(v_move), 'card', to_jsonb(v_card));
end $$;

-- Approve (shares the owner's numbers with the requester) or decline a
-- request sent to you; the requester is told either way.
create function public.answer_stat_request(p_request_id text, p_approve boolean)
returns public.stat_requests
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_r public.stat_requests;
begin
  select * into v_r from public.stat_requests r where r.id = p_request_id for update;
  if not found or v_r.owner_id is distinct from v_me then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'This request was already answered' using errcode = '22023';
  end if;
  update public.stat_requests
     set status = case when p_approve then 'approved' else 'declined' end, decided_at = now()
   where id = p_request_id
  returning * into v_r;
  if p_approve then
    insert into public.stat_shares (owner_id, viewer_id, workspace_id)
    values (v_me, v_r.requester_id, v_r.workspace_id)
    on conflict do nothing;
  end if;
  update public.notifications set read_at = now()
   where type = 'stat_request' and ref_id = p_request_id and read_at is null;
  perform public.notify(v_r.requester_id, 'stat_request_answered', v_me, null, null, p_request_id);
  return v_r;
end $$;

-- Milestones reached per owner between two days (the workspace's calendar),
-- for owners whose numbers the caller may see. Totals only: the people
-- behind them stay private. A person reaches a milestone on the first move
-- into its band or a later one (mirror of reachesOf in rules.ts).
create function public.pipeline_person_counts(p_owner_ids text[], p_from date, p_to date)
returns table (owner_id text, contact integer, first_meeting integer, first_plan integer,
               registered integer)
language sql stable security definer set search_path = ''
as $$
  with allowed as (
    select o from unnest(p_owner_ids) o where public.pipeline_stats_visible(o)
  ),
  tz as (
    select coalesce((select w.timezone from public.workspaces w
                     where w.id = public.current_workspace_id()), 'UTC') as zone
  ),
  moves as (
    select m.id, m.person_id, m.owner_id, m.moved_at,
           public.pipeline_milestone_index(m.milestone) as idx
    from public.pipeline_moves m
    where m.workspace_id = public.current_workspace_id()
  ),
  firsts as (
    select distinct on (mv.person_id, k.k) mv.person_id, k.k, mv.owner_id, mv.moved_at
    from moves mv join generate_series(0, 3) as k(k) on mv.idx >= k.k
    order by mv.person_id, k.k, mv.moved_at, mv.id
  )
  select a.o,
         count(*) filter (where f.k = 0)::integer,
         count(*) filter (where f.k = 1)::integer,
         count(*) filter (where f.k = 2)::integer,
         count(*) filter (where f.k = 3)::integer
  from allowed a
  left join firsts f on f.owner_id = a.o
    and (f.moved_at at time zone (select zone from tz))::date between p_from and p_to
  group by a.o
$$;

revoke execute on function public.move_pipeline_card(text, text, text, text, date, text, boolean) from public, anon;
revoke execute on function public.answer_stat_request(text, boolean) from public, anon;
revoke execute on function public.pipeline_person_counts(text[], date, date) from public, anon;
revoke execute on function public.sponsor_chain(text) from public, anon;
grant execute on function public.move_pipeline_card(text, text, text, text, date, text, boolean) to authenticated;
grant execute on function public.answer_stat_request(text, boolean) to authenticated;
grant execute on function public.pipeline_person_counts(text[], date, date) to authenticated;
grant execute on function public.sponsor_chain(text) to authenticated;
revoke execute on function public.pipeline_steps_before_delete() from public, anon, authenticated;
revoke execute on function public.pipeline_moves_after_delete() from public, anon, authenticated;
revoke execute on function public.stat_requests_after_insert() from public, anon, authenticated;
revoke execute on function public.stat_requests_after_delete() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.pipeline_steps enable row level security;
alter table public.pipeline_step_hides enable row level security;
alter table public.pipeline_cards enable row level security;
alter table public.pipeline_moves enable row level security;
alter table public.pipeline_team_settings enable row level security;
alter table public.stat_shares enable row level security;
alter table public.stat_requests enable row level security;

-- steps: the sponsor line reads, the owner writes --------------------------------
create policy "read team steps" on public.pipeline_steps
  for select to authenticated
  using (public.pipeline_team_row_visible(workspace_id, owner_id));
create policy "add your own steps" on public.pipeline_steps
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id())
              and not (select public.is_candidate()));
create policy "edit your own steps" on public.pipeline_steps
  for update to authenticated
  using (owner_id = (select public.current_person_id()))
  with check (owner_id = (select public.current_person_id()));
create policy "delete your own steps" on public.pipeline_steps
  for delete to authenticated
  using (owner_id = (select public.current_person_id()));

-- hides: hide an upline's step for your own team -----------------------------------
create policy "read team hides" on public.pipeline_step_hides
  for select to authenticated
  using (public.pipeline_team_row_visible(workspace_id, person_id));
create policy "hide an inherited step" on public.pipeline_step_hides
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id())
              and not (select public.is_candidate())
              and exists (select 1 from public.pipeline_steps s
                          where s.id = step_id
                            and s.owner_id <> (select public.current_person_id())
                            and s.owner_id in (select public.my_chain_ids())));
create policy "show a step again" on public.pipeline_step_hides
  for delete to authenticated
  using (person_id = (select public.current_person_id()));

-- cards: prospects you can see; created and moved by move_pipeline_card() -------------
-- (Not candidates: a candidate is a prospect on someone's board, and their card
-- carries their sponsor's notes.)
create policy "read cards of visible people" on public.pipeline_cards
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids())
         and not (select public.is_candidate()));
create policy "edit cards of visible people" on public.pipeline_cards
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids())
         and not (select public.is_candidate()))
  with check (workspace_id = (select public.current_workspace_id()));
create policy "remove cards of visible people" on public.pipeline_cards
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids())
         and not (select public.is_candidate()));

-- moves: by owner visibility; written by move_pipeline_card(); undo within the hour ----
create policy "read moves of your team" on public.pipeline_moves
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and owner_id in (select public.visible_person_ids())
         and not (select public.is_candidate()));
create policy "undo your latest move within the hour" on public.pipeline_moves
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and moved_by = (select public.current_person_id())
         and moved_at > now() - interval '1 hour'
         and public.pipeline_move_is_latest(id));

-- team settings: the sponsor line reads, each leader writes their own ---------------
create policy "read team settings" on public.pipeline_team_settings
  for select to authenticated
  using (public.pipeline_team_row_visible(workspace_id, person_id));
create policy "set your team's goals" on public.pipeline_team_settings
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id())
              and not (select public.is_candidate()));
create policy "change your team's goals" on public.pipeline_team_settings
  for update to authenticated
  using (person_id = (select public.current_person_id()))
  with check (person_id = (select public.current_person_id()));
create policy "clear your team's goals" on public.pipeline_team_settings
  for delete to authenticated
  using (person_id = (select public.current_person_id()));

-- shares: yours and the ones with you; you share and revoke your own -----------------
create policy "read your shares" on public.stat_shares
  for select to authenticated
  using (owner_id = (select public.current_person_id())
         or viewer_id = (select public.current_person_id()));
create policy "share your numbers" on public.stat_shares
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id())
              and not (select public.is_candidate())
              and public.person_workspace(viewer_id) = (select public.current_workspace_id())
              and viewer_id not in (select public.my_chain_ids()));
create policy "revoke your shares" on public.stat_shares
  for delete to authenticated
  using (owner_id = (select public.current_person_id()));

-- requests: yours and the ones to you; answered by answer_stat_request() --------------
create policy "read your requests" on public.stat_requests
  for select to authenticated
  using (requester_id = (select public.current_person_id())
         or owner_id = (select public.current_person_id()));
create policy "ask to see someone's numbers" on public.stat_requests
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and requester_id = (select public.current_person_id())
              and status = 'pending' and decided_at is null
              and not (select public.is_candidate())
              and public.person_workspace(owner_id) = (select public.current_workspace_id())
              and not public.pipeline_stats_visible(owner_id));
create policy "withdraw your pending request" on public.stat_requests
  for delete to authenticated
  using (requester_id = (select public.current_person_id()) and status = 'pending');
