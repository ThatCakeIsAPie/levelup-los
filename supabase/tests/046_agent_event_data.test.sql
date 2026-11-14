-- Agent connector: event data in iCalendar's terms (migration 20261105000200_agent_tools): list_upcoming_events
-- (from, until, changed_since, the result shape for all-day, timed, multi-day, repeating and changed
-- occurrences, series with RRULE / EXDATE / UNTIL), export_events_ics (the data the .ics is written from),
-- the window caps, start_utc on both sides of a daylight-saving change in more than one zone, the RRULE of every
-- repeat rule against series_nth_date for the first 24 slots (an RRULE expander for the forms the function emits,
-- written here in SQL), row-level security (everyone sees the team's events, each only their own answer) and
-- the audit rows. Self-contained (workspaces agw and agy), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(137);

-- Test team agw (America/Chicago): leader Lena (agl), apprentice Alex (aga), IBO Bea (agb). A second team agy
-- has an event of its own. Connections: 1 Alex write, 2 Alex read, 3 Bea write, 4 Lena write.
create function pg_temp.as_connector(p_who text, p_conn int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', ('00000000-0000-4000-8000-0000000a900' || case p_who when 'l' then '1' when 'a' then '2' else '3' end)::uuid,
    'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', ('00000000-0000-4000-8000-00000000c00' || p_conn)::uuid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.agent_connection_id', '', true);
end $$;
create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare
  v_prev text := current_setting('role');
  v text;
begin
  perform set_config('role', 'postgres', true);
  execute p_sql into v;
  perform set_config('role', v_prev, true);
  return v;
end $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000c00' || p_n)::uuid $$;
create function pg_temp.hash(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'utf8')), 'hex') $$;
create function pg_temp.audits(p_conn int) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || '''')::int $$;
-- A pgTAP session is not opened by the connector role, so the one question "was this session opened by the
-- connector?" is answered yes for the tests of the tools (see 042 and 043; the real check is 043 and the
-- integration test).
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;
-- The list of a window, and one event of it, as the signed-in agent gets them.
create function pg_temp.lst(p_from date, p_until date, p_since timestamptz default null) returns jsonb
language sql as $$ select public.agent_list_upcoming_events(p_from, p_until, p_since) $$;
create function pg_temp.ev(p_id text, p_from date default '2026-11-01', p_until date default '2026-12-31') returns jsonb
language sql as $$ select e from jsonb_array_elements(pg_temp.lst(p_from, p_until) -> 'events') e where e ->> 'id' = p_id $$;
create function pg_temp.sr(p_uid text, p_from date default '2026-11-01', p_until date default '2026-12-31') returns jsonb
language sql as $$ select s from jsonb_array_elements(pg_temp.lst(p_from, p_until) -> 'series') s where s ->> 'series_uid' = p_uid $$;
create function pg_temp.ids(p_list jsonb, p_key text default 'events', p_not_like text default 'agr%') returns text
language sql as $$
  select coalesce(string_agg(x ->> (case when p_key = 'events' then 'id' else 'series_uid' end), ',' order by (x ->> (case when p_key = 'events' then 'id' else 'series_uid' end)) collate "C"), '')
    from jsonb_array_elements(p_list -> p_key) x where (x ->> (case when p_key = 'events' then 'id' else 'series_uid' end)) not like p_not_like $$;

-- An independent RRULE expander for the forms the function emits (RFC 5545 3.3.10): DAILY, WEEKLY with
-- INTERVAL, MONTHLY with BYMONTHDAY (positive or negative), BYDAY with an ordinal, BYSETPOS. It gives the first
-- p_n dates from the start date; UNTIL is ignored here. Written from the RFC, not from series_nth_date.
create function pg_temp.rr(p_rule text, p_start date, p_n integer) returns date[] language plpgsql as $$
declare
  v_freq text;
  v_interval integer := 1;
  v_bymd integer[];
  v_byday text;
  v_setpos integer;
  v_part text;
  v_res date[] := '{}';
  v_m date;
  v_last date;
  v_cands date[];
  v_v integer;
  v_ord integer;
  v_wd integer;
  v_days date[];
  v_d date;
  k integer;
begin
  foreach v_part in array string_to_array(p_rule, ';') loop
    case split_part(v_part, '=', 1)
      when 'FREQ' then v_freq := split_part(v_part, '=', 2);
      when 'INTERVAL' then v_interval := split_part(v_part, '=', 2)::integer;
      when 'BYMONTHDAY' then v_bymd := string_to_array(split_part(v_part, '=', 2), ',')::integer[];
      when 'BYDAY' then v_byday := split_part(v_part, '=', 2);
      when 'BYSETPOS' then v_setpos := split_part(v_part, '=', 2)::integer;
      when 'UNTIL' then null;
      else raise exception 'the expander does not know %', v_part;
    end case;
  end loop;
  if v_freq = 'DAILY' then
    for k in 0 .. p_n - 1 loop v_res := v_res || (p_start + k * v_interval); end loop;
  elsif v_freq = 'WEEKLY' then
    for k in 0 .. p_n - 1 loop v_res := v_res || (p_start + 7 * k * v_interval); end loop;
  elsif v_freq = 'MONTHLY' then
    v_m := date_trunc('month', p_start)::date;
    while coalesce(cardinality(v_res), 0) < p_n loop
      v_last := (v_m + interval '1 month')::date - 1;
      v_cands := '{}';
      if v_bymd is not null then
        foreach v_v in array v_bymd loop
          v_d := case when v_v > 0 then v_m + (v_v - 1) else v_last + 1 + v_v end;
          if v_d between v_m and v_last then v_cands := v_cands || v_d; end if;
        end loop;
      elsif v_byday is not null then
        v_ord := substring(v_byday from '^-?[0-9]+')::integer;
        v_wd := array_position(array['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], right(v_byday, 2)) - 1;
        v_days := '{}';
        for k in 0 .. (v_last - v_m) loop
          if extract(dow from v_m + k)::integer = v_wd then v_days := v_days || (v_m + k); end if;
        end loop;
        v_d := case when v_ord > 0 then v_days[v_ord] else v_days[cardinality(v_days) + 1 + v_ord] end;
        if v_d is not null then v_cands := array[v_d]; end if;
      end if;
      v_cands := array(select distinct c from unnest(v_cands) c order by c);
      if v_setpos is not null then
        v_d := case when v_setpos > 0 then v_cands[v_setpos] else v_cands[cardinality(v_cands) + 1 + v_setpos] end;
        v_cands := case when v_d is null then '{}'::date[] else array[v_d] end;
      end if;
      foreach v_d in array v_cands loop
        if v_d >= p_start then v_res := v_res || v_d; end if;
      end loop;
      v_m := (v_m + interval '1 month')::date;
    end loop;
  else
    raise exception 'the expander does not know FREQ=%', v_freq;
  end if;
  return v_res[1:p_n];
end $$;
-- The first 24 dates of a rule as the app's own function gives them.
create function pg_temp.app24(p_freq text, p_anchor date) returns date[] language sql as $$
  select array(select public.series_nth_date(p_freq, p_anchor, n) from generate_series(0, 23) n order by n) $$;
-- How many anchors in a run of days have an RRULE whose first 24 dates differ from the app's.
create function pg_temp.mismatches(p_freq text, p_first date, p_days integer) returns integer language sql as $$
  select count(*)::integer from generate_series(0, p_days - 1) k
   where pg_temp.rr(agent_private.series_rrule(p_freq, p_first + k, null, false, 'UTC'), p_first + k, 24)
         is distinct from pg_temp.app24(p_freq, p_first + k) $$;

-- The fixture -----------------------------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('agw', 'Agent Test Team'), ('agy', 'Other Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date, pipeline_stage) values
  ('agl', 'agw', 'Lena Leader', 'ibo', null, current_date - 900, 'ibo'),
  ('aga', 'agw', 'Alex Apprentice', 'apprentice', 'agl', current_date - 100, 'apprentice'),
  ('agb', 'agw', 'Bea Ibo', 'ibo', 'agl', current_date - 700, 'ibo');
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-8000-0000000a900' || n)::uuid,
       'authenticated', 'authenticated', 'agent-ev-' || n || '@agent.test'
  from generate_series(1, 3) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('agw', 'agl', '00000000-0000-4000-8000-0000000a9001', 'leader'),
  ('agw', 'aga', '00000000-0000-4000-8000-0000000a9002', 'member'),
  ('agw', 'agb', '00000000-0000-4000-8000-0000000a9003', 'member');
insert into public.feature_switches (workspace_id, feature, enabled) values ('agw', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access) values
  (pg_temp.conn(1), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'Alex write', pg_temp.hash('key-1'), 'write'),
  (pg_temp.conn(2), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'Alex read', pg_temp.hash('key-2'), 'read'),
  (pg_temp.conn(3), '00000000-0000-4000-8000-0000000a9003', 'agb', 'agw', 'Bea write', pg_temp.hash('key-3'), 'write'),
  (pg_temp.conn(4), '00000000-0000-4000-8000-0000000a9001', 'agl', 'agw', 'Lena write', pg_temp.hash('key-4'), 'write');

-- Single events (the team is on Central time).
insert into public.events (id, workspace_id, name, category_id, date, end_date, location, notes, ticket_url, start_time, end_time) values
  ('agev-day', 'agw', 'Training day', 'agw-conference', '2026-11-10', null, 'Hall A', 'Wear a badge', 'https://tickets.example.test/day', null, null),
  ('agev-timed', 'agw', 'Evening call', 'agw-conference', '2026-11-12', null, null, null, null, '19:00', '20:30'),
  ('agev-noend', 'agw', 'Open house', 'agw-conference', '2026-11-13', null, '', '', null, '18:00', null),
  ('agev-multi', 'agw', 'Summit', 'agw-conference', '2026-11-20', '2026-11-22', 'Austin', null, null, '17:00', '11:00'),
  ('agev-multi-noend', 'agw', 'Retreat', 'agw-conference', '2026-11-27', '2026-11-28', null, null, null, '09:00', null),
  ('agev-multi-day', 'agw', 'Convention', 'agw-conference', '2026-12-04', '2026-12-06', 'Dallas', null, null, null, null),
  ('agev-oneday-end', 'agw', 'Same day end date', 'agw-conference', '2026-12-09', '2026-12-09', null, null, null, null, null),
  ('agev-spring-a', 'agw', 'Before spring', 'agw-conference', '2026-03-07', null, null, null, null, '19:00', '20:00'),
  ('agev-spring-b', 'agw', 'After spring', 'agw-conference', '2026-03-09', null, null, null, null, '19:00', '20:00'),
  ('agev-gap', 'agw', 'In the gap', 'agw-conference', '2026-03-08', null, null, null, null, '02:30', '04:30'),
  ('agev-fall-a', 'agw', 'Before fall', 'agw-conference', '2026-10-31', null, null, null, null, '19:00', '20:00'),
  ('agev-fall-b', 'agw', 'After fall', 'agw-conference', '2026-11-02', null, null, null, null, '19:00', '20:00'),
  ('agev-amb', 'agw', 'In the repeated hour', 'agw-conference', '2026-11-01', null, null, null, null, '01:30', '02:30'),
  ('agev-sydney-a', 'agw', 'Sydney before', 'agw-conference', '2026-04-04', null, null, null, null, '19:00', '20:00'),
  ('agev-sydney-b', 'agw', 'Sydney after', 'agw-conference', '2026-04-06', null, null, null, null, '19:00', '20:00'),
  ('agev-past', 'agw', 'Long ago', 'agw-conference', '2026-10-01', null, null, null, null, null, null),
  ('agev-foreign', 'agy', 'Other team''s event', 'agy-conference', '2026-11-10', null, null, null, null, null, null);
-- Events around today, for the default window and its caps.
insert into public.events (id, workspace_id, name, category_id, date, end_date)
select 'agr-' || d, 'agw', 'Relative ' || d, 'agw-conference', public.workspace_today('agw') + d,
       case when d = 0 then public.workspace_today('agw') + 1 end
  from unnest(array[-3, 0, 1, 56, 57, 182, 183]) d;

-- Repeating events. The guard trigger lets a series' own functions write the series columns; so does this.
select set_config('app.series_internal', 'on', true);
insert into public.event_series (id, workspace_id, freq, starts_on, ends_on, skipped, name, category_id, location, notes, length_days, start_time, end_time) values
  ('agsw', 'agw', 'weekly', '2026-11-02', null, '{2026-11-16}', 'Business briefing', 'agw-conference', 'Room 5', 'Bring a guest', 0, '19:00', '20:00'),
  ('agsm', 'agw', 'monthly_date', '2026-01-31', null, '{}', 'Month end review', 'agw-conference', null, null, 0, null, null),
  ('agst', 'agw', 'monthly_weekday', '2026-11-10', '2027-02-09', '{2026-12-08}', 'Second Tuesday', 'agw-conference', null, null, 0, null, null),
  ('agsx', 'agw', 'biweekly', '2026-10-01', '2026-12-31', '{}', 'Early call', 'agw-conference', null, null, 0, '07:00', null),
  ('agsd', 'agw', 'daily', '2026-11-25', null, '{}', 'Daily stand-up', 'agw-conference', null, null, 0, '08:00', '08:15'),
  ('agso', 'agw', 'weekly', '2026-01-05', '2026-06-30', '{}', 'Ended long ago', 'agw-conference', null, null, 0, null, null),
  ('agsf', 'agw', 'weekly', '2027-06-01', null, '{}', 'Starts much later', 'agw-conference', null, null, 0, null, null);
insert into public.events (id, workspace_id, name, category_id, date, end_date, location, notes, start_time, end_time, series_id, series_date, series_overrides) values
  ('agsw-1102', 'agw', 'Business briefing', 'agw-conference', '2026-11-02', null, 'Room 5', 'Bring a guest', '19:00', '20:00', 'agsw', '2026-11-02', null),
  ('agsw-1109', 'agw', 'Business briefing', 'agw-conference', '2026-11-09', null, 'Room 5', 'Bring a guest', '19:00', '20:00', 'agsw', '2026-11-09', null),
  ('agsw-1123', 'agw', 'Special briefing', 'agw-conference', '2026-11-24', null, 'Room 5', 'Bring a guest', '19:00', '20:00', 'agsw', '2026-11-23', '{date,name}'),
  ('agsw-1130', 'agw', 'Business briefing', 'agw-conference', '2026-11-30', null, 'Room 5', 'Bring a guest', '20:00', '21:00', 'agsw', '2026-11-30', '{end_time,start_time}'),
  ('agsw-1207', 'agw', 'Silently different', 'agw-conference', '2026-12-07', null, 'Room 5', 'Bring a guest', '19:00', '20:00', 'agsw', '2026-12-07', null),
  ('agsw-1214', 'agw', 'Business briefing', 'agw-conference', '2027-03-01', null, 'Room 5', 'Bring a guest', '19:00', '20:00', 'agsw', '2026-12-14', '{date}'),
  ('agsm-1130', 'agw', 'Month end review', 'agw-conference', '2026-11-30', null, null, null, null, null, 'agsm', '2026-11-30', null),
  ('agst-1110', 'agw', 'Second Tuesday', 'agw-conference', '2026-11-10', null, null, null, null, null, 'agst', '2026-11-10', null);
select set_config('app.series_internal', '', true);
-- Past times of last change, as a program reading them would find them (the trigger puts now() back otherwise).
alter table public.events disable trigger events_touch_updated_at;
update public.events set updated_at = '2026-01-01 12:00+00' where workspace_id in ('agw', 'agy');
update public.events set updated_at = '2026-06-15 08:30:45.5+00' where id = 'agev-timed';
alter table public.events enable trigger events_touch_updated_at;

select pg_temp.pretend_connector_session();

-- The result: all-day, timed, multi-day ------------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select is(pg_temp.ev('agev-day'),
  '{"id": "agev-day", "uid": "agev-day@events.invalid", "summary": "Training day", "description": "Wear a badge", "location": "Hall A",
    "category": "Conference", "url": "https://tickets.example.test/day", "last_modified": "2026-01-01T12:00:00Z", "all_day": true,
    "start_date": "2026-11-10", "end_date_exclusive": "2026-11-11", "my_answer": null, "partstat": "NEEDS-ACTION"}'::jsonb,
  'an all-day event: uid, summary, description, location, category, url, last_modified, start_date and the day after as end_date_exclusive');
select is(pg_temp.ev('agev-timed'),
  '{"id": "agev-timed", "uid": "agev-timed@events.invalid", "summary": "Evening call", "category": "Conference",
    "last_modified": "2026-06-15T08:30:45Z", "all_day": false, "start": "2026-11-12T19:00:00", "end": "2026-11-12T20:30:00",
    "timezone": "America/Chicago", "start_utc": "2026-11-13T01:00:00Z", "end_utc": "2026-11-13T02:30:00Z",
    "my_answer": null, "partstat": "NEEDS-ACTION"}'::jsonb,
  'a timed event: local start and end without offset, the zone, and UTC instants; nothing for what it lacks');
select is(pg_temp.ev('agev-noend') ? 'end', false, 'a timed one-day event with no end time has no end');
select is(pg_temp.ev('agev-noend') ? 'end_utc', false, 'and no end_utc');
select is(pg_temp.ev('agev-noend') ? 'location' or pg_temp.ev('agev-noend') ? 'description', false, 'an empty location or notes is left out');
select is(pg_temp.ev('agev-noend') ->> 'start_utc', '2026-11-14T00:00:00Z', 'its start is 18:00 Central standard time = 00:00 UTC');
select is(pg_temp.ev('agev-multi') ->> 'start', '2026-11-20T17:00:00', 'a multi-day timed event starts at its start time on the first day');
select is(pg_temp.ev('agev-multi') ->> 'end', '2026-11-22T11:00:00', 'and ends at its end time on the last day');
select is(pg_temp.ev('agev-multi') ->> 'end_utc', '2026-11-22T17:00:00Z', 'in UTC too');
select is(pg_temp.ev('agev-multi-noend') ->> 'end', '2026-11-29T00:00:00', 'a multi-day timed event with no end time runs to the end of its last day (the app''s own .ics does the same)');
select is(pg_temp.ev('agev-multi-day') ->> 'start_date', '2026-12-04', 'a multi-day all-day event: first day');
select is(pg_temp.ev('agev-multi-day') ->> 'end_date_exclusive', '2026-12-07', 'and the day after the last as the exclusive end');
select is(pg_temp.ev('agev-oneday-end') ->> 'end_date_exclusive', '2026-12-10', 'an end date equal to the date is a one-day event');
select is(pg_temp.ev('agev-day') ? 'start' or pg_temp.ev('agev-day') ? 'timezone' or pg_temp.ev('agev-day') ? 'start_utc', false, 'an all-day event has no local start, zone or UTC instants');
select is(pg_temp.ev('agev-timed') ? 'start_date' or pg_temp.ev('agev-timed') ? 'end_date_exclusive', false, 'a timed one has no start_date or end_date_exclusive');
select is(pg_temp.ev('agev-day') ? 'sequence' or pg_temp.ev('agev-day') ? 'series_uid' or pg_temp.ev('agev-day') ? 'recurrence_id', false,
  'no sequence (there is no correct one), and a single event has no series fields');
select is((pg_temp.lst('2026-11-01', '2026-12-31') -> 'events' -> 0 ->> 'uid') like '%@events.invalid', true, 'the uid is the event id plus a fixed suffix');

-- Daylight saving: start_utc on each side of a change, in two zones ---------------------------------------
select is(pg_temp.ev('agev-spring-a', '2026-03-01', '2026-03-31') ->> 'start_utc', '2026-03-08T01:00:00Z', 'Central, the evening before the spring change: 19:00 CST = 01:00 UTC next day');
select is(pg_temp.ev('agev-spring-b', '2026-03-01', '2026-03-31') ->> 'start_utc', '2026-03-10T00:00:00Z', 'the evening after it: 19:00 CDT = 00:00 UTC the next day');
select is(pg_temp.ev('agev-gap', '2026-03-01', '2026-03-31') ->> 'start_utc', '2026-03-08T08:30:00Z', 'a time that never happens (02:30 on the spring day) moves on by the gap: 03:30 CDT');
select is(pg_temp.ev('agev-fall-a', '2026-10-28', '2026-11-05') ->> 'start_utc', '2026-11-01T00:00:00Z', 'the evening before the autumn change: 19:00 CDT = 00:00 UTC');
select is(pg_temp.ev('agev-fall-b', '2026-10-28', '2026-11-05') ->> 'start_utc', '2026-11-03T01:00:00Z', 'the evening after it: 19:00 CST = 01:00 UTC the next day');
select is(pg_temp.ev('agev-amb', '2026-10-28', '2026-11-05') ->> 'start_utc', '2026-11-01T06:30:00Z', 'a time that happens twice (01:30 on the autumn day) is the first one, as in the app and RFC 5545');
select is(pg_temp.ev('agev-amb', '2026-10-28', '2026-11-05') ->> 'end_utc', '2026-11-01T08:30:00Z', 'and 02:30 after the change is the only 02:30');
select pg_temp.as_postgres();
update public.workspaces set timezone = 'Australia/Sydney' where id = 'agw';
select pg_temp.as_connector('a', 1);
select is(pg_temp.ev('agev-sydney-a', '2026-04-01', '2026-04-30') ->> 'start_utc', '2026-04-04T08:00:00Z', 'Sydney, the evening before the autumn change: 19:00 AEDT (+11) = 08:00 UTC');
select is(pg_temp.ev('agev-sydney-b', '2026-04-01', '2026-04-30') ->> 'start_utc', '2026-04-06T09:00:00Z', 'the evening after it: 19:00 AEST (+10) = 09:00 UTC');
select is(pg_temp.ev('agev-sydney-b', '2026-04-01', '2026-04-30') ->> 'timezone', 'Australia/Sydney', 'and the zone is the workspace''s');
select pg_temp.as_postgres();
update public.workspaces set timezone = 'America/Chicago' where id = 'agw';
select is((select count(*)::int from generate_series(0, 8759) h
            where agent_private.zoned_instant(timestamp '2026-01-01' + h * interval '1 hour', 'America/Chicago')
                  <> (timestamp '2026-01-01' + h * interval '1 hour') at time zone 'America/Chicago'), 1,
  'zoned_instant equals `at time zone` for every hour of 2026 in Chicago except the one repeated hour');
select is((select count(*)::int from generate_series(0, 8759) h
            where agent_private.zoned_instant(timestamp '2026-01-01' + h * interval '1 hour', 'Europe/London')
                  <> (timestamp '2026-01-01' + h * interval '1 hour') at time zone 'Europe/London'), 1, 'and in London');
select is((select count(*)::int from generate_series(0, 8759) h
            where agent_private.zoned_instant(timestamp '2026-01-01' + h * interval '1 hour', 'Australia/Sydney')
                  <> (timestamp '2026-01-01' + h * interval '1 hour') at time zone 'Australia/Sydney'), 1, 'and in Sydney');
select is(agent_private.fmt_utc(agent_private.zoned_instant(timestamp '2026-07-04 12:00', 'Asia/Kolkata')), '2026-07-04T06:30:00Z', 'a zone with a half-hour offset and no daylight saving');

-- Repeating events: occurrences and exceptions ---------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select is(pg_temp.ev('agsw-1109'),
  '{"id": "agsw-1109", "uid": "agsw-1109@events.invalid", "summary": "Business briefing", "description": "Bring a guest", "location": "Room 5",
    "category": "Conference", "last_modified": "2026-01-01T12:00:00Z", "all_day": false, "start": "2026-11-09T19:00:00", "end": "2026-11-09T20:00:00",
    "timezone": "America/Chicago", "start_utc": "2026-11-10T01:00:00Z", "end_utc": "2026-11-10T02:00:00Z",
    "series_uid": "agsw@series.invalid", "recurrence_id": "2026-11-09T19:00:00", "is_exception": false,
    "my_answer": null, "partstat": "NEEDS-ACTION"}'::jsonb,
  'an occurrence of a repeating event: the series uid, the recurrence id (its slot, local date-time like the series) and is_exception false');
select is(pg_temp.ev('agsw-1123') ->> 'recurrence_id', '2026-11-23T19:00:00', 'a moved occurrence keeps its ORIGINAL slot as recurrence_id');
select is(pg_temp.ev('agsw-1123') ->> 'start', '2026-11-24T19:00:00', 'while its start is where it was moved to');
select is(pg_temp.ev('agsw-1123') ->> 'is_exception', 'true', 'and it is an exception (moved and renamed on its own)');
select is(pg_temp.ev('agsw-1130') ->> 'is_exception', 'true', 'an occurrence with its own time is an exception');
select is(pg_temp.ev('agsw-1130') ->> 'recurrence_id', '2026-11-30T19:00:00', 'its recurrence id is still the series'' slot time');
select is(pg_temp.ev('agsw-1207') ->> 'is_exception', 'true', 'an occurrence that differs from its series'' template is an exception even with no mark on it');
select is(pg_temp.ev('agsw-1102') ->> 'is_exception', 'false', 'an untouched occurrence is not');
select is(pg_temp.ev('agsw-1214', '2026-12-01', '2026-12-31') ->> 'start', '2027-03-01T19:00:00', 'an occurrence moved out of the window is still in it, by its original slot (the receiver must not show the slot)');
select is(pg_temp.ev('agsw-1214', '2026-12-01', '2026-12-31') ->> 'recurrence_id', '2026-12-14T19:00:00', 'with that slot as its recurrence id');
select is(pg_temp.ev('agsm-1130') ->> 'recurrence_id', '2026-11-30', 'an all-day series'' occurrence has a date as recurrence id');
select is(pg_temp.ev('agsm-1130') ->> 'series_uid', 'agsm@series.invalid', 'and its series uid');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31')),
  'agev-amb,agev-day,agev-fall-b,agev-multi,agev-multi-day,agev-multi-noend,agev-noend,agev-oneday-end,agev-timed,agsm-1130,agst-1110,agsw-1102,agsw-1109,agsw-1123,agsw-1130,agsw-1207,agsw-1214',
  'the window lists the team''s events that overlap it, and the occurrence whose slot is in it (not the past, not the other team''s)');

-- Series -------------------------------------------------------------------------------------------------------
select is(pg_temp.sr('agsw@series.invalid'),
  '{"series_uid": "agsw@series.invalid", "summary": "Business briefing", "description": "Bring a guest", "location": "Room 5",
    "category": "Conference", "all_day": false, "start": "2026-11-02T19:00:00", "end": "2026-11-02T20:00:00",
    "start_utc": "2026-11-03T01:00:00Z", "end_utc": "2026-11-03T02:00:00Z", "timezone": "America/Chicago",
    "rrule": "FREQ=WEEKLY", "exdates": ["2026-11-16T19:00:00"]}'::jsonb,
  'a timed weekly series: first start, zone, RRULE, skipped slots as local date-times, no until');
select is(pg_temp.sr('agsm@series.invalid'),
  '{"series_uid": "agsm@series.invalid", "summary": "Month end review", "category": "Conference", "all_day": true,
    "start_date": "2026-01-31", "end_date_exclusive": "2026-02-01", "timezone": "America/Chicago",
    "rrule": "FREQ=MONTHLY;BYMONTHDAY=-1", "exdates": []}'::jsonb,
  'a monthly day-31 series (all-day): first day, the last-day rule, no skipped dates');
select is(pg_temp.sr('agst@series.invalid') ->> 'rrule', 'FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270209', 'a second-Tuesday series that ends: UNTIL is a DATE for an all-day series');
select is(pg_temp.sr('agst@series.invalid') -> 'exdates', '["2026-12-08"]'::jsonb, 'its skipped slot is a date');
select is(pg_temp.sr('agsx@series.invalid') ->> 'rrule', 'FREQ=WEEKLY;INTERVAL=2;UNTIL=20270101T055959Z', 'a timed series that ends: UNTIL is a UTC date-time, the last second of that day in the team''s zone');
select is(pg_temp.sr('agsx@series.invalid') ->> 'until', '2027-01-01T05:59:59Z', 'and `until` says the same');
select is(pg_temp.sr('agsx@series.invalid') ? 'end', false, 'a timed series with no end time has no end');
select is(pg_temp.sr('agsd@series.invalid') ->> 'rrule', 'FREQ=DAILY', 'a daily series');
select is(pg_temp.sr('agsw@series.invalid') ? 'until', false, 'a series that never ends has no until');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31'), 'series'),
  'agsd@series.invalid,agsm@series.invalid,agst@series.invalid,agsw@series.invalid,agsx@series.invalid',
  'the series: every one with an occurrence in the window or still running; not the one that ended in June or the one that starts next year');

select is(pg_temp.ids(pg_temp.lst('2026-06-01', '2026-06-20'), 'series'), 'agsm@series.invalid,agso@series.invalid', 'a series that is still running (first date past, no end yet or not yet reached) is listed for a window with no occurrence of it in the database; one that starts later is not');

-- The window ---------------------------------------------------------------------------------------------------
select is(pg_temp.lst(null, null) ->> 'from', public.workspace_today('agw')::text, 'from defaults to the team''s today');
select is(pg_temp.lst(null, null) ->> 'until', (public.workspace_today('agw') + 56)::text, 'until to 8 weeks after it');
select is(pg_temp.lst(null, null) ->> 'capped', 'false', 'not capped');
select is((select string_agg(x ->> 'id', ',' order by (x ->> 'id') collate "C") from jsonb_array_elements(pg_temp.lst(null, null) -> 'events') x where x ->> 'id' like 'agr-%'),
  'agr-0,agr-1,agr-56', 'the default window holds the event running today, tomorrow''s and the one 56 days out; not the one 3 days ago or 57 days out');
select is(pg_temp.lst(null, public.workspace_today('agw') + 400) ->> 'until', (public.workspace_today('agw') + 182)::text, 'until is cut back to 26 weeks after from');
select is(pg_temp.lst(null, public.workspace_today('agw') + 400) ->> 'capped', 'true', 'and capped says so');
select is((select string_agg(x ->> 'id', ',' order by (x ->> 'id') collate "C") from jsonb_array_elements(pg_temp.lst(null, public.workspace_today('agw') + 400) -> 'events') x where x ->> 'id' like 'agr-%'),
  'agr-0,agr-1,agr-182,agr-56,agr-57', 'the event 182 days out is in the capped window, the one 183 days out is not');
select is(pg_temp.lst('2026-11-10', '2026-11-10') ->> 'until', '2026-11-10', 'a one-day window is allowed');
select is(public.agent_list_upcoming_events('2026-11-10', '2026-11-09') ->> 'error', 'until must not be before from.', 'until before from is refused with a message');
select is(public.agent_list_upcoming_events('1999-12-31', null) ->> 'error', 'from must be a date between 2000-01-01 and 2100-01-01.', 'and so is an absurd from');
select is(public.agent_list_upcoming_events('2026-11-02', '2026-11-02') -> 'events' -> 0 ->> 'id', 'agev-fall-b', 'an explicit from can be in the past');

-- changed_since ---------------------------------------------------------------------------------------------------
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31', '2026-06-01T00:00:00Z')), 'agev-timed', 'changed_since keeps only events changed after it (all others were last changed in January)');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31', '2026-06-15T08:30:45Z')), 'agev-timed', 'strictly later: a time with the event''s own whole second still returns an event changed in its fraction');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31', '2026-06-15T08:30:46Z')), '', 'and nothing once it is past');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31', '2026-06-01T00:00:00Z'), 'series'),
  'agsd@series.invalid,agsm@series.invalid,agst@series.invalid,agsw@series.invalid,agsx@series.invalid', 'series are listed whatever changed_since says (a deleted occurrence only shows in a series'' skipped dates)');
select pg_temp.as_postgres();
update public.events set location = 'Zoom' where id = 'agev-noend';
select pg_temp.as_connector('a', 1);
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31', now() - interval '1 minute')), 'agev-noend', 'an update moves updated_at: only that event is returned for the last minute');
select is(pg_temp.ev('agev-noend') ->> 'location', 'Zoom', 'with its new location');
select is((pg_temp.ev('agev-noend') ->> 'last_modified')::timestamptz > now() - interval '1 minute', true, 'and a new last_modified');

-- Answers: each person only their own ----------------------------------------------------------------------------
select is(public.agent_set_event_answer('agev-timed', 'yes') ->> 'answer', 'yes', 'Alex answers yes');
select is(public.agent_set_event_answer('agev-day', 'maybe') ->> 'answer', 'maybe', 'maybe');
select is(public.agent_set_event_answer('agev-noend', 'no') ->> 'answer', 'no', 'and no');
select is(pg_temp.ev('agev-timed') ->> 'my_answer', 'yes', 'my_answer yes');
select is(pg_temp.ev('agev-timed') ->> 'partstat', 'ACCEPTED', 'is ACCEPTED');
select is(pg_temp.ev('agev-day') ->> 'partstat', 'TENTATIVE', 'maybe is TENTATIVE');
select is(pg_temp.ev('agev-noend') ->> 'partstat', 'DECLINED', 'no is DECLINED');
select is(pg_temp.ev('agev-multi') ->> 'partstat', 'NEEDS-ACTION', 'no answer is NEEDS-ACTION');
select is(pg_temp.ev('agev-multi') -> 'my_answer', 'null'::jsonb, 'with my_answer null (present, not left out)');
select pg_temp.as_connector('b', 3);
select is(pg_temp.ev('agev-timed') -> 'my_answer', 'null'::jsonb, 'Bea sees the same event with no answer of hers');
select is(pg_temp.ev('agev-timed') ->> 'partstat', 'NEEDS-ACTION', 'not Alex''s');
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31')), (select pg_temp.q('select string_agg(id, '','' order by id collate "C") from public.events where workspace_id = ''agw'' and ((coalesce(end_date, date) >= ''2026-11-01'' and date <= ''2026-12-31'') or series_date between ''2026-11-01'' and ''2026-12-31'') and id not like ''agr%''')),
  'Bea sees every event of the team in the window, as the app shows them');
