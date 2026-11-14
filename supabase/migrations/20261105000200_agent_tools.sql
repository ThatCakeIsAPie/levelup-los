-- Agent connector, part 2: the whitelist. Everything an agent can do is a
-- function named `agent_*` in `public`, and this file is the one place that
-- defines them (each new tool is one function here, one entry in
-- supabase/functions/agent/tools.ts and its tests).
--
-- Every tool is SECURITY INVOKER: the Edge Function runs it as the person
-- (`set local role authenticated`, the person's login in request.jwt.claims),
-- so the existing row-level security decides what they may see and change.
-- Every tool starts with agent_private.ctx(), which refuses unless the call
-- comes through the connector for a live, matching connection that the team
-- switch still allows, and writes exactly one audit row (also when it refuses
-- a request it understood: it returns {"error": "..."} after auditing instead
-- of raising, because a raise would roll the audit row back).
--
-- Never available to an agent: deletes, stage, sponsor, IBO#/LTD#, business
-- start date, chat, anything outside this list.

-- Who the connected person is, and what this connection may do.
create function public.agent_whoami() returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select jsonb_build_object(
           'person', jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'stage', public.effective_biz_class(p.biz_class, p.business_start_date)),
           'team_role', (select m.role from public.members m
                          where m.user_id = auth.uid() and m.person_id = c.person_id limit 1),
           'team', (select w.name from public.workspaces w where w.id = c.workspace_id),
           'today', public.workspace_today(c.workspace_id),
           'access', c.access)
    into v_out
    from public.people p where p.id = c.person_id;
  perform agent_private.audit(c.connection_id, 'whoami', '{}'::jsonb, 'ok');
  return v_out;
end
$$;

-- Prospects the person can see (their own and their downline's).
create function public.agent_list_prospects(p_limit int default 50) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name, x.id), '[]'::jsonb) into v_out
    from (select p.id, p.name, p.phone, p.email, p.location, p.notes, p.sponsor_id
            from public.people p
           where p.biz_class = 'prospect'
           order by p.name, p.id
           limit v_limit) x;
  perform agent_private.audit(c.connection_id, 'list_prospects', jsonb_build_object('limit', v_limit),
                              jsonb_array_length(v_out) || ' rows');
  return v_out;
end
$$;

-- Add a prospect under the connected person.
create function public.agent_add_prospect(p_name text, p_phone text default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_id text := gen_random_uuid()::text;
  v_args jsonb := jsonb_build_object('name', p_name, 'phone', p_phone);
  v_out jsonb;
begin
  select * into c from agent_private.ctx(true);
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 120 or char_length(coalesce(p_phone, '')) > 40 then
    perform agent_private.audit(c.connection_id, 'add_prospect', v_args, 'refused: invalid name or phone');
    return jsonb_build_object('error', 'A name of 1 to 120 characters is required (phone at most 40).');
  end if;
  -- A chosen id and no RETURNING: RETURNING must pass the SELECT policy, which
  -- cannot see a row inserted by the same statement.
  insert into public.people (id, name, biz_class, pipeline_stage, sponsor_id, phone, stage_history)
  values (v_id, btrim(p_name), 'prospect', 'prospect', c.person_id, nullif(btrim(coalesce(p_phone, '')), ''),
          jsonb_build_array(jsonb_build_object('stage', 'prospect', 'at', now())));
  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'sponsor_id', p.sponsor_id)
    into v_out from public.people p where p.id = v_id;
  perform agent_private.audit(c.connection_id, 'add_prospect', v_args, 'created ' || v_id, null, v_out);
  return v_out;
end
$$;

-- Change a prospect's name, phone, email, location or notes. Any other key in
-- the patch is rejected, not ignored. RLS decides which prospects the person
-- may change; an invisible one is "not found" and nothing changes.
create function public.agent_update_prospect(p_id text, p_patch jsonb) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('id', p_id, 'patch', p_patch);
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_max int;
  v_allowed constant text[] := array['name', 'phone', 'email', 'location', 'notes'];
