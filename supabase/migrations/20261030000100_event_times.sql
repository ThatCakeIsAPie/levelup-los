-- Events can have a start and an end time (client: src/data/eventTimes.ts, src/data/recurrence).
--
--  * `events.start_time` and `events.end_time` are wall-clock times (`time`, no zone) in the team's time
--    zone (`workspaces.timezone`); null = no time. An event with no start time is all-day, exactly as
--    every event was before. The zone is not stored on the event: a team has one, and the time stays
--    "7 PM" when the clocks change. Whoever turns a time into a point in time (the app's "Add to
--    calendar", a program reading events) applies `workspaces.timezone` to the event's date and time.
--  * Rules (`event_times_ok()`, a check constraint on `events` and on `event_series`): an end time needs
--    a start time; on a one-day event the end time is after the start time; on a multi-day event the
--    start time belongs to the first day and the end time to the last, so the end may be earlier.
--  * `event_series.start_time` / `end_time` are what a new occurrence is made from, like the other
--    template fields. A series takes its times from the event that starts it, occurrences made later get
--    them, "this and following" changes them from that occurrence on, and a time changed on one
--    occurrence alone is remembered in `series_overrides` like every other field ('start_time',
--    'end_time'): the guard trigger's field list and the following-update function's allowed fields grow
--    by those two (TypeScript twin: src/data/recurrence/plan.ts).
--  * `events.updated_at` (timestamptz, default now()) is kept current by a trigger on every update, so a
--    program reading events can tell what changed. Existing rows start at their `created_at`.
--
-- Additive only: five new nullable/defaulted columns, one pure helper function, one trigger and the new
-- constraints (which every existing row satisfies, because every existing row has no time). The currently
-- deployed client writes none of these columns and keeps working: its inserts and updates leave them
-- alone, its "this event" edits still pass the guard trigger, and it calls the same three series
-- functions with the same arguments. Replaced functions keep their signatures, `security definer`,
-- `search_path = ''`, caller checks and grants.

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

-- Whether a start and end time are allowed on an event that runs p_length_days past its first day (0 = a
-- one-day event). Pure: it reads no table, so it is safe for a check constraint and for any caller (the same
-- rule as `timesOk()` in src/data/eventTimes.ts; both are tested against the one table of cases in
-- src/data/recurrence/cases.ts).
create function public.event_times_ok(p_length_days integer, p_start_time time, p_end_time time)
returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_end_time is null then true
    when p_start_time is null then false
    else coalesce(p_length_days, 0) > 0 or p_end_time > p_start_time
  end
$$;
comment on function public.event_times_ok(integer, time, time) is
  'Whether a start and end time are allowed on an event that runs p_length_days past its first day: no end time without a start time, and on a one-day event the end is after the start.';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

alter table public.events
  add column start_time time,
  add column end_time time,
  add column updated_at timestamptz not null default now();
comment on column public.events.start_time is 'Wall-clock start time in the workspace''s time zone; null = all-day (and then there is no end time).';
comment on column public.events.end_time is 'Wall-clock end time in the workspace''s time zone, on the last day for a multi-day event; null = none.';
comment on column public.events.updated_at is 'When the event row last changed (set by a trigger on every update); the starting value of an event from before is its created_at.';

alter table public.events
  add constraint events_times_ok
  check (public.event_times_ok(coalesce(end_date - date, 0), start_time, end_time));

alter table public.event_series
  add column start_time time,
  add column end_time time;
comment on column public.event_series.start_time is 'The start time a new occurrence gets (wall-clock, in the workspace''s time zone); null = all-day.';
comment on column public.event_series.end_time is 'The end time a new occurrence gets; null = none.';

alter table public.event_series
  add constraint event_series_times_ok
  check (public.event_times_ok(length_days, start_time, end_time));

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

-- Existing events start at the day they were made. (Before the trigger below exists, so this is not
-- itself a change.)
update public.events set updated_at = created_at;

create function public.events_touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.events_touch_updated_at() from public, anon, authenticated;

create trigger events_touch_updated_at before update on public.events
  for each row execute function public.events_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Series functions that know the two new fields. Each is `create or replace` with the same signature;
-- ownership, `security definer`, `search_path = ''` and the grants below are the same as before.
-- ---------------------------------------------------------------------------

-- A change to one occurrence is remembered on it, now including its times.
create or replace function public.events_series_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_fields text[];
begin
  if coalesce(current_setting('app.series_internal', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.series_id is not null or new.series_date is not null or new.series_overrides is not null then
      raise exception 'Occurrences of a repeating event are made by their series'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.series_id is distinct from old.series_id
     or new.series_date is distinct from old.series_date
     or new.series_overrides is distinct from old.series_overrides then
    raise exception 'The series of an event can''t be changed directly' using errcode = '42501';
  end if;
  if old.series_id is not null then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.category_id is distinct from old.category_id then 'category_id' end,
      case when new.location is distinct from old.location then 'location' end,
      case when new.notes is distinct from old.notes then 'notes' end,
      case when new.format is distinct from old.format then 'format' end,
      case when new.ticket_url is distinct from old.ticket_url then 'ticket_url' end,
      case when new.date is distinct from old.date then 'date' end,
      case when new.end_date is distinct from old.end_date then 'end_date' end,
      case when new.start_time is distinct from old.start_time then 'start_time' end,
      case when new.end_time is distinct from old.end_time then 'end_time' end
    ]::text[], null);
    if cardinality(v_fields) > 0 then
      new.series_overrides := array(
        select distinct f from unnest(coalesce(old.series_overrides, '{}'::text[]) || v_fields) f
         order by f);
    end if;
  end if;
  return new;
end $$;

-- New occurrences carry the series' times.
create or replace function public.series_fill(p_series_id text, p_today date) returns setof public.events
language plpgsql security definer set search_path = ''
as $$
declare
  s public.event_series;
  n integer := 0;
  v_slot date;
  v_wanted integer := 0;
  v_horizon date := p_today + 56;
  v_row public.events;
  v_prev text;
begin
  select * into s from public.event_series where id = p_series_id for update;
  if s.id is null or (s.ends_on is not null and s.ends_on < p_today) then
    return;
  end if;
  v_prev := public.series_internal_begin();
  while n < 5000 loop
    v_slot := public.series_nth_date(s.freq, s.starts_on, n);
    n := n + 1;
    exit when s.ends_on is not null and v_slot > s.ends_on;
    continue when v_slot < p_today;
    exit when v_slot > v_horizon and v_wanted >= 2;
    continue when v_slot = any(s.skipped);
    v_wanted := v_wanted + 1;
    insert into public.events
      (workspace_id, name, category_id, date, end_date, location, notes, format, ticket_url,
       start_time, end_time, created_by, series_id, series_date)
    values
      (s.workspace_id, s.name, s.category_id, v_slot,
       case when s.length_days > 0 then v_slot + s.length_days end,
       s.location, s.notes, s.format, s.ticket_url, s.start_time, s.end_time, s.created_by, s.id, v_slot)
    on conflict (series_id, series_date) where series_id is not null do nothing
    returning * into v_row;
    if found then
      return next v_row;
    end if;
  end loop;
  perform public.series_internal_end(v_prev);
  return;
end $$;

-- A new series takes the event's times.
create or replace function public.make_event_repeat(p_event_id text, p_freq text, p_ends_on date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  e public.events;
  v_id text;
  v_prev text;
  r public.events;
  v_events jsonb := '[]'::jsonb;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  select * into e from public.events where id = p_event_id and workspace_id = v_ws for update;
  if e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if not public.may_edit_events(e.created_by) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  if e.series_id is not null then
    raise exception 'That event already repeats' using errcode = '22023';
  end if;
  if p_freq is null or p_freq not in ('daily', 'weekly', 'biweekly', 'monthly_date', 'monthly_weekday') then
    raise exception 'Unknown repeat' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < e.date then
    raise exception 'The series can''t end before it starts' using errcode = '22023';
  end if;
  if coalesce(e.end_date - e.date, 0) > 0
     and coalesce(e.end_date - e.date, 0) + 1 >= public.series_period_days(p_freq) then
    raise exception 'A multi-day event can only repeat less often than it is long' using errcode = '22023';
  end if;

  v_prev := public.series_internal_begin();
  insert into public.event_series
    (workspace_id, created_by, freq, starts_on, ends_on, name, category_id, location, notes, format,
     ticket_url, start_time, end_time, length_days)
  values
    (e.workspace_id, e.created_by, p_freq, e.date, p_ends_on, e.name, e.category_id, e.location, e.notes,
     e.format, e.ticket_url, e.start_time, e.end_time, coalesce(e.end_date - e.date, 0))
  returning id into v_id;
  update public.events set series_id = v_id, series_date = e.date where id = e.id;
  for r in select * from public.series_fill(v_id, public.workspace_today(v_ws)) loop
    v_events := v_events || to_jsonb(r);
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', v_events || coalesce((select jsonb_agg(to_jsonb(x)) from public.events x where x.id = e.id), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y where y.id = v_id), '[]'::jsonb));
end $$;

-- "This and following" changes the times (and drops an end time that no longer fits an occurrence).
create or replace function public.update_event_series_following(p_event_id text, p_patch jsonb, p_repeat jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_today date;
  v_sid text;
  s public.event_series;
  e public.events;
  n public.events;
  v_key text;
  v_changed text[];
  v_old_len integer;
  v_new_len integer;
  v_freq text;
  v_ends date;
  v_stopped boolean := false;
  v_rule_changed boolean := false;
  v_target text;
  v_first boolean;
  v_later text[];
  v_taken date[] := '{}';
  v_removed text[] := '{}';
  v_touched text[];
  v_prev text;
  l public.events;
  m public.events;
  r public.events;
  v_t_start time;
  v_t_end time;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  p_patch := coalesce(p_patch, '{}'::jsonb);
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'category_id', 'location', 'notes', 'format', 'ticket_url', 'date', 'end_date',
                     'start_time', 'end_time') then
      raise exception 'Unknown field: %', v_key using errcode = '22023';
    end if;
  end loop;

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
  if not public.may_edit_events(e.created_by)
     or exists (select 1 from public.events x
                 where x.series_id = s.id and x.series_date > e.series_date
                   and not public.may_edit_events(x.created_by)) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  v_today := public.workspace_today(v_ws);

  -- The occurrence as it will be.
  n := e;
  if p_patch ? 'name' then n.name := btrim(coalesce(p_patch ->> 'name', '')); end if;
  if p_patch ? 'category_id' then n.category_id := p_patch ->> 'category_id'; end if;
  if p_patch ? 'location' then n.location := p_patch ->> 'location'; end if;
  if p_patch ? 'notes' then n.notes := p_patch ->> 'notes'; end if;
  if p_patch ? 'format' then n.format := p_patch ->> 'format'; end if;
  if p_patch ? 'ticket_url' then n.ticket_url := p_patch ->> 'ticket_url'; end if;
  if p_patch ? 'date' then n.date := (p_patch ->> 'date')::date; end if;
  if p_patch ? 'end_date' then n.end_date := (p_patch ->> 'end_date')::date; end if;
  if p_patch ? 'start_time' then n.start_time := (p_patch ->> 'start_time')::time; end if;
  if p_patch ? 'end_time' then n.end_time := (p_patch ->> 'end_time')::time; end if;
  if n.name = '' or n.name is null or n.date is null then
    raise exception 'An event needs a name and a date' using errcode = '23514';
  end if;
  if n.end_date is not null and n.end_date < n.date then
    raise exception 'The end date can''t be before the start date' using errcode = '23514';
  end if;
  if n.end_time is not null and n.start_time is null then
    raise exception 'An end time needs a start time' using errcode = '23514';
  end if;
  v_old_len := coalesce(e.end_date - e.date, 0);
  v_new_len := coalesce(n.end_date - n.date, 0);
  if not public.event_times_ok(v_new_len, n.start_time, n.end_time) then
    raise exception 'The end time must be after the start time' using errcode = '23514';
  end if;
  v_changed := array_remove(array[
    case when n.name is distinct from e.name then 'name' end,
    case when n.category_id is distinct from e.category_id then 'category_id' end,
    case when n.location is distinct from e.location then 'location' end,
    case when n.notes is distinct from e.notes then 'notes' end,
    case when n.format is distinct from e.format then 'format' end,
    case when n.ticket_url is distinct from e.ticket_url then 'ticket_url' end,
    case when n.date is distinct from e.date then 'date' end,
    case when n.end_date is distinct from e.end_date then 'end_date' end,
    case when n.start_time is distinct from e.start_time then 'start_time' end,
    case when n.end_time is distinct from e.end_time then 'end_time' end
  ]::text[], null);

  -- The rule as it will be.
  v_freq := s.freq;
  v_ends := s.ends_on;
  if p_repeat is not null and p_repeat <> 'null'::jsonb then
    if p_repeat ->> 'freq' = 'none' then
      v_stopped := true;
      v_rule_changed := true;
    else
      v_freq := p_repeat ->> 'freq';
      v_ends := (p_repeat ->> 'ends_on')::date;
      if v_freq is null or v_freq not in ('daily', 'weekly', 'biweekly', 'monthly_date', 'monthly_weekday') then
        raise exception 'Unknown repeat' using errcode = '22023';
      end if;
      v_rule_changed := v_freq is distinct from s.freq or v_ends is distinct from s.ends_on;
    end if;
  end if;
  if not v_stopped then
    if v_new_len > 0 and v_new_len + 1 >= public.series_period_days(v_freq) then
      raise exception 'A multi-day event can only repeat less often than it is long' using errcode = '22023';
    end if;
    if v_ends is not null and v_ends < n.date then
      raise exception 'The series can''t end before it starts' using errcode = '22023';
    end if;
  end if;

  v_prev := public.series_internal_begin();
  v_later := array(select x.id from public.events x
                    where x.series_id = s.id and x.series_date > e.series_date);

  -- The fields that changed move on to the later occurrences that haven't set them themselves. One
  -- occurrence at a time: a time that doesn't fit the occurrence it lands on (an end time with no start
  -- time, or an end that isn't after the start on a one-day occurrence) is dropped, never made up.
  for l in select * from public.events x where x.id = any(v_later) order by x.series_date loop
    m := l;
    if 'name' = any(v_changed) and not coalesce('name' = any(l.series_overrides), false) then
      m.name := n.name;
    end if;
    if 'category_id' = any(v_changed) and not coalesce('category_id' = any(l.series_overrides), false) then
      m.category_id := n.category_id;
    end if;
    if 'location' = any(v_changed) and not coalesce('location' = any(l.series_overrides), false) then
      m.location := n.location;
    end if;
    if 'notes' = any(v_changed) and not coalesce('notes' = any(l.series_overrides), false) then
      m.notes := n.notes;
    end if;
    if 'format' = any(v_changed) and not coalesce('format' = any(l.series_overrides), false) then
      m.format := n.format;
    end if;
    if 'ticket_url' = any(v_changed) and not coalesce('ticket_url' = any(l.series_overrides), false) then
      m.ticket_url := n.ticket_url;
    end if;
    if 'start_time' = any(v_changed) and not coalesce('start_time' = any(l.series_overrides), false) then
      m.start_time := n.start_time;
    end if;
    if 'end_time' = any(v_changed) and not coalesce('end_time' = any(l.series_overrides), false) then
      m.end_time := n.end_time;
    end if;
    if v_new_len <> v_old_len and not coalesce('end_date' = any(l.series_overrides), false) then
      m.end_date := case when v_new_len > 0 then l.date + v_new_len end;
    end if;
    if not public.event_times_ok(coalesce(m.end_date - m.date, 0), m.start_time, m.end_time) then
      m.end_time := null;
    end if;
    update public.events set
      name = m.name, category_id = m.category_id, location = m.location, notes = m.notes,
      format = m.format, ticket_url = m.ticket_url, end_date = m.end_date,
      start_time = m.start_time, end_time = m.end_time
     where id = l.id;
  end loop;

  -- The occurrence itself takes everything and forgets what it had set on its own for those fields.
  update public.events set
    name = n.name, category_id = n.category_id, location = n.location, notes = n.notes,
    format = n.format, ticket_url = n.ticket_url, date = n.date, end_date = n.end_date,
    start_time = n.start_time, end_time = n.end_time,
    series_overrides = nullif(array(select f from unnest(coalesce(e.series_overrides, '{}'::text[])) f
                                     where f <> all(v_changed)), '{}'::text[])
   where id = e.id;

  -- What new occurrences are made from (a time that doesn't fit the new length is dropped here too).
  v_t_start := case when 'start_time' = any(v_changed) then n.start_time else s.start_time end;
  v_t_end := case when 'end_time' = any(v_changed) then n.end_time else s.end_time end;
  if not public.event_times_ok(v_new_len, v_t_start, v_t_end) then
    v_t_end := null;
  end if;
  update public.event_series set
    name = case when 'name' = any(v_changed) then n.name else name end,
    category_id = case when 'category_id' = any(v_changed) then n.category_id else category_id end,
    location = case when 'location' = any(v_changed) then n.location else location end,
    notes = case when 'notes' = any(v_changed) then n.notes else notes end,
    format = case when 'format' = any(v_changed) then n.format else format end,
    ticket_url = case when 'ticket_url' = any(v_changed) then n.ticket_url else ticket_url end,
    start_time = v_t_start, end_time = v_t_end,
    length_days = v_new_len
   where id = s.id;

  v_target := s.id;
  if (n.date is distinct from e.date) or v_rule_changed then
    -- The schedule changed: plan the later occurrences again from this one, on its (new) date.
    v_first := (e.series_date = s.starts_on);
    if v_stopped then
      update public.event_series set ends_on = e.series_date - 1 where id = s.id;
      v_target := null;
    elsif v_first then
      update public.event_series set freq = v_freq, starts_on = n.date, ends_on = v_ends where id = s.id;
    else
      insert into public.event_series
        (workspace_id, created_by, freq, starts_on, ends_on, skipped, name, category_id, location, notes,
         format, ticket_url, start_time, end_time, length_days)
      select t.workspace_id, t.created_by, v_freq, n.date, v_ends,
             array(select d from unnest(t.skipped) d where d >= e.series_date),
             t.name, t.category_id, t.location, t.notes, t.format, t.ticket_url, t.start_time, t.end_time,
             t.length_days
        from public.event_series t where t.id = s.id
      returning id into v_target;
      update public.event_series set ends_on = e.series_date - 1 where id = s.id;
    end if;

    -- Out of their places while they are sorted (the unique index would trip over a date that moves).
    update public.events set series_date = null where id = e.id or id = any(v_later);
    if v_target is not null then
      update public.events set series_id = v_target, series_date = n.date where id = e.id;
      v_taken := array[n.date];
    else
      update public.events set series_id = null, series_date = null, series_overrides = null where id = e.id;
    end if;
    for l in select * from public.events x where x.id = any(v_later) order by x.date, x.id loop
      if v_target is not null and not (l.date = any(v_taken))
         and public.series_is_slot(v_freq, n.date, l.date)
         and (v_ends is null or l.date <= v_ends) then
        -- Still on the new rule: stays in the series, whatever hangs off it.
        update public.events set series_id = v_target, series_date = l.date where id = l.id;
        v_taken := v_taken || l.date;
      elsif coalesce(cardinality(l.series_overrides), 0) = 0
            and not public.event_has_dependents(l.id)
            and coalesce(l.end_date, l.date) >= v_today then
        -- Untouched, empty and still ahead: the new rule makes its own.
        delete from public.events where id = l.id;
        v_removed := v_removed || l.id;
      else
        -- Kept as it is: a single event now.
        update public.events set series_id = null, series_date = null, series_overrides = null where id = l.id;
      end if;
    end loop;
    if v_target is not null then
      perform 1 from public.series_fill(v_target, v_today);
    end if;
  end if;

  v_touched := array[e.id] || v_later;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.events x
                         where x.id = any(v_touched) or x.series_id = v_target), '[]'::jsonb),
    'deleted', to_jsonb(v_removed),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y
                         where y.id = s.id or y.id = v_target), '[]'::jsonb));
end $$;

-- Grants exactly as in 20261020000100_recurring_events.sql.
revoke execute on function public.events_series_guard() from public, anon, authenticated;
revoke execute on function public.series_fill(text, date) from public, anon, authenticated;
revoke execute on function public.make_event_repeat(text, text, date) from public, anon;
grant execute on function public.make_event_repeat(text, text, date) to authenticated;
revoke execute on function public.update_event_series_following(text, jsonb, jsonb) from public, anon;
grant execute on function public.update_event_series_following(text, jsonb, jsonb) to authenticated;