select pg_temp.as_connector('l', 4);
select is(pg_temp.ids(pg_temp.lst('2026-11-01', '2026-12-31')), (select pg_temp.q('select string_agg(id, '','' order by id collate "C") from public.events where workspace_id = ''agw'' and ((coalesce(end_date, date) >= ''2026-11-01'' and date <= ''2026-12-31'') or series_date between ''2026-11-01'' and ''2026-12-31'') and id not like ''agr%''')),
  'and the leader the same');
select is(pg_temp.ev('agev-timed') -> 'my_answer', 'null'::jsonb, 'with no answer of Alex''s');
select is(pg_temp.q('select count(*)::text from public.attendances where workspace_id = ''agw'''), '3', 'only the three answers exist');
select is(pg_temp.ev('agev-foreign') is null, true, 'another team''s event is not there');

-- The export data ---------------------------------------------------------------------------------------------------
select pg_temp.as_connector('a', 2);
select is(public.agent_export_events_ics('2026-11-01', '2026-12-31') -> 'events', pg_temp.lst('2026-11-01', '2026-12-31') -> 'events', 'the export carries the same events (a read connection may call both read tools)');
select is(public.agent_export_events_ics('2026-11-01', '2026-12-31') -> 'series', pg_temp.lst('2026-11-01', '2026-12-31') -> 'series', 'and the same series');
select is(public.agent_export_events_ics('2026-11-01', '2026-12-31') -> 'timezone_definition' ->> 'tzid', 'America/Chicago', 'with the zone''s rules for the timed series');
select is(public.agent_export_events_ics('2026-11-01', '2026-12-31') -> 'timezone_definition' -> 'observances',
  '[{"kind": "DAYLIGHT", "from": "-0600", "to": "-0500", "dtstart": "20250309T020000", "rrule": "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"},
    {"kind": "STANDARD", "from": "-0500", "to": "-0600", "dtstart": "20251102T020000", "rrule": "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU"}]'::jsonb,
  'Central: daylight time from the second Sunday of March, standard from the first Sunday of November, from the year before the earliest timed series (2025)');