begin
  select * into c from agent_private.ctx(true);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: empty patch');
    return jsonb_build_object('error', 'Nothing to change: give at least one of name, phone, email, location, notes.');
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: field ' || left(v_key, 40) || ' is not allowed');
      return jsonb_build_object('error',
        'Only name, phone, email, location and notes can be changed; "' || left(v_key, 40) || '" cannot. Nothing was changed.');
    end if;
    v_max := case v_key when 'name' then 120 when 'phone' then 40 when 'email' then 200
                        when 'location' then 200 else 4000 end;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null')
       or (v_key = 'name' and (jsonb_typeof(p_patch -> 'name') <> 'string' or btrim(p_patch ->> 'name') = ''))
       or char_length(coalesce(p_patch ->> v_key, '')) > v_max then
      perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: bad value for ' || v_key);
      return jsonb_build_object('error',
        '"' || v_key || '" must be text of at most ' || v_max || ' characters or null (a name cannot be empty or null). Nothing was changed.');
    end if;
  end loop;

  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email,
                            'location', p.location, 'notes', p.notes)
    into v_old from public.people p where p.id = p_id and p.biz_class = 'prospect';
  if v_old is null then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: no such prospect among the visible ones');
    return jsonb_build_object('error', 'No such prospect among the people you can see. Nothing was changed.');
  end if;

  update public.people p set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else p.name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else p.phone end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else p.email end,
    location = case when p_patch ? 'location' then nullif(btrim(p_patch ->> 'location'), '') else p.location end,
    notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else p.notes end,
    last_updated_at = now()
   where p.id = p_id and p.biz_class = 'prospect'
  returning jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email,
                               'location', p.location, 'notes', p.notes)
    into v_new;
  if v_new is null then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: not allowed to change that prospect');
    return jsonb_build_object('error', 'You are not allowed to change that prospect. Nothing was changed.');
  end if;
  perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'updated ' || p_id, v_old, v_new);
  return v_new;
end
$$;

-- ---------------------------------------------------------------------------
-- Event data, in the shape of the receiving standard: iCalendar (RFC 5545), which Google, Apple and
-- Outlook calendars all accept. Field names and meanings are iCalendar's; the tool descriptions in
-- supabase/functions/agent/tools.ts name them. The helpers below read no table except event_data,
-- which reads as the caller, so row-level security decides what is in it.
-- ---------------------------------------------------------------------------

-- How far a zone is ahead of UTC at an instant, in seconds.
create function agent_private.tz_offset(p_zone text, p_at timestamptz) returns integer
language sql
stable
set search_path = ''
as $$
  select extract(epoch from ((p_at at time zone p_zone) - (p_at at time zone 'UTC')))::integer
$$;

-- An offset as iCalendar writes it: +0530, -0600.
create function agent_private.fmt_offset(p_seconds integer) returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_seconds < 0 then '-' else '+' end
         || lpad((abs(p_seconds) / 3600)::text, 2, '0') || lpad(((abs(p_seconds) % 3600) / 60)::text, 2, '0')
$$;

-- The instant a wall-clock date and time is in a zone, the way the app works it out for its own .ics
-- (src/data/chat/calendar.ts, zonedInstant): a time that happens twice (the clocks go back) is the first
-- one; a time that never happens (the clocks go forward) is moved on by the length of the gap. That is
-- also what RFC 5545 says (3.3.5). It equals `p_local at time zone p_zone` everywhere except in the
-- repeated hour, where Postgres takes the second.
create function agent_private.zoned_instant(p_local timestamp, p_zone text) returns timestamptz
language plpgsql
stable
strict
set search_path = ''
as $$
declare
  v_wall timestamptz := p_local at time zone 'UTC'; -- the wall-clock read as if it were UTC
  v_before integer := agent_private.tz_offset(p_zone, v_wall - interval '24 hours');
  v_after integer := agent_private.tz_offset(p_zone, v_wall + interval '24 hours');
  v_fit integer;
begin
  select max(x.o) into v_fit
    from (select v_before as o union select v_after) x
   where agent_private.tz_offset(p_zone, v_wall - make_interval(secs => x.o)) = x.o;
  return v_wall - make_interval(secs => coalesce(v_fit, v_before));
