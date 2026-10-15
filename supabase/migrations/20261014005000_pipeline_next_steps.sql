-- Booked next steps on both boards (client: src/data/pipeline/booking.ts).
--
-- The free-text "next step" on a card ("MG1", "Open the door") becomes a
-- booking: the column the card moves into next (`next_column`, a column after
-- the card's current one on its owner's board, never "Not contacted yet" or
-- an outcome), a day (`next_step_date`) and an optional time
-- (`next_step_time`). The card also gets a free-text `note`.
--
--  * Existing text that names a column the card can still book (its label,
--    the team name of a milestone like "MG1", or a common name like "Info"
--    for First plan; legacy_next_column()) is booked, keeping its day. Any
--    other text moves to the note as it was, and its day goes (nothing is
--    booked). Then `next_step` is dropped.
--  * move_pipeline_card() / move_customer_card() take `p_next_column`,
--    `p_next_step_date`, `p_next_step_time` (a booking made with the move).
--    Without one the card keeps its booking unless it moves into the booked
--    column or past it on the owner's board (the outcomes count as past);
--    moving backwards keeps it. The booking before the move is kept on the
--    move (`booking_before`), so undoing the move (deleting it) restores it.
--  * Cancelling a booked step with a reason is recorded in
--    `pipeline_step_cancellations` (both boards, for stats such as no-show
--    rates). Same readers and writers as the card; you remove your own
--    within the hour (undo). Each one writes a "MG1 cancelled · No-show"
--    activity entry about the person, removed again with the record.
-- RLS on the cards is unchanged (the same people edit the booking and note).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.pipeline_cards
  add column next_column text,
  add column next_step_time time,
  add column note text check (note is null or length(note) <= 500);
alter table public.customer_cards
  add column next_column text,
  add column next_step_time time,
  add column note text check (note is null or length(note) <= 500);
comment on column public.pipeline_cards.next_column is
  'The booked next step: a column on the owner''s board the card moves into next (a step that is gone shows as removed).';
comment on column public.customer_cards.next_column is
  'The booked next step: a column on the list owner''s board the card moves into next.';

-- The booking on the card before the move (restored by undo). Null on moves
-- recorded before bookings existed.
alter table public.pipeline_moves add column booking_before jsonb;
alter table public.customer_moves add column booking_before jsonb;

-- ---------------------------------------------------------------------------
-- A board's columns, in order (mirror of columnsFor in src/data/pipeline/rules.ts)
-- ---------------------------------------------------------------------------

create function public.board_columns(p_board text, p_owner text)
returns table (id text, band text, kind text, label text, ord integer)
language sql stable security definer set search_path = ''
as $$
  with chain as (
    select c.person_id, c.depth from public.sponsor_chain(p_owner) c
  ),
  bands (band, bord) as (
    select * from (values ('start', 0), ('contact', 1), ('first_meeting', 2),
                          ('first_plan', 3), ('first_sale', 3), ('registered', 4),
                          ('on_ditto', 4), ('out', 5)) b (band, bord)
  ),
  fixed (id, band, kind, label, sub) as (
    select * from (values
      ('not_contacted', 'start', 'fixed', 'Not contacted yet', 0),
      ('not_interested', 'out', 'fixed', 'Not interested', 0),
      ('do_not_contact', 'out', 'fixed', 'Do not contact', 1)) f (id, band, kind, label, sub)
  ),
  milestones (id, band, kind, label, sub) as (
    select m.id, m.id, 'milestone', m.label, 0 from (values
      ('recruiting', 'contact', 'Contact made'),
      ('recruiting', 'first_meeting', 'First meeting (MG1)'),
      ('recruiting', 'first_plan', 'First plan (Info 1)'),
      ('recruiting', 'registered', 'Registered'),
      ('customer', 'contact', 'Contact'),
      ('customer', 'first_meeting', 'First meeting'),
      ('customer', 'first_sale', 'First sale'),
      ('customer', 'on_ditto', 'On Ditto')) m (board, id, label)
    where m.board = p_board
  ),
  steps (id, band, label, depth, pos, created) as (
    select s.id, s.band, s.label, ch.depth, s.position, s.created_at
      from public.pipeline_steps s join chain ch on ch.person_id = s.owner_id
     where p_board = 'recruiting'
       and not exists (select 1 from public.pipeline_step_hides h
                        join chain c2 on c2.person_id = h.person_id where h.step_id = s.id)
    union all
    select s.id, s.band, s.label, ch.depth, s.position, s.created_at
      from public.customer_steps s join chain ch on ch.person_id = s.owner_id
     where p_board = 'customer'
       and not exists (select 1 from public.customer_step_hides h
                        join chain c2 on c2.person_id = h.person_id where h.step_id = s.id)
  ),
  cols (id, band, kind, label, sub, depth, pos, created) as (
    select f.id, f.band, f.kind, f.label, f.sub, 0, 0, null::timestamptz from fixed f
    union all
    select m.id, m.band, m.kind, m.label, 0, 0, 0, null from milestones m
    union all
    select s.id, s.band, 'step', s.label, 1, s.depth, s.pos, s.created from steps s
  )
  select c.id, c.band, c.kind, c.label,
         (row_number() over (order by b.bord, c.sub, c.depth, c.pos, c.created, c.id))::integer
    from cols c join bands b on b.band = c.band