select is(public.agent_export_events_ics('2026-11-08', '2026-11-09') ->> 'capped', 'false', 'the export takes the same window and cap');
select is(public.agent_export_events_ics(null, public.workspace_today('agw') + 999) ->> 'capped', 'true', 'cut back to 26 weeks too');
select is(public.agent_export_events_ics('2026-11-10', '2026-11-09') ->> 'error', 'until must not be before from.', 'and refuses until before from');
select pg_temp.as_postgres();
update public.event_series set start_time = null, end_time = null where id in ('agsw', 'agsx', 'agsd');
select pg_temp.as_connector('a', 2);
select is(public.agent_export_events_ics('2026-11-01', '2026-12-31') -> 'timezone_definition', 'null'::jsonb, 'with no timed series there is no zone definition');
select pg_temp.as_postgres();

-- Zone definitions ---------------------------------------------------------------------------------------------------------
select is(agent_private.zone_definition('America/Chicago', 2005), null::jsonb, 'Chicago from 2005: the rules changed in 2007, so no single yearly rule: null (the series is then sent as separate events)');
select is(agent_private.zone_definition('Europe/London', 2025) -> 'observances',
  '[{"kind": "DAYLIGHT", "from": "+0000", "to": "+0100", "dtstart": "20250330T010000", "rrule": "FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"},
    {"kind": "STANDARD", "from": "+0100", "to": "+0000", "dtstart": "20251026T020000", "rrule": "FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"}]'::jsonb,
  'London: the last Sunday of March and of October (a "last" rule, since it is the fourth or the fifth)');