end
$$;

-- ISO 8601: a local wall-clock time without offset, and a UTC instant.
create function agent_private.fmt_local(p timestamp) returns text
language sql
immutable
set search_path = ''
as $$ select to_char(p, 'YYYY-MM-DD"T"HH24:MI:SS') $$;

create function agent_private.fmt_utc(p timestamptz) returns text
language sql
stable
set search_path = ''
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;

-- The RFC 5545 RRULE (no "RRULE:" prefix) that generates exactly the dates public.series_nth_date()
-- generates for a repeat rule, from the series' first date:
--   daily            FREQ=DAILY
--   weekly           FREQ=WEEKLY
--   biweekly         FREQ=WEEKLY;INTERVAL=2
--   monthly_date     day 1-28: FREQ=MONTHLY;BYMONTHDAY=<day>
--                    day 29:   FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1     (February: the 28th or 29th, the last day)
--                    day 30:   FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1  (February: the last day)
--                    day 31:   FREQ=MONTHLY;BYMONTHDAY=-1                    (the app's rule for day 31 IS the last day)
--   monthly_weekday  1st-4th: FREQ=MONTHLY;BYDAY=<n><weekday>
--                    5th:     FREQ=MONTHLY;BYDAY=-1<weekday>   (the app falls back from a fifth weekday to the last
--                             one, so every month gets the last such weekday: the 5th where there is one, else
--                             the 4th, which is the last then)
-- An end date is UNTIL in the form RFC 5545 requires for the series' start: a DATE for an all-day series;
-- for a timed one a UTC date-time, the last second of that day in the team's zone (every occurrence on
-- the end date starts before it, every later one after it). pgTAP 046 checks every form against
-- series_nth_date for the first 24 slots.
create function agent_private.series_rrule(
  p_freq text, p_starts_on date, p_ends_on date, p_timed boolean, p_zone text) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_day integer := extract(day from p_starts_on)::integer;
  v_ord integer := (v_day - 1) / 7 + 1;
  v_wd text := (array['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])[extract(dow from p_starts_on)::integer + 1];
  v_rule text;
begin
  v_rule := case p_freq
    when 'daily' then 'FREQ=DAILY'
    when 'weekly' then 'FREQ=WEEKLY'
    when 'biweekly' then 'FREQ=WEEKLY;INTERVAL=2'
    when 'monthly_date' then case
      when v_day <= 28 then 'FREQ=MONTHLY;BYMONTHDAY=' || v_day
      when v_day = 31 then 'FREQ=MONTHLY;BYMONTHDAY=-1'
      when v_day = 30 then 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'
      else 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1'
    end
    when 'monthly_weekday' then
      'FREQ=MONTHLY;BYDAY=' || case when v_ord = 5 then '-1' else v_ord::text end || v_wd
  end;
  if v_rule is null then
    raise exception 'Unknown repeat: %', p_freq using errcode = '22023';
  end if;
  if p_ends_on is not null then
    v_rule := v_rule || ';UNTIL=' || case
      when p_timed then to_char(
        (agent_private.zoned_instant((p_ends_on + 1)::timestamp, p_zone) - interval '1 second') at time zone 'UTC',
        'YYYYMMDD"T"HH24MISS"Z"')
      else to_char(p_ends_on, 'YYYYMMDD')
    end;
  end if;
  return v_rule;
end
$$;

-- Every change of a zone's offset from Jan 1 of one year to Dec 31 of another, from the database's own
-- time zone data: the offset is read once a week and a week with a different offset at its two ends is
-- bisected to the second. For each change: which one of its year it is (j), its month, weekday, wall-clock
-- time before the change, which weekday of the month it is (n-th, and whether it is the last) and the
-- offsets either side. (Two changes inside one week that cancel out would be missed; they leave a year
-- with fewer changes than the others, which zone_definition refuses.)
create function agent_private.zone_transitions(p_zone text, p_from_year integer, p_to_year integer)
returns table (yr integer, j integer, mon integer, dow integer, tod time, n integer, is_last boolean,
               o0 integer, o1 integer, wall timestamp)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_s bigint := extract(epoch from make_timestamptz(p_from_year, 1, 1, 12, 0, 0, 'UTC'))::bigint;
  v_end bigint := extract(epoch from make_timestamptz(p_to_year, 12, 31, 12, 0, 0, 'UTC'))::bigint;
  v_next bigint;
  v_lo bigint;
  v_hi bigint;
  v_mid bigint;
  v_o0 integer := agent_private.tz_offset(p_zone, to_timestamp(v_s));
  v_o1 integer;
  v_wall timestamp;
  v_last_year integer := 0;
  v_j integer := 0;
begin
  while v_s < v_end loop
    v_next := least(v_s + 604800, v_end);
    v_o1 := agent_private.tz_offset(p_zone, to_timestamp(v_next));
    if v_o1 <> v_o0 then
      v_lo := v_s;
      v_hi := v_next;
      while v_hi - v_lo > 1 loop
        v_mid := (v_lo + v_hi) / 2;
        if agent_private.tz_offset(p_zone, to_timestamp(v_mid)) = v_o1 then
          v_hi := v_mid;
        else
          v_lo := v_mid;
        end if;
      end loop;
      v_wall := (to_timestamp(v_hi) at time zone 'UTC') + make_interval(secs => v_o0);
      yr := extract(year from v_wall)::integer;
      v_j := case when yr = v_last_year then v_j + 1 else 1 end;
      v_last_year := yr;
      j := v_j;
      mon := extract(month from v_wall)::integer;
      dow := extract(dow from v_wall)::integer;
      tod := v_wall::time;
      n := (extract(day from v_wall)::integer - 1) / 7 + 1;
      is_last := extract(day from v_wall)::integer + 7
                 > extract(day from (date_trunc('month', v_wall) + interval '1 month' - interval '1 day'))::integer;
      o0 := v_o0;
      o1 := v_o1;
      wall := v_wall;
      return next;
    end if;
    v_s := v_next;
    v_o0 := v_o1;
  end loop;
end
$$;

-- What an iCalendar VTIMEZONE needs for a zone: the yearly offset changes (daylight saving) as RRULEs, or
-- null when they can not be written as a yearly rule that is right from p_from_year to 31 years later.
-- Every change in that span, read from the database's zone data, must fall on the same month, weekday,
-- "n-th or last" place, wall-clock time and offsets every year; otherwise null, and the caller sends such
-- a series as separate events (a rule that is wrong is never produced). A zone with no change at all gives
-- one observance.
-- {"tzid", "from_year", "observances": [{"kind": STANDARD|DAYLIGHT, "from": "-0500", "to": "-0600",
--   "dtstart": "20251102T020000", "rrule": "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"}]}
create function agent_private.zone_definition(p_zone text, p_from_year integer) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_to_year integer := p_from_year + 31;
  v_tr jsonb;
  v_obs jsonb := '[]'::jsonb;
  v_changes integer;
  v_years_with integer;
  v_min integer;
  v_max integer;
  v_const integer;
  v_byday text;
  r record;
begin
  if p_from_year < 1971 or p_from_year > 2200
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_zone) then
    return null;
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.wall), '[]'::jsonb) into v_tr
    from agent_private.zone_transitions(p_zone, p_from_year, v_to_year) t;
  select coalesce(sum(x.k), 0), count(*), min(x.k), max(x.k) into v_changes, v_years_with, v_min, v_max
    from (select t.yr, count(*) as k
            from jsonb_to_recordset(v_tr) as t (yr integer) group by t.yr) x;
  if v_changes = 0 then
    select min(agent_private.tz_offset(p_zone, to_timestamp(g.s))) into v_const
      from generate_series(extract(epoch from make_timestamptz(p_from_year, 1, 1, 12, 0, 0, 'UTC'))::bigint,
                           extract(epoch from make_timestamptz(v_to_year, 12, 31, 12, 0, 0, 'UTC'))::bigint,
                           604800) g (s);
    return jsonb_build_object('tzid', p_zone, 'from_year', p_from_year, 'observances', jsonb_build_array(
      jsonb_build_object('kind', 'STANDARD', 'from', agent_private.fmt_offset(v_const),
                         'to', agent_private.fmt_offset(v_const), 'dtstart', '19700101T000000')));
  end if;
  if v_years_with <> v_to_year - p_from_year + 1 or v_min <> v_max or v_max > 4 then
    return null;
  end if;
  for r in
    select t.j, count(distinct (t.mon, t.dow, t.tod, t.o0, t.o1)) as patterns, count(distinct t.n) as ns,
           bool_and(t.is_last) as always_last, min(t.n) as n, min(t.mon) as mon, min(t.dow) as dow,
           min(t.o0) as o0, min(t.o1) as o1, min(t.wall) as first_wall
      from jsonb_to_recordset(v_tr) as t (yr integer, j integer, mon integer, dow integer, tod time, n integer,
                                          is_last boolean, o0 integer, o1 integer, wall timestamp)
     group by t.j order by t.j
  loop
    if r.patterns <> 1 then
      return null;
    end if;
    if r.ns = 1 and r.n <= 4 then
      v_byday := r.n::text;
    elsif r.always_last then
      v_byday := '-1';
    else
      return null;
    end if;
    v_obs := v_obs || jsonb_build_array(jsonb_build_object(
      'kind', case when r.o1 > r.o0 then 'DAYLIGHT' else 'STANDARD' end,
      'from', agent_private.fmt_offset(r.o0), 'to', agent_private.fmt_offset(r.o1),
      'dtstart', to_char(r.first_wall, 'YYYYMMDD"T"HH24MISS'),
      'rrule', 'FREQ=YEARLY;BYMONTH=' || r.mon || ';BYDAY=' || v_byday
               || (array['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'])[r.dow + 1]));
  end loop;
  return jsonb_build_object('tzid', p_zone, 'from_year', p_from_year, 'observances', v_obs);
