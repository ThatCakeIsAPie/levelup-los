-- Moving an occurrence of a repeating event on the calendar (client: src/data/recurrence/move.ts,
-- the drag in src/modules/events).
--
-- Dropping an occurrence on another day asks "Move just this one" or "Move all". The functions that
-- already exist do not do either:
--  * "This event" (a plain update) keeps the occurrence in its series, marked as changed on its own;
--  * "This and following" plans the later occurrences again from the new date: it deletes the ones
--    nothing hangs off and makes new ones, so the ones with answers, tickets or attendance would stay
--    where they were instead of moving.
--
-- Three new functions, nothing replaced (so no existing function, trigger, policy or grant changes):
--
--  * move_event_one(event, date, end date): the occurrence leaves its series and becomes a single event
--    on the new days. Its old date is added to the series' skipped dates, so no top-up makes it again.
--  * move_event_series_following(event, days): this occurrence and every later one move by the same
--    number of days, and the rule moves with them (the series is split before this occurrence, or
--    moved in place when this is its first). The same events keep their ids: answers, tickets,
--    attendance and everything else that hangs off them stay on them.
--  * restore_event_move(events, series, series to drop): puts back what a move changed (the Undo of
--    the toast): the dates, the series each event belongs to and the rule of each series.
--
-- Who may: whoever may edit the events involved (`may_edit_events`: the creator, a leader or moderator,
-- a deputy), the same as the other series functions. A move never makes or deletes an event.

-- The number of a date's place in a rule (0 = the first date), or null when the date is not one of
-- its occurrences.
create function public.series_slot_index(p_freq text, p_anchor date, p_date date) returns integer
language plpgsql immutable set search_path = ''
as $$
declare
  v_d date;
  n integer := 0;
begin
  if p_date < p_anchor then
    return null;
  end if;
  while n < 5000 loop
    v_d := public.series_nth_date(p_freq, p_anchor, n);
    if v_d = p_date then
      return n;
    elsif v_d > p_date then
      return null;
    end if;
    n := n + 1;
  end loop;
  return null;
end $$;

-- Where a place of a rule goes when the rule moves: the same place counted from the moved
-- occurrence's new date (p_idx0 is the moved occurrence's place in the old rule). Daily, weekly and
-- every-two-weeks rules shift by exactly p_days; a monthly rule keeps counting months, so its places
-- are the same ones of the months, whatever day that is.
create function public.series_move_slot(
  p_freq text, p_anchor date, p_idx0 integer, p_new_anchor date, p_days integer, p_date date
) returns date
language plpgsql immutable set search_path = ''
as $$
declare
  v_i integer := public.series_slot_index(p_freq, p_anchor, p_date);
begin
  if v_i is null or v_i < p_idx0 then
    return p_date + p_days;
  end if;
  return public.series_nth_date(p_freq, p_new_anchor, v_i - p_idx0);
end $$;

-- "Move just this one": the occurrence becomes a single event on p_date (to p_end_date) and its place in
-- the series is kept as a skipped date. The length stays: a move never changes how many days it runs.
create function public.move_event_one(p_event_id text, p_date date, p_end_date date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_sid text;
  s public.event_series;
  e public.events;
  v_prev text;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  if p_date is null or (p_end_date is not null and p_end_date < p_date) then
    raise exception 'The end date can''t be before the start date' using errcode = '23514';
  end if;
  select series_id into v_sid from public.events where id = p_event_id and workspace_id = v_ws;
  if v_sid is null then
    raise exception 'That event doesn''t repeat' using errcode = '22023';
  end if;
  select * into s from public.event_series where id = v_sid and workspace_id = v_ws for update;
  select * into e from public.events where id = p_event_id and series_id = v_sid for update;
  if s.id is null or e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if not public.may_edit_events(e.created_by) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  if coalesce(p_end_date - p_date, 0) <> coalesce(e.end_date - e.date, 0) then
    raise exception 'A move keeps the length of the event' using errcode = '22023';
  end if;

  v_prev := public.series_internal_begin();
  update public.events
     set date = p_date, end_date = p_end_date,
         series_id = null, series_date = null, series_overrides = null
   where id = e.id;
  update public.event_series
     set skipped = array(select distinct d from unnest(array_append(skipped, e.series_date)) d order by d)
   where id = s.id;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.events x where x.id = e.id), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y where y.id = s.id), '[]'::jsonb));
end $$;
comment on function public.move_event_one(text, date, date) is
  'Moves one occurrence of a repeating event to other days: it leaves its series and becomes a single event, and its old date is never made again.';