select is(agent_private.zone_definition('Australia/Sydney', 2025) -> 'observances',
  '[{"kind": "STANDARD", "from": "+1100", "to": "+1000", "dtstart": "20250406T030000", "rrule": "FREQ=YEARLY;BYMONTH=4;BYDAY=1SU"},
    {"kind": "DAYLIGHT", "from": "+1000", "to": "+1100", "dtstart": "20251005T020000", "rrule": "FREQ=YEARLY;BYMONTH=10;BYDAY=1SU"}]'::jsonb,
  'Sydney: southern hemisphere, the first Sunday of April and of October');
select is(agent_private.zone_definition('Asia/Kolkata', 2025),
  '{"tzid": "Asia/Kolkata", "from_year": 2025, "observances": [{"kind": "STANDARD", "from": "+0530", "to": "+0530", "dtstart": "19700101T000000"}]}'::jsonb,
  'a zone with no daylight saving: one observance');
select is(agent_private.zone_definition('UTC', 2025) -> 'observances' -> 0 ->> 'to', '+0000', 'UTC');
select is(agent_private.zone_definition('Africa/Casablanca', 2025), null::jsonb, 'Morocco moves its clocks around Ramadan on dates that change every year: no yearly rule, null');
select is(agent_private.zone_definition('Not/AZone', 2025), null::jsonb, 'an unknown zone: null');
-- Independent of the function: Chicago's offset changes exactly on the second Sunday of March and the first Sunday of
-- November at 02:00 local, for 20 years (so the observances above produce every change in the span).
select is((select count(*)::int from generate_series(2026, 2045) y,
            lateral (select make_date(y, 3, 1) + ((7 - extract(dow from make_date(y, 3, 1))::int) % 7 + 7) as d_spring,
                            make_date(y, 11, 1) + ((7 - extract(dow from make_date(y, 11, 1))::int) % 7) as d_fall) x
           where agent_private.tz_offset('America/Chicago', (x.d_spring + time '07:59') at time zone 'UTC') = -21600
             and agent_private.tz_offset('America/Chicago', (x.d_spring + time '08:00') at time zone 'UTC') = -18000
             and agent_private.tz_offset('America/Chicago', (x.d_fall + time '06:59') at time zone 'UTC') = -18000
             and agent_private.tz_offset('America/Chicago', (x.d_fall + time '07:00') at time zone 'UTC') = -21600), 20,
  'Chicago''s offset changes at 08:00 UTC on the second Sunday of March and 07:00 UTC on the first Sunday of November, 2026 to 2045');