end
$$;

-- The events and series of the caller's team that fall in a window, as the caller sees them (RLS; the
-- public tools that call it start with the connector guard), in
-- iCalendar's terms. An event is in the window when it overlaps it, or when it is an occurrence of a
-- repeating event whose original slot is in it (so a moved occurrence reaches the receiver as the
-- exception it is). p_changed_since keeps only events changed after it; series are never filtered by it
-- (a deleted occurrence leaves no trace on any event but shows in the series' skipped dates).
--   event:  id (the app's), uid, summary, description, location, category, url, last_modified, all_day,
--           all-day: start_date, end_date_exclusive; timed: start, end, timezone, start_utc, end_utc;
--           my_answer, partstat; occurrence of a series: series_uid, recurrence_id, is_exception
--   series: series_uid, summary, description, location, category, url, all_day, the first occurrence's
--           start in the same two forms, timezone, rrule, exdates, until
create function agent_private.event_data(
  p_person text, p_workspace text, p_from date, p_until date, p_changed_since timestamptz) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_tz text;
  v_events jsonb;
  v_more boolean;
  v_series jsonb;
begin
  select w.timezone into v_tz from public.workspaces w where w.id = p_workspace;

  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 500), '[]'::jsonb),
         coalesce(bool_or(x.rn > 500), false)
    into v_events, v_more
    from (select row_number() over (order by e.date, coalesce(e.start_time, time '00:00'), e.id) as rn,
                 jsonb_strip_nulls(jsonb_build_object(
                   'id', e.id,
                   'uid', e.id || '@events.invalid',
                   'summary', e.name,
                   'description', nullif(e.notes, ''),
                   'location', nullif(e.location, ''),
                   'category', k.name,
                   'url', e.ticket_url,
                   'last_modified', agent_private.fmt_utc(e.updated_at),
                   'all_day', e.start_time is null,
                   'start_date', case when e.start_time is null then e.date end,
                   'end_date_exclusive', case when e.start_time is null then t.last_day + 1 end,
                   'start', agent_private.fmt_local(t.s_loc),
                   'end', agent_private.fmt_local(t.e_loc),
                   'timezone', case when e.start_time is not null then v_tz end,
                   'start_utc', agent_private.fmt_utc(agent_private.zoned_instant(t.s_loc, v_tz)),
                   'end_utc', agent_private.fmt_utc(agent_private.zoned_instant(t.e_loc, v_tz)),
                   'series_uid', case when e.series_id is not null then e.series_id || '@series.invalid' end,
                   'recurrence_id', case when e.series_id is null then null
                                         when s.start_time is null then to_jsonb(e.series_date)
                                         else to_jsonb(agent_private.fmt_local(e.series_date + s.start_time)) end,
                   'is_exception', case when e.series_id is null then null
                     else coalesce(cardinality(e.series_overrides), 0) > 0
                          or e.date is distinct from e.series_date
                          or (e.name, e.notes, e.location, e.ticket_url, e.start_time, e.end_time, e.category_id,
                              coalesce(e.end_date - e.date, 0))
                             is distinct from
                             (s.name, s.notes, s.location, s.ticket_url, s.start_time, s.end_time, s.category_id,
                              s.length_days)
                   end))
                 || jsonb_build_object(
                      'my_answer', a.desire_to_attend,
                      'partstat', case a.desire_to_attend when 'yes' then 'ACCEPTED' when 'no' then 'DECLINED'
                                    when 'maybe' then 'TENTATIVE' else 'NEEDS-ACTION' end) as j
            from public.events e
            left join public.event_categories k on k.id = e.category_id
            left join public.attendances a on a.event_id = e.id and a.person_id = p_person
            left join public.event_series s on s.id = e.series_id
           cross join lateral (
             select coalesce(e.end_date, e.date) as last_day,
                    e.date + e.start_time as s_loc,
                    case when e.start_time is null then null
                         when e.end_time is not null then coalesce(e.end_date, e.date) + e.end_time
                         when coalesce(e.end_date, e.date) > e.date then (coalesce(e.end_date, e.date) + 1)::timestamp
                    end as e_loc) t
           where e.workspace_id = p_workspace
             and ((coalesce(e.end_date, e.date) >= p_from and e.date <= p_until)
                  or (e.series_id is not null and e.series_date between p_from and p_until))
             and (p_changed_since is null or e.updated_at > p_changed_since)
           order by e.date, coalesce(e.start_time, time '00:00'), e.id
           limit 501) x;

  select coalesce(jsonb_agg(y.j order by y.starts_on, y.id), '[]'::jsonb) into v_series
    from (select s.id, s.starts_on,
                 jsonb_strip_nulls(jsonb_build_object(
                   'series_uid', s.id || '@series.invalid',
                   'summary', s.name,
                   'description', nullif(s.notes, ''),
                   'location', nullif(s.location, ''),
                   'category', k.name,
                   'url', s.ticket_url,
                   'all_day', s.start_time is null,
                   'start_date', case when s.start_time is null then s.starts_on end,
                   'end_date_exclusive', case when s.start_time is null then s.starts_on + s.length_days + 1 end,
                   'start', agent_private.fmt_local(t.s_loc),
                   'end', agent_private.fmt_local(t.e_loc),
                   'start_utc', agent_private.fmt_utc(agent_private.zoned_instant(t.s_loc, v_tz)),
                   'end_utc', agent_private.fmt_utc(agent_private.zoned_instant(t.e_loc, v_tz)),
                   'timezone', v_tz,
                   'rrule', agent_private.series_rrule(s.freq, s.starts_on, s.ends_on, s.start_time is not null, v_tz),
                   'until', case when s.ends_on is null then null
                                 when s.start_time is null then to_jsonb(s.ends_on)
                                 else to_jsonb(agent_private.fmt_utc(
                                        agent_private.zoned_instant((s.ends_on + 1)::timestamp, v_tz)
                                        - interval '1 second')) end))
                 || jsonb_build_object('exdates', (
                      select coalesce(jsonb_agg(case when s.start_time is null then to_jsonb(d)
                                                     else to_jsonb(agent_private.fmt_local(d + s.start_time)) end
                                                order by d), '[]'::jsonb)
                        from unnest(s.skipped) d)) as j
            from public.event_series s
            left join public.event_categories k on k.id = s.category_id
           cross join lateral (
             select s.starts_on + s.start_time as s_loc,
                    case when s.start_time is null then null
                         when s.end_time is not null then s.starts_on + s.length_days + s.end_time
                         when s.length_days > 0 then (s.starts_on + s.length_days + 1)::timestamp
                    end as e_loc) t
           where s.workspace_id = p_workspace
             and ((coalesce(s.ends_on, p_from) >= p_from and s.starts_on <= p_until)
                  or exists (select 1 from public.events e
                              where e.series_id = s.id
                                and ((coalesce(e.end_date, e.date) >= p_from and e.date <= p_until)
                                     or e.series_date between p_from and p_until)))) y;

  return jsonb_build_object('timezone', v_tz, 'truncated', v_more, 'events', v_events, 'series', v_series);