$$;
comment on function public.board_columns(text, text) is
  'The columns of p_owner''s board (recruiting or customer) in board order: fixed columns, milestones, and the steps of their sponsor line minus hidden ones.';

-- Where a column sits on the owner's board (a step it doesn't show counts as
-- its band's milestone); null when unknown.
create function public.board_column_ord(p_board text, p_owner text, p_column text)
returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select c.ord from public.board_columns(p_board, p_owner) c where c.id = p_column),
    (select c.ord from public.board_columns(p_board, p_owner) c
      where c.id = (case p_board
                      when 'recruiting' then (select s.band from public.pipeline_steps s where s.id = p_column)
                      else (select s.band from public.customer_steps s where s.id = p_column)
                    end)))
$$;

-- The booking after a move to p_to (mirror of bookingAfterMove): cleared when
-- the card moves into the booked column or past it, kept otherwise (also
-- when the booked column is no longer on the board).
create function public.booking_kept(p_board text, p_owner text, p_booked text, p_to text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_booked is null or p_booked = p_to then false
    when (select c.ord from public.board_columns(p_board, p_owner) c where c.id = p_booked) is null then true
    else coalesce(public.board_column_ord(p_board, p_owner, p_to), 0)
         < (select c.ord from public.board_columns(p_board, p_owner) c where c.id = p_booked)
  end
$$;

-- ---------------------------------------------------------------------------
-- Old free text → a booked column (mirror of legacyNextColumn)
-- ---------------------------------------------------------------------------

create function public.normalize_step_text(p_text text) returns text
language sql immutable set search_path = ''
as $$
  select trim(regexp_replace(regexp_replace(lower(trim(coalesce(p_text, ''))), '\s+', ' ', 'g'),
                             '[.!?:;,]+$', ''))
$$;

create function public.legacy_next_column(p_board text, p_owner text, p_current text, p_text text)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_t text := public.normalize_step_text(p_text);
  v_cur integer;
  v_id text;
begin
  if v_t = '' then
    return null;
  end if;
  v_cur := coalesce(public.board_column_ord(p_board, p_owner, p_current), 0);

  -- A column's label, or a milestone's team name ("First meeting (MG1)" -> "mg1").
  select c.id into v_id
    from public.board_columns(p_board, p_owner) c
   where c.ord > v_cur and c.band not in ('start', 'out')
     and (public.normalize_step_text(c.label) = v_t
          or (c.kind = 'milestone'
              and public.normalize_step_text(substring(c.label from '\(([^)]+)\)\s*$')) = v_t))
   order by c.ord
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  -- Common names for milestones.
  v_id := case p_board
    when 'recruiting' then case
      when v_t in ('contact', 'contact made') then 'contact'
      when v_t in ('first meeting', 'mg1', 'mg 1', '1st meeting', 'meeting 1') then 'first_meeting'
      when v_t in ('first plan', 'info', 'info 1', 'info1', 'show the plan', 'show plan', 'plan') then 'first_plan'
      when v_t in ('registered', 'register', 'registration', 'sign up') then 'registered'
    end
    else case
      when v_t in ('contact') then 'contact'
      when v_t in ('first meeting', 'mg1', 'mg 1', '1st meeting') then 'first_meeting'
      when v_t in ('first sale', 'sale') then 'first_sale'
      when v_t in ('on ditto', 'ditto', 'offer ditto') then 'on_ditto'
    end
  end;
  if v_id is not null and exists (select 1 from public.board_columns(p_board, p_owner) c
                                   where c.id = v_id and c.ord > v_cur) then
    return v_id;
  end if;
  return null;
end $$;

-- Convert the existing cards.
update public.pipeline_cards c
   set next_column = public.legacy_next_column('recruiting', coalesce(p.sponsor_id, p.id),
                                               c.column_id, c.next_step)
  from public.people p
 where p.id = c.person_id and nullif(trim(c.next_step), '') is not null;
update public.pipeline_cards
   set note = left(trim(next_step), 500), next_step_date = null
 where next_column is null and nullif(trim(next_step), '') is not null;
update public.pipeline_cards set next_step_date = null where next_column is null;

update public.customer_cards c
   set next_column = public.legacy_next_column('customer', e.owner_id, c.column_id, c.next_step)
  from public.list_entries e
 where e.id = c.entry_id and nullif(trim(c.next_step), '') is not null;
update public.customer_cards
   set note = left(trim(next_step), 500), next_step_date = null
 where next_column is null and nullif(trim(next_step), '') is not null;
update public.customer_cards set next_step_date = null where next_column is null;

alter table public.pipeline_cards drop column next_step;
alter table public.customer_cards drop column next_step;

-- A day and time only belong to a booked column; a time needs a day.
alter table public.pipeline_cards add constraint pipeline_cards_booking_check check (
  (next_column is not null or (next_step_date is null and next_step_time is null))
  and (next_step_time is null or next_step_date is not null));
alter table public.customer_cards add constraint customer_cards_booking_check check (
  (next_column is not null or (next_step_date is null and next_step_time is null))
  and (next_step_time is null or next_step_date is not null));

-- ---------------------------------------------------------------------------
-- Moves keep or clear the booking; undo restores it
-- ---------------------------------------------------------------------------

drop function public.move_pipeline_card(text, text, text, text, date, text, boolean);

-- Move a prospect's card (or create it) and record the move. As in
-- 20261014002500_pipeline_fixed_columns.sql, plus the booking: `p_next_column`
-- (with a day and time) books the next step with the move; without it the
-- card keeps its booking unless it moves into the booked column or past it.
create function public.move_pipeline_card(
  p_person_id text,
  p_to text,
  p_move_id text default null,
  p_next_column text default null,
  p_next_step_date date default null,
  p_next_step_time time default null,
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
  v_owner text;
  v_next text;
  v_date date;
  v_time time;
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
  v_owner := coalesce(v_p.sponsor_id, v_me);

  v_band := case
    when p_to in ('contact', 'first_meeting', 'first_plan', 'registered') then p_to
    when p_to = 'not_contacted' then 'start'
    when p_to in ('not_interested', 'do_not_contact') then 'out'
  end;
  if v_band is null then
    select s.band into v_band from public.pipeline_steps s
     where s.id = p_to and s.workspace_id = v_ws
       and (s.owner_id in (select c.person_id from public.sponsor_chain(v_owner) c)
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

  -- The booking after the move.
  if nullif(trim(p_next_column), '') is not null and p_next_column <> p_to then
    v_next := p_next_column;
    v_date := p_next_step_date;
    v_time := case when p_next_step_date is not null then p_next_step_time end;
  elsif v_had_card and public.booking_kept('recruiting', v_owner, v_card.next_column, p_to) then
    v_next := v_card.next_column;
    v_date := v_card.next_step_date;
    v_time := v_card.next_step_time;
  end if;

  insert into public.pipeline_moves (id, workspace_id, person_id, owner_id, from_column, to_column,
                                     milestone, moved_at, moved_by, booking_before)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_person_id,
          v_owner, case when v_had_card then v_card.column_id end, p_to,
          v_band, now(), v_me,
          jsonb_build_object('next_column', v_card.next_column,
                             'next_step_date', v_card.next_step_date,
                             'next_step_time', v_card.next_step_time))
  returning * into v_move;

  insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at, next_column,
                                     next_step_date, next_step_time, hot, source, dropped_at, updated_at)
  values (p_person_id, v_ws, p_to, v_move.moved_at, v_next, v_date, v_time,
          coalesce(p_hot, false), nullif(trim(p_source), ''), null, now())
  on conflict (person_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_column = excluded.next_column,
         next_step_date = excluded.next_step_date,
         next_step_time = excluded.next_step_time,
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

drop function public.move_customer_card(text, text, text, text, text, date);

-- Move a list entry's card (or create it) and record the move. As in
-- 20261014002000_customer_new_contacts_into_contact.sql, plus the booking
-- (as move_pipeline_card()).
create function public.move_customer_card(
  p_entry_id text,
  p_to text,
  p_move_id text default null,
  p_customer_id text default null,
  p_next_column text default null,
  p_next_step_date date default null,
  p_next_step_time time default null
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
  v_next text;
  v_date date;
  v_time time;
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
    when p_to = 'not_contacted' then 'start'
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

  -- The booking after the move.
  if nullif(trim(p_next_column), '') is not null and p_next_column <> p_to then
    v_next := p_next_column;
    v_date := p_next_step_date;
    v_time := case when p_next_step_date is not null then p_next_step_time end;
  elsif v_had_card and public.booking_kept('customer', v_e.owner_id, v_card.next_column, p_to) then
    v_next := v_card.next_column;
    v_date := v_card.next_step_date;
    v_time := v_card.next_step_time;
  end if;

  insert into public.customer_moves (id, workspace_id, entry_id, owner_id, from_column, to_column,
                                     band, moved_at, moved_by, created_customer_id, set_ditto,
                                     booking_before)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_entry_id,
          v_e.owner_id, case when v_had_card then v_card.column_id end, p_to, v_band, now(), v_me,
          v_created, v_ditto,
          jsonb_build_object('next_column', v_card.next_column,
                             'next_step_date', v_card.next_step_date,
                             'next_step_time', v_card.next_step_time))
  returning * into v_move;

  insert into public.customer_cards (entry_id, workspace_id, column_id, entered_at, next_column,
                                     next_step_date, next_step_time, updated_at)
  values (p_entry_id, v_ws, p_to, v_move.moved_at, v_next, v_date, v_time, now())
  on conflict (entry_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_column = excluded.next_column,
         next_step_date = excluded.next_step_date,
         next_step_time = excluded.next_step_time,
         updated_at = now()
  returning * into v_card;

  return jsonb_build_object('move', to_jsonb(v_move), 'card', to_jsonb(v_card));
end $$;

grant execute on function public.move_pipeline_card(text, text, text, text, date, time, text, boolean) to authenticated;
grant execute on function public.move_customer_card(text, text, text, text, text, date, time) to authenticated;
revoke execute on function public.move_pipeline_card(text, text, text, text, date, time, text, boolean) from public, anon;
revoke execute on function public.move_customer_card(text, text, text, text, text, date, time) from public, anon;

-- Undoing a move: as in 20261013000500_pipeline_undo_registration.sql, and the
-- booking the card had before the move comes back.
create or replace function public.pipeline_moves_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor text := public.current_person_id();
begin
  if old.from_column is null then
    delete from public.pipeline_cards c
     where c.person_id = old.person_id and c.column_id = old.to_column;
  else
    update public.pipeline_cards c
       set column_id = old.from_column,
           entered_at = coalesce((select max(m.moved_at) from public.pipeline_moves m
                                  where m.person_id = old.person_id), c.entered_at),
           next_column = case when old.booking_before is null then c.next_column
                              else old.booking_before ->> 'next_column' end,
           next_step_date = case when old.booking_before is null then c.next_step_date
                                 else (old.booking_before ->> 'next_step_date')::date end,
           next_step_time = case when old.booking_before is null then c.next_step_time
                                 else (old.booking_before ->> 'next_step_time')::time end,
           updated_at = now()
     where c.person_id = old.person_id and c.column_id = old.to_column;
  end if;

  if old.to_column = 'registered' then
    update public.people p
       set biz_class = 'prospect',
           pipeline_stage = 'prospect',
           business_start_date = null,
           stage_history = coalesce(p.stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'stage', 'prospect',
             'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     where p.id = old.person_id and p.biz_class = 'apprentice';
    if found then
      insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                   related_person_id, kind, summary, meta)
      values (old.workspace_id,
              coalesce((select p.name from public.people p where p.id = v_actor), 'Someone'), v_actor,
              'person', old.person_id, old.person_id, 'stage_changed', 'Pipeline → prospect',
              jsonb_build_object('from', 'apprentice', 'to', 'prospect'));
    end if;
  end if;
  return old;
end $$;

-- As in 20261014000500_customer_pipeline.sql, and the booking comes back.
create or replace function public.customer_moves_after_delete() returns trigger
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
           next_column = case when old.booking_before is null then c.next_column
                              else old.booking_before ->> 'next_column' end,
           next_step_date = case when old.booking_before is null then c.next_step_date
                                 else (old.booking_before ->> 'next_step_date')::date end,
           next_step_time = case when old.booking_before is null then c.next_step_time
                                 else (old.booking_before ->> 'next_step_time')::time end,
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

-- ---------------------------------------------------------------------------
-- Cancelled next steps
-- ---------------------------------------------------------------------------

create table public.pipeline_step_cancellations (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  board text not null check (board in ('recruiting', 'customer')),
  -- The prospect (recruiting) or list entry (customer board). Kept after the
  -- card goes (the stats still count it): no link.
  card_id text not null,
  -- Whose card it was (the prospect's sponsor, the list's owner).
  owner_id text references public.people (id) on delete set null,
  column_id text not null,
  booked_date date,
  booked_time time,
  reason text not null check (reason in ('they_cancelled', 'no_show', 'unreachable',
                                         'not_interested', 'other')),
  reason_text text check (reason_text is null or length(reason_text) <= 200),
  cancelled_at timestamptz not null default now(),
  cancelled_by text default public.current_person_id() references public.people (id) on delete set null,
  constraint pipeline_step_cancellations_other_check
    check (reason <> 'other' or length(trim(coalesce(reason_text, ''))) > 0)
);
create index pipeline_step_cancellations_owner_idx
  on public.pipeline_step_cancellations (owner_id, cancelled_at);
create index pipeline_step_cancellations_card_idx
  on public.pipeline_step_cancellations (board, card_id);
comment on table public.pipeline_step_cancellations is
  'Booked next steps that were cancelled, with the reason (stats such as no-show rates).';

-- The card's owner as the database has it.
create function public.step_card_owner(p_board text, p_card_id text) returns text
language sql stable security definer set search_path = ''
as $$
  select case p_board
    when 'recruiting' then (select coalesce(p.sponsor_id, p.id) from public.people p where p.id = p_card_id)
    else (select e.owner_id from public.list_entries e where e.id = p_card_id)
  end
$$;

-- May the caller see / edit this card? (The cards' own policies.)
create function public.step_card_visible(p_board text, p_card_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not public.is_candidate()
     and case p_board
           when 'recruiting' then p_card_id in (select public.visible_person_ids())
           else public.list_entry_visible(p_card_id)
         end
$$;

-- The activity entry about the person ("MG1 cancelled · No-show"), with the
-- id the app shows (stepcancel-<id>); removed with the record.
create function public.pipeline_step_cancellations_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_person text;
  v_label text;
  v_why text;
begin
  v_person := case new.board
    when 'recruiting' then new.card_id
    else (select coalesce(e.customer_id, e.prospect_id) from public.list_entries e where e.id = new.card_id)
  end;
  if v_person is null then
    return new;
  end if;
  -- The short name the app shows (bookingLabel): "First meeting (MG1)" -> "MG1".
  select coalesce(case when c.kind = 'milestone' then substring(c.label from '\(([^)]+)\)\s*$') end,
                  c.label) into v_label
    from public.board_columns(new.board, coalesce(new.owner_id, '')) c
   where c.id = new.column_id;
  if v_label is null then
    v_label := coalesce(
      (select s.label from public.pipeline_steps s where new.board = 'recruiting' and s.id = new.column_id),
      (select s.label from public.customer_steps s where new.board = 'customer' and s.id = new.column_id),
      'Next step');
  end if;
  v_why := case new.reason
    when 'they_cancelled' then 'They cancelled'
    when 'no_show' then 'No-show'
    when 'unreachable' then 'Couldn''t reach them'
    when 'not_interested' then 'Not interested anymore'
    else coalesce(nullif(trim(new.reason_text), ''), 'Other')
  end;
  insert into public.activity (id, workspace_id, "timestamp", actor_name, actor_id, entity_type,
                               entity_id, related_person_id, kind, summary, meta)
  values ('stepcancel-' || new.id, new.workspace_id, new.cancelled_at,
          coalesce((select p.name from public.people p where p.id = new.cancelled_by), 'Someone'),
          new.cancelled_by, 'person', v_person, v_person, 'note',
          v_label || ' cancelled · ' || v_why,
          jsonb_build_object('cancellationId', new.id, 'board', new.board, 'reason', new.reason))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger pipeline_step_cancellations_after_insert
  after insert on public.pipeline_step_cancellations
  for each row execute function public.pipeline_step_cancellations_after_insert();

create function public.pipeline_step_cancellations_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.activity a where a.id = 'stepcancel-' || old.id;
  return old;
end $$;
create trigger pipeline_step_cancellations_after_delete
  after delete on public.pipeline_step_cancellations
  for each row execute function public.pipeline_step_cancellations_after_delete();

alter table public.pipeline_step_cancellations enable row level security;

-- Read: whoever reads the card, or the moves of its owner (so the numbers
-- outlive the card). Candidates have no pipeline.
create policy "read cancellations of your team" on public.pipeline_step_cancellations
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and not (select public.is_candidate())
         and (public.step_card_visible(board, card_id)
              or owner_id in (select public.visible_person_ids())));
-- Write: whoever edits the card, as themselves, naming the card's real owner.
create policy "cancel a booked step on a card you edit" on public.pipeline_step_cancellations
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and cancelled_by = (select public.current_person_id())
              and public.step_card_visible(board, card_id)
              and owner_id = public.step_card_owner(board, card_id));
-- Undo: your own, within the hour. Nobody edits one.
create policy "undo your cancellation within the hour" on public.pipeline_step_cancellations
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and cancelled_by = (select public.current_person_id())
         and cancelled_at > now() - interval '1 hour');

revoke execute on function public.board_columns(text, text) from public, anon;
revoke execute on function public.board_column_ord(text, text, text) from public, anon;
revoke execute on function public.booking_kept(text, text, text, text) from public, anon;
revoke execute on function public.legacy_next_column(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.step_card_owner(text, text) from public, anon;
revoke execute on function public.step_card_visible(text, text) from public, anon;
revoke execute on function public.pipeline_step_cancellations_after_insert() from public, anon, authenticated;
revoke execute on function public.pipeline_step_cancellations_after_delete() from public, anon, authenticated;
grant execute on function public.board_columns(text, text) to authenticated;
grant execute on function public.board_column_ord(text, text, text) to authenticated;
grant execute on function public.booking_kept(text, text, text, text) to authenticated;
grant execute on function public.step_card_owner(text, text) to authenticated;
grant execute on function public.step_card_visible(text, text) to authenticated;
