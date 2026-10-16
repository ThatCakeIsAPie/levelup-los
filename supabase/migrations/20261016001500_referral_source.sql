-- "Referral source": a fixed outcome column on both boards (Jay's request,
-- 2026-10-16; client: src/data/pipeline/types.ts REFERRAL_SOURCE). Someone
-- who isn't a fit or isn't interested but passes on names of people who are.
--
--  * The column sits in the "out" band, first (before Not interested and Do
--    not contact). Like the other outcomes it reaches no milestone, so the
--    counts (pipeline_person_counts(), the funnels) are unchanged; a card can
--    move there from anywhere and back.
--  * move_pipeline_card() / move_customer_card() accept it; board_columns()
--    lists it (so bookings and their clearing treat it as an outcome).
--  * Steps can't take its id or name. A step already called "Referral source"
--    gets " (step)" added, so nothing is lost.

-- ---------------------------------------------------------------------------
-- Steps can't take the name or id
-- ---------------------------------------------------------------------------

update public.pipeline_steps
   set label = left(trim(label), 17) || ' (step)'
 where lower(trim(label)) = 'referral source';
update public.customer_steps
   set label = left(trim(label), 17) || ' (step)'
 where lower(trim(label)) = 'referral source';

alter table public.pipeline_steps drop constraint pipeline_steps_id_check;
alter table public.pipeline_steps add constraint pipeline_steps_id_check check (
  id not in ('contact', 'first_meeting', 'first_plan', 'registered',
             'not_contacted', 'not_interested', 'do_not_contact', 'referral_source')
);
alter table public.pipeline_steps drop constraint pipeline_steps_label_check;
alter table public.pipeline_steps add constraint pipeline_steps_label_check check (
  length(trim(label)) between 1 and 24
  and lower(trim(label)) not in ('contact made', 'first meeting', 'first plan', 'registered',
                                 'not contacted yet', 'not interested', 'do not contact',
                                 'referral source')
);

alter table public.customer_steps drop constraint customer_steps_id_check;
alter table public.customer_steps add constraint customer_steps_id_check check (
  id not in ('contact', 'first_meeting', 'first_sale', 'on_ditto', 'not_contacted',
             'new_contact', 'not_interested', 'do_not_contact', 'referral_source')
);
alter table public.customer_steps drop constraint customer_steps_label_check;
alter table public.customer_steps add constraint customer_steps_label_check check (
  length(trim(label)) between 1 and 24
  and lower(trim(label)) not in ('contact', 'first meeting', 'first sale', 'on ditto',
                                 'not contacted yet', 'new contacts', 'not interested',
                                 'do not contact', 'referral source')
);

-- ---------------------------------------------------------------------------
-- A board's columns, in order: as in 20261014005000_pipeline_next_steps.sql,
-- with Referral source first in the outcomes (mirror of columnsFor).
-- ---------------------------------------------------------------------------

create or replace function public.board_columns(p_board text, p_owner text)
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
      ('referral_source', 'out', 'fixed', 'Referral source', 0),
      ('not_interested', 'out', 'fixed', 'Not interested', 1),
      ('do_not_contact', 'out', 'fixed', 'Do not contact', 2)) f (id, band, kind, label, sub)
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

-- ---------------------------------------------------------------------------
-- Moves: as in 20261016000200_move_pipeline_card_rating.sql and
-- 20261014005000_pipeline_next_steps.sql, with Referral source an outcome.
-- ---------------------------------------------------------------------------

create or replace function public.move_pipeline_card(
  p_person_id text,
  p_to text,
  p_move_id text default null,
  p_next_column text default null,
  p_next_step_date date default null,
  p_next_step_time time default null,
  p_source text default null,
  p_hot boolean default null,
  p_rating text default null
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
    when p_to in ('referral_source', 'not_interested', 'do_not_contact') then 'out'
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
                                     next_step_date, next_step_time, hot, rating, source,
                                     dropped_at, updated_at)
  values (p_person_id, v_ws, p_to, v_move.moved_at, v_next, v_date, v_time,
          coalesce(p_hot, false), p_rating, nullif(trim(p_source), ''), null, now())
  on conflict (person_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_column = excluded.next_column,
         next_step_date = excluded.next_step_date,
         next_step_time = excluded.next_step_time,
         hot = coalesce(p_hot, public.pipeline_cards.hot),
         rating = coalesce(p_rating, public.pipeline_cards.rating),
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

create or replace function public.move_customer_card(
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
    when p_to in ('referral_source', 'not_interested', 'do_not_contact') then 'out'
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