-- RRULE against the app's rule: the first 24 slots ---------------------------------------------------------------------------
select is(agent_private.series_rrule('daily', '2026-11-14', null, false, 'UTC'), 'FREQ=DAILY', 'daily');
select is(agent_private.series_rrule('weekly', '2026-11-14', null, false, 'UTC'), 'FREQ=WEEKLY', 'weekly');
select is(agent_private.series_rrule('biweekly', '2026-11-14', null, false, 'UTC'), 'FREQ=WEEKLY;INTERVAL=2', 'every 2 weeks');
select is(agent_private.series_rrule('monthly_date', '2026-11-14', null, false, 'UTC'), 'FREQ=MONTHLY;BYMONTHDAY=14', 'monthly on day 14');
select is(agent_private.series_rrule('monthly_date', '2026-02-28', null, false, 'UTC'), 'FREQ=MONTHLY;BYMONTHDAY=28', 'day 28');
select is(agent_private.series_rrule('monthly_date', '2026-01-29', null, false, 'UTC'), 'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1', 'day 29: the last of the 28th and 29th');
select is(agent_private.series_rrule('monthly_date', '2026-01-30', null, false, 'UTC'), 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1', 'day 30');
select is(agent_private.series_rrule('monthly_date', '2026-01-31', null, false, 'UTC'), 'FREQ=MONTHLY;BYMONTHDAY=-1', 'day 31: the last day');
select is(agent_private.series_rrule('monthly_weekday', '2026-11-10', null, false, 'UTC'), 'FREQ=MONTHLY;BYDAY=2TU', 'the second Tuesday');
select is(agent_private.series_rrule('monthly_weekday', '2026-11-03', null, false, 'UTC'), 'FREQ=MONTHLY;BYDAY=1TU', 'the first');
select is(agent_private.series_rrule('monthly_weekday', '2026-11-26', null, false, 'UTC'), 'FREQ=MONTHLY;BYDAY=4TH', 'the fourth Thursday');
select is(agent_private.series_rrule('monthly_weekday', '2026-01-30', null, false, 'UTC'), 'FREQ=MONTHLY;BYDAY=-1FR', 'the fifth Friday: the last one');
select is(agent_private.series_rrule('weekly', '2026-07-04', '2026-07-15', true, 'America/Chicago'), 'FREQ=WEEKLY;UNTIL=20260716T045959Z', 'UNTIL of a timed series in summer: 23:59:59 CDT is 04:59:59 UTC the next day');
select is(agent_private.series_rrule('weekly', '2026-07-04', '2026-07-15', false, 'America/Chicago'), 'FREQ=WEEKLY;UNTIL=20260715', 'and a DATE for an all-day series');
select is(pg_temp.rr('FREQ=MONTHLY;BYMONTHDAY=-1', '2028-01-31', 3), array['2028-01-31', '2028-02-29', '2028-03-31']::date[], 'the expander itself: the last day of a leap February');
select is(pg_temp.rr('FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1', '2026-01-30', 4), array['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30']::date[], 'day 30: January 30, February 28, March 30, April 30');
select is(pg_temp.rr('FREQ=MONTHLY;BYDAY=-1FR', '2026-01-30', 5), array['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29']::date[], 'the last Friday: the dates of the shared case table (cases.ts) for the fifth Friday');
select is(pg_temp.mismatches('daily', '2027-01-01', 731), 0, 'daily: the first 24 dates equal series_nth_date for every anchor in 2027 and 2028');
select is(pg_temp.mismatches('weekly', '2027-01-01', 731), 0, 'weekly: the same');
select is(pg_temp.mismatches('biweekly', '2027-01-01', 731), 0, 'every 2 weeks: the same');
select is(pg_temp.mismatches('monthly_date', '2027-01-01', 731), 0, 'monthly on a date: the same, for every day of the month in every month (days 29, 30 and 31 and the leap day among them)');
select is(pg_temp.mismatches('monthly_weekday', '2027-01-01', 731), 0, 'monthly on a weekday: the same, for every weekday and place in the month (the fifth ones among them)');

-- Audit rows: one per call, also for a refusal -----------------------------------------------------------------------------------
select pg_temp.as_connector('b', 3);
select pg_temp.as_postgres();
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access)
values (pg_temp.conn(5), '00000000-0000-4000-8000-0000000a9003', 'agb', 'agw', 'Bea fresh', pg_temp.hash('key-5'), 'write');
select pg_temp.as_connector('b', 5);
select lives_ok($$select public.agent_list_upcoming_events()$$, 'list_upcoming_events with no arguments');
select is(pg_temp.audits(5), 1, 'one audit row');
select lives_ok($$select public.agent_list_upcoming_events('2026-11-01', '2026-11-30', '2026-06-01T00:00:00Z')$$, 'with arguments');
select lives_ok($$select public.agent_export_events_ics('2026-11-01', '2026-11-30')$$, 'export_events_ics');
select lives_ok($$select public.agent_export_events_ics('2026-11-10', '2026-11-01')$$, 'export_events_ics, refused');
select lives_ok($$select public.agent_list_upcoming_events('2026-11-10', '2026-11-01')$$, 'list_upcoming_events, refused');
select is(pg_temp.audits(5), 5, 'one row each: five calls, five rows');
select is(pg_temp.q('select string_agg(tool || ''/'' || (result like ''refused%'')::text, '','' order by id) from public.agent_audit where connection_id = ''' || pg_temp.conn(5) || ''''),
  'list_upcoming_events/false,list_upcoming_events/false,export_events_ics/false,export_events_ics/true,list_upcoming_events/true', 'the tools named, the refusals marked');
select is(pg_temp.q('select arguments::text from public.agent_audit where connection_id = ''' || pg_temp.conn(5) || ''' and tool = ''list_upcoming_events'' order by id limit 1'),
  '{"from": null, "until": null, "changed_since": null}', 'the arguments are kept');
select matches(pg_temp.q('select result from public.agent_audit where connection_id = ''' || pg_temp.conn(5) || ''' and tool = ''export_events_ics'' order by id limit 1'),
  '^[0-9]+ events, [0-9]+ series$', 'the result is a count');
select pg_temp.as_postgres();

select * from finish();
rollback;
