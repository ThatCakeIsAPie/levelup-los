-- The recruiting board gets the customer board's fixed columns: "Not
-- contacted yet" before Contact made, "Not interested" and "Do not contact"
-- after Registered (client: src/data/pipeline/types.ts FIXED_RECRUITING_COLUMNS).
--
--  * move_pipeline_card() accepts not_contacted (band "start") and
--    not_interested / do_not_contact (band "out"). Those bands reach no
--    milestone: pipeline_milestone_index() has no index for them, so
--    pipeline_person_counts() leaves them out (mirror of reachesOf).
--  * Steps can't take those ids or names. A step that already uses one of the
--    names gets " (step)" added, so nothing is lost.
--  * A prospect in "Do not contact" is left out of reminders by the app (as on
--    the customer board); nothing else changes in the database.

alter table public.pipeline_moves drop constraint pipeline_moves_milestone_check;
alter table public.pipeline_moves add constraint pipeline_moves_milestone_check check (
  milestone in ('start', 'contact', 'first_meeting', 'first_plan', 'registered', 'out')
);

update public.pipeline_steps
   set label = left(trim(label), 17) || ' (step)'
 where lower(trim(label)) in ('not contacted yet', 'not interested', 'do not contact');

alter table public.pipeline_steps drop constraint pipeline_steps_id_check;
alter table public.pipeline_steps add constraint pipeline_steps_id_check check (
  id not in ('contact', 'first_meeting', 'first_plan', 'registered',
             'not_contacted', 'not_interested', 'do_not_contact')
);
alter table public.pipeline_steps drop constraint pipeline_steps_label_check;
alter table public.pipeline_steps add constraint pipeline_steps_label_check check (
  length(trim(label)) between 1 and 24
  and lower(trim(label)) not in ('contact made', 'first meeting', 'first plan', 'registered',
                                 'not contacted yet', 'not interested', 'do not contact')
);

-- Same as in 20261013000400_pipeline.sql, with the fixed columns.
--
-- Move a prospect's card (or create it) and record the move. `p_to` is a
-- milestone code, a fixed column, or a step on the prospect's owner's or the
-- caller's sponsor line. Moving into Registered makes the person an
-- apprentice from today (stage history, activity; team chats follow by
-- trigger). Returns {"move": ..., "card": ...}. `p_move_id` lets the client
-- keep its own id.
create or replace function public.move_pipeline_card(
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

  v_band := case
    when p_to in ('contact', 'first_meeting', 'first_plan', 'registered') then p_to
    when p_to = 'not_contacted' then 'start'
    when p_to in ('not_interested', 'do_not_contact') then 'out'
  end;
  if v_band is null then
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