revoke execute on function public.move_event_one(text, date, date) from public, anon;
grant execute on function public.move_event_one(text, date, date) to authenticated;

-- "Move all": this occurrence and every later one of its series move p_days days (negative = earlier), and
-- the rule moves with them. Earlier occurrences stay. The series is split before this occurrence (the
-- earlier ones keep the old series, which now ends the day before) or, when this is the first
-- occurrence, moved in place. Every moved event keeps its id and what hangs off it; one whose date no
-- longer is its place in the rule (a monthly rule keeps its own days) is marked as changed on its own.
-- Nothing is made here: the next top-up fills what the moved series is missing.
create function public.move_event_series_following(p_event_id text, p_days integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_sid text;
  s public.event_series;
  e public.events;
  v_slot date;
  v_idx0 integer;
  v_anchor date;
  v_ends date;
  v_skip date[];
  v_target text;
  v_ids text[];
  v_sds date[];
  v_sd date;
  i integer;
  v_prev text;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  if p_days is null or p_days = 0 or abs(p_days) > 3660 then
    raise exception 'Pick another day to move to' using errcode = '22023';
  end if;
  -- Series first, then the occurrence: the same order everywhere, so two callers can't deadlock.
  select series_id into v_sid from public.events where id = p_event_id and workspace_id = v_ws;
  if v_sid is null then
    raise exception 'That event doesn''t repeat' using errcode = '22023';
  end if;
  select * into s from public.event_series where id = v_sid and workspace_id = v_ws for update;
  select * into e from public.events where id = p_event_id and series_id = v_sid for update;
  if s.id is null or e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  v_slot := e.series_date;
  if not public.may_edit_events(e.created_by)
     or exists (select 1 from public.events x
                 where x.series_id = s.id and x.series_date > v_slot
                   and not public.may_edit_events(x.created_by)) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  v_idx0 := public.series_slot_index(s.freq, s.starts_on, v_slot);
  if v_idx0 is null then
    raise exception 'That event is not on its series'' rule' using errcode = '22023';
  end if;

  v_anchor := v_slot + p_days;
  v_ends := case when s.ends_on is null then null else s.ends_on + p_days end;
  v_skip := array(select distinct public.series_move_slot(s.freq, s.starts_on, v_idx0, v_anchor, p_days, d)
                    from unnest(s.skipped) d where d >= v_slot order by 1);
  select array_agg(x.id order by x.series_date), array_agg(x.series_date order by x.series_date)
    into v_ids, v_sds
    from public.events x where x.series_id = s.id and x.series_date >= v_slot;

  v_prev := public.series_internal_begin();
  if v_slot = s.starts_on then
    update public.event_series set starts_on = v_anchor, ends_on = v_ends, skipped = v_skip where id = s.id;
    v_target := s.id;
  else
    insert into public.event_series
      (workspace_id, created_by, freq, starts_on, ends_on, skipped, name, category_id, location, notes,
       format, ticket_url, length_days, start_time, end_time)
    select t.workspace_id, t.created_by, t.freq, v_anchor, v_ends, v_skip, t.name, t.category_id, t.location,
           t.notes, t.format, t.ticket_url, t.length_days, t.start_time, t.end_time
      from public.event_series t where t.id = s.id
    returning id into v_target;
    update public.event_series set ends_on = v_slot - 1 where id = s.id;
  end if;

  -- Out of their places while they are sorted (the unique index would trip over a date that moves).
  update public.events set series_date = null where id = any(v_ids);
  for i in 1 .. cardinality(v_ids) loop
    v_sd := public.series_move_slot(s.freq, s.starts_on, v_idx0, v_anchor, p_days, v_sds[i]);
    update public.events
       set date = date + p_days,
           end_date = case when end_date is null then null else end_date + p_days end,
           series_id = v_target,
           series_date = v_sd,
           series_overrides = case
             when date + p_days <> v_sd
               then array(select distinct f from unnest(coalesce(series_overrides, '{}'::text[]) || array['date']) f order by f)
             else series_overrides end
     where id = v_ids[i];
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.events x where x.id = any(v_ids)), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y
                         where y.id = s.id or y.id = v_target), '[]'::jsonb));
end $$;
comment on function public.move_event_series_following(text, integer) is
  'Moves a repeating event''s occurrence and every later one by the same number of days and moves the rule with them; earlier occurrences stay.';
revoke execute on function public.move_event_series_following(text, integer) from public, anon;
grant execute on function public.move_event_series_following(text, integer) to authenticated;