end
$$;

-- The window of a call: from (default the team's today), until (default 8 weeks after from, at most 26
-- weeks after it; a later date is cut back and `capped` says so).
create function agent_private.event_window(p_workspace text, p_from date, p_until date)
returns table (w_from date, w_until date, capped boolean, problem text)
language plpgsql
stable
set search_path = ''
as $$
begin
  w_from := coalesce(p_from, public.workspace_today(p_workspace));
  w_until := coalesce(p_until, w_from + 56);
  if w_from < date '2000-01-01' or w_from > date '2100-01-01' then
    problem := 'from must be a date between 2000-01-01 and 2100-01-01.';
  elsif w_until < w_from then
    problem := 'until must not be before from.';
  end if;
  capped := w_until > w_from + 182;
  w_until := least(w_until, w_from + 182);
  return next;
end
$$;

-- The team's events and repeating events in a window, as iCalendar describes them (see the helpers above):
-- from (date, default the team's today), until (date, default 8 weeks after from, at most 26 weeks after
-- it), changed_since (a time: only events changed after it). Result: {from, until, capped, timezone,
-- truncated, events: [...], series: [...]}. Events are cut at 500 (`truncated`).
create function public.agent_list_upcoming_events(
  p_from date default null, p_until date default null, p_changed_since timestamptz default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  w record;
  v_args jsonb := jsonb_build_object('from', p_from, 'until', p_until, 'changed_since', p_changed_since);
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select * into w from agent_private.event_window(c.workspace_id, p_from, p_until);
  if w.problem is not null then
    perform agent_private.audit(c.connection_id, 'list_upcoming_events', v_args, 'refused: ' || w.problem);
    return jsonb_build_object('error', w.problem);
  end if;
  v_out := jsonb_build_object('from', w.w_from, 'until', w.w_until, 'capped', w.capped)
           || agent_private.event_data(c.person_id, c.workspace_id, w.w_from, w.w_until, p_changed_since);
  perform agent_private.audit(c.connection_id, 'list_upcoming_events', v_args,
                              jsonb_array_length(v_out -> 'events') || ' events, '
                              || jsonb_array_length(v_out -> 'series') || ' series');
  return v_out;
end
$$;

-- The same window as an iCalendar file: this function returns the data (the events and series as above,
-- plus the zone's VTIMEZONE rules when a timed repeating series needs them: `timezone_definition`, null
-- when none does or when the zone's rules can not be written as a yearly rule), and the Edge Function
-- writes it out as text (supabase/functions/agent/ics.ts).
create function public.agent_export_events_ics(p_from date default null, p_until date default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  w record;
  v_args jsonb := jsonb_build_object('from', p_from, 'until', p_until);
  v_data jsonb;
  v_year integer;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select * into w from agent_private.event_window(c.workspace_id, p_from, p_until);
  if w.problem is not null then
    perform agent_private.audit(c.connection_id, 'export_events_ics', v_args, 'refused: ' || w.problem);
    return jsonb_build_object('error', w.problem);
  end if;
  v_data := agent_private.event_data(c.person_id, c.workspace_id, w.w_from, w.w_until, null);
  select min(substr(s ->> 'start', 1, 4)::integer) - 1 into v_year
    from jsonb_array_elements(v_data -> 'series') s
   where (s ->> 'all_day')::boolean = false;
  v_out := jsonb_build_object('from', w.w_from, 'until', w.w_until, 'capped', w.capped)
           || v_data
           || jsonb_build_object('timezone_definition',
                case when v_year is null then null
                     else agent_private.zone_definition(v_data ->> 'timezone', v_year) end);
  perform agent_private.audit(c.connection_id, 'export_events_ics', v_args,
                              jsonb_array_length(v_out -> 'events') || ' events, '
                              || jsonb_array_length(v_out -> 'series') || ' series');
  return v_out;
end
$$;

-- The caller's own answer to an event: yes, no or maybe. Never anyone else's.
create function public.agent_set_event_answer(p_event_id text, p_answer text) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('event_id', p_event_id, 'answer', p_answer);
  v_old jsonb;
  v_new jsonb;
begin
  select * into c from agent_private.ctx(true);
  if p_answer is null or p_answer not in ('yes', 'no', 'maybe') then
    perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'refused: answer must be yes, no or maybe');
    return jsonb_build_object('error', 'The answer must be yes, no or maybe.');
  end if;
  if p_event_id is null or not exists (select 1 from public.events e where e.id = p_event_id) then
    perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'refused: no such event');
    return jsonb_build_object('error', 'No such event.');
  end if;
  select jsonb_build_object('event_id', a.event_id, 'answer', a.desire_to_attend) into v_old
    from public.attendances a where a.event_id = p_event_id and a.person_id = c.person_id;
  insert into public.attendances (event_id, person_id, desire_to_attend)
  values (p_event_id, c.person_id, p_answer)
  on conflict (event_id, person_id) do update set desire_to_attend = excluded.desire_to_attend;
  select jsonb_build_object('event_id', a.event_id, 'answer', a.desire_to_attend) into v_new
    from public.attendances a where a.event_id = p_event_id and a.person_id = c.person_id;
  perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'set ' || p_answer, v_old, v_new);
  return v_new;
end
$$;

-- Only the signed-in role may run them (the connector switches to it), and
-- every one of them is refused by agent_private.ctx() unless it was reached
-- through the connector.
revoke all on function
  public.agent_whoami(), public.agent_list_prospects(int), public.agent_add_prospect(text, text),
  public.agent_update_prospect(text, jsonb), public.agent_list_upcoming_events(date, date, timestamptz),
  public.agent_export_events_ics(date, date), public.agent_set_event_answer(text, text)
  from public, anon, service_role;
grant execute on function
  public.agent_whoami(), public.agent_list_prospects(int), public.agent_add_prospect(text, text),
  public.agent_update_prospect(text, jsonb), public.agent_list_upcoming_events(date, date, timestamptz),
  public.agent_export_events_ics(date, date), public.agent_set_event_answer(text, text)
  to authenticated;

-- The helpers are called by the tools above, which run as the signed-in role. None is reachable from
-- outside: agent_private is not exposed by the Data API, and event_data reads as the caller, so it shows
-- nothing the caller's row-level security would not show them anyway.
revoke all on function
  agent_private.tz_offset(text, timestamptz), agent_private.fmt_offset(integer),
  agent_private.zoned_instant(timestamp, text), agent_private.fmt_local(timestamp),
  agent_private.fmt_utc(timestamptz), agent_private.series_rrule(text, date, date, boolean, text),
  agent_private.zone_transitions(text, integer, integer), agent_private.zone_definition(text, integer),
  agent_private.event_data(text, text, date, date, timestamptz), agent_private.event_window(text, date, date)
  from public, anon, service_role;
grant execute on function
  agent_private.tz_offset(text, timestamptz), agent_private.fmt_offset(integer),
  agent_private.zoned_instant(timestamp, text), agent_private.fmt_local(timestamp),
  agent_private.fmt_utc(timestamptz), agent_private.series_rrule(text, date, date, boolean, text),
  agent_private.zone_transitions(text, integer, integer), agent_private.zone_definition(text, integer),
  agent_private.event_data(text, text, date, date, timestamptz), agent_private.event_window(text, date, date)
  to authenticated;