-- Undo of a move: sets each listed event back to the given dates and series (p_events: id, date, end_date,
-- series_id, series_date, series_overrides), each listed series back to its rule (p_series: id, starts_on,
-- ends_on, skipped) and deletes the series in p_drop_series (the one a move split off) once no event is
-- in it. Only events the caller may edit, only series of those events, only series nothing is left in.
create function public.restore_event_move(p_events jsonb, p_series jsonb, p_drop_series text[]) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_prev text;
  r record;
  e public.events;
  s public.event_series;
  v_ids text[] := '{}';
  v_sids text[] := '{}';
  v_gone text[] := '{}';
  v_id text;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  p_events := coalesce(p_events, '[]'::jsonb);
  p_series := coalesce(p_series, '[]'::jsonb);
  p_drop_series := coalesce(p_drop_series, '{}'::text[]);
  if jsonb_typeof(p_events) <> 'array' or jsonb_typeof(p_series) <> 'array'
     or jsonb_array_length(p_events) > 2000 or jsonb_array_length(p_series) > 50
     or cardinality(p_drop_series) > 50 then
    raise exception 'Nothing to restore' using errcode = '22023';
  end if;

  -- Lock in one order (series, then events), and check who may touch what.
  for r in select * from jsonb_to_recordset(p_series)
             as t(id text, starts_on date, ends_on date, skipped jsonb) order by id loop
    select * into s from public.event_series where id = r.id and workspace_id = v_ws for update;
    if s.id is null then
      raise exception 'Series not found' using errcode = 'P0002';
    end if;
    if not exists (select 1 from jsonb_to_recordset(p_events) as t(series_id text) where t.series_id = r.id) then
      raise exception 'You can''t change this series' using errcode = '42501';
    end if;
    v_sids := v_sids || r.id;
  end loop;
  for r in select * from jsonb_to_recordset(p_events)
             as t(id text, date date, end_date date, series_id text, series_date date,
                  series_overrides jsonb) order by id loop
    select * into e from public.events where id = r.id and workspace_id = v_ws for update;
    if e.id is null then
      raise exception 'Event not found' using errcode = 'P0002';
    end if;
    if not public.may_edit_events(e.created_by) then
      raise exception 'You can''t change this event' using errcode = '42501';
    end if;
    if r.series_id is not null
       and not exists (select 1 from public.event_series y where y.id = r.series_id and y.workspace_id = v_ws) then
      raise exception 'Series not found' using errcode = 'P0002';
    end if;
    v_ids := v_ids || r.id;
  end loop;

  v_prev := public.series_internal_begin();
  update public.events set series_date = null where id = any(v_ids);
  for r in select * from jsonb_to_recordset(p_events)
             as t(id text, date date, end_date date, series_id text, series_date date,
                  series_overrides jsonb) loop
    update public.events
       set date = r.date, end_date = r.end_date, series_id = r.series_id, series_date = r.series_date,
           series_overrides = case when jsonb_typeof(r.series_overrides) = 'array'
                                   then nullif(array(select jsonb_array_elements_text(r.series_overrides)), '{}'::text[])
                              end
     where id = r.id;
  end loop;
  for r in select * from jsonb_to_recordset(p_series)
             as t(id text, starts_on date, ends_on date, skipped jsonb) loop
    update public.event_series
       set starts_on = r.starts_on, ends_on = r.ends_on,
           skipped = array(select d::date from jsonb_array_elements_text(coalesce(r.skipped, '[]'::jsonb)) d order by 1)
     where id = r.id;
  end loop;
  foreach v_id in array p_drop_series loop
    select * into s from public.event_series where id = v_id and workspace_id = v_ws for update;
    if s.id is null then
      continue;
    end if;
    if exists (select 1 from public.events x where x.series_id = s.id) then
      raise exception 'That series still has events' using errcode = '22023';
    end if;
    if not public.may_edit_events(s.created_by) then
      raise exception 'You can''t change this series' using errcode = '42501';
    end if;
    delete from public.event_series where id = s.id;
    v_gone := v_gone || s.id;
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.events x where x.id = any(v_ids)), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y where y.id = any(v_sids)), '[]'::jsonb),
    'deleted_series', to_jsonb(v_gone));
end $$;
comment on function public.restore_event_move(jsonb, jsonb, text[]) is
  'Undo of a move on the calendar: puts the listed events and series back as they were and removes the series the move split off.';
revoke execute on function public.restore_event_move(jsonb, jsonb, text[]) from public, anon;
grant execute on function public.restore_event_move(jsonb, jsonb, text[]) to authenticated;

-- The internals are for the functions above only.
revoke execute on function public.series_slot_index(text, date, date) from public, anon, authenticated;
revoke execute on function public.series_move_slot(text, date, integer, date, integer, date) from public, anon, authenticated;
