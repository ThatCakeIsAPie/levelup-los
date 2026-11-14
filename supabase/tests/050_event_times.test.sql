-- Event start and end times and events.updated_at (migration 20261030000100_event_times).
--
-- Seed facts (src/data/seed.ts): Maria (1) is the leader, Jamal (4) an apprentice, Beau (20) a candidate.
-- Every date is relative to "today" in the team's time zone. A series that starts "3 days out" has its
-- occurrences 3, 10, 17, 24, 31, 38, 45, 52 days out (eight of them), so "occurrence 3" is the one 17 days
-- out and "occurrence 4" the one 24 days out.
begin;
create extension if not exists pgtap with schema extensions;
select plan(140);

create function pg_temp.login(p_person text) returns void language plpgsql as $$
declare
  v_uid uuid := ('00000000-0000-4000-8000-' || lpad(p_person, 12, '0'))::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'person' || p_person || '@demo.test')
  on conflict (id) do nothing;
  update public.members set user_id = v_uid where person_id = p_person and user_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-8000-' || lpad(p_person, 12, '0'), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Today in the team's time zone (America/Chicago in the seed).
create function pg_temp.today() returns date language sql stable as
  $$ select (now() at time zone 'America/Chicago')::date $$;
create function pg_temp.sid(p_event text) returns text language sql stable as
  $$ select series_id from public.events where id = p_event $$;
-- The occurrence of a series the given number of days from today (its place in the series).
create function pg_temp.at(p_series text, p_days integer) returns text language sql stable as
  $$ select id from public.events where series_id = p_series and series_date = pg_temp.today() + p_days $$;
-- An occurrence's times, as 'start-end' ('-' for none).
create function pg_temp.t(p_series text, p_days integer) returns text language sql stable as
  $$ select coalesce(to_char(start_time, 'HH24:MI'), '') || '-' || coalesce(to_char(end_time, 'HH24:MI'), '')
       from public.events where series_id = p_series and series_date = pg_temp.today() + p_days $$;
-- series_fill() is internal (clients can't call it): the tests call it as the database does, then go back.
create function pg_temp.fill(p_series text, p_plus integer) returns integer language plpgsql as $$
declare
  v_role text := current_user;
  v_n integer;
begin
  perform set_config('role', 'postgres', true);
  select count(*)::int into v_n from public.series_fill(p_series, pg_temp.today() + p_plus);
  perform set_config('role', v_role, true);
  return v_n;
end $$;
-- Sets an event's updated_at to a long-ago value without the trigger putting it back (as the table's owner).
create function pg_temp.age(p_event text) returns void language plpgsql as $$
declare
  v_role text := current_user;
begin
  perform set_config('role', 'postgres', true);
  alter table public.events disable trigger events_touch_updated_at;
  update public.events set updated_at = '2020-01-01 12:00+00' where id = p_event;
  alter table public.events enable trigger events_touch_updated_at;
  perform set_config('role', v_role, true);
end $$;

-- Schema ------------------------------------------------------------------------------------------------
select is((select data_type from information_schema.columns
            where table_schema = 'public' and table_name = 'events' and column_name = 'start_time'),
  'time without time zone', 'events.start_time is a wall-clock time');
select is((select data_type from information_schema.columns
            where table_schema = 'public' and table_name = 'events' and column_name = 'end_time'),
  'time without time zone', 'events.end_time too');
select ok((select count(*) = 4 from information_schema.columns
            where table_schema = 'public' and table_name in ('events', 'event_series')
              and column_name in ('start_time', 'end_time') and is_nullable = 'YES'),
  'the four time columns (events and event_series) are nullable: no time = all-day');
select ok((select data_type = 'timestamp with time zone' and is_nullable = 'NO' and column_default like 'now()%'
             from information_schema.columns
            where table_schema = 'public' and table_name = 'events' and column_name = 'updated_at'),
  'events.updated_at is timestamptz not null default now()');
select is((select count(*)::int from public.events where start_time is not null or end_time is not null), 0,
  'every event from before is all-day');
select is((select count(*)::int from public.events where updated_at is null), 0, 'and has an updated_at');
select ok(not has_function_privilege('authenticated', 'public.events_touch_updated_at()', 'execute')
          and not has_function_privilege('anon', 'public.events_touch_updated_at()', 'execute'),
  'the updated_at trigger function is not callable by clients');
select ok((select count(*) = 3 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('make_event_repeat', 'update_event_series_following', 'series_fill')),
  'the replaced series functions are still security definer with search_path = nothing');
select ok(has_function_privilege('authenticated', 'public.make_event_repeat(text, text, date)', 'execute')
          and has_function_privilege('authenticated', 'public.update_event_series_following(text, jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.make_event_repeat(text, text, date)', 'execute')
          and not has_function_privilege('anon', 'public.update_event_series_following(text, jsonb, jsonb)', 'execute')
          and not has_function_privilege('authenticated', 'public.series_fill(text, date)', 'execute')
          and not has_function_privilege('authenticated', 'public.events_series_guard()', 'execute'),
  'and keep their grants: signed-in people the two public ones, nobody the internals, anon nothing');

-- The rule: the same table of cases as src/data/recurrence/cases.ts (eventTimes.test.ts checks the two are identical)
create temp table t_time_cases as
select * from (values
  ('all-day', 0, null, null, true, null),
  ('all-day, multi-day', 2, null, null, true, null),
  ('start time only', 0, '19:00', null, true, null),
  ('start and end', 0, '19:00', '20:30', true, '20:30'),
  ('end after start by a minute', 0, '19:00', '19:01', true, '19:01'),
  ('end equals start, one day', 0, '19:00', '19:00', false, null),
  ('end before start, one day', 0, '19:00', '18:00', false, null),
  ('end without start', 0, null, '20:30', false, null),
  ('midnight start', 0, '00:00', '00:30', true, '00:30'),
  ('end at 23:59', 0, '23:00', '23:59', true, '23:59'),
  ('multi-day, end earlier than start', 1, '19:00', '11:00', true, '11:00'),
  ('multi-day, end equals start', 2, '09:00', '09:00', true, '09:00'),
  ('multi-day, start only', 2, '09:00', null, true, null),
  ('multi-day, end without start', 1, null, '11:00', false, null)
  ) as c(name, len, st, en, ok, fit);
select is(public.event_times_ok(c.len, c.st::time, c.en::time), c.ok, c.name || ' (allowed?)') from t_time_cases c;
select is(case when public.event_times_ok(c.len, c.st::time, c.en::time) then c.en::time end, c.fit::time,
          c.name || ' (the end time that stays)')
  from t_time_cases c;

-- The constraint on events (Maria is the leader) -------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, start_time, end_time)
  values ('t-a', 'Evening', 'w1-info_session', pg_temp.today() + 1, '19:00', '20:30')$$,
  'Maria adds an event from 7:00 to 8:30 PM');
select lives_ok($$insert into public.events (id, name, category_id, date, start_time)
  values ('t-b', 'Start only', 'w1-info_session', pg_temp.today() + 1, '19:00')$$, 'and one with only a start time');
select lives_ok($$insert into public.events (id, name, category_id, date, end_date, start_time, end_time)
  values ('t-c', 'Weekend', 'w1-conference', pg_temp.today() + 5, pg_temp.today() + 6, '19:00', '11:00')$$,
  'a two-day event may end earlier in the day than it started');
select throws_ok($$insert into public.events (name, category_id, date, end_time)
  values ('x', 'w1-info_session', pg_temp.today() + 1, '20:30')$$, '23514', null, 'an end time without a start time is refused');
select throws_ok($$insert into public.events (name, category_id, date, start_time, end_time)
  values ('x', 'w1-info_session', pg_temp.today() + 1, '19:00', '18:00')$$, '23514', null,
  'an end before the start on one day is refused');
select throws_ok($$insert into public.events (name, category_id, date, start_time, end_time)
  values ('x', 'w1-info_session', pg_temp.today() + 1, '19:00', '19:00')$$, '23514', null, 'an end equal to the start too');
select throws_ok($$insert into public.events (name, category_id, date, end_date, start_time, end_time)
  values ('x', 'w1-info_session', pg_temp.today() + 1, pg_temp.today() + 1, '19:00', '18:00')$$, '23514', null,
  'an end date equal to the date is still one day');
select throws_ok($$update public.events set end_time = '18:00' where id = 't-a'$$, '23514', null, 'an update to a bad end time is refused');
select throws_ok($$update public.events set start_time = null where id = 't-a'$$, '23514', null,
  'removing the start time but leaving the end is refused');
select lives_ok($$update public.events set start_time = null, end_time = null where id = 't-a'$$, 'removing both makes it all-day');
select is((select start_time is null and end_time is null from public.events where id = 't-a'), true, 'and it is all-day again');
select lives_ok($$update public.events set start_time = '19:00', end_time = '20:30' where id = 't-a'$$, 'a time can be set again');
select lives_ok($$update public.events set end_date = date + 1 where id = 't-c'$$, 'and a multi-day event may be edited');
select throws_ok($$update public.events set end_date = null where id = 't-c'$$, '23514', null,
  'but not made a one-day event while its end is earlier than its start');
select pg_temp.logout();
select throws_ok($$insert into public.event_series (workspace_id, freq, starts_on, name, category_id, length_days, start_time, end_time)
  values ('w1', 'weekly', pg_temp.today(), 'x', 'w1-info_session', 0, '19:00', '18:00')$$, '23514', null,
  'a series carries the same rule');
select throws_ok($$insert into public.event_series (workspace_id, freq, starts_on, name, category_id, length_days, end_time)
  values ('w1', 'weekly', pg_temp.today(), 'x', 'w1-info_session', 0, '18:00')$$, '23514', null,
  'a series end time needs a start time too');

-- A repeating event carries its times ---------------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, start_time, end_time, location)
  values ('t-t', 'Info session', 'w1-info_session', pg_temp.today() + 3, '19:00', '20:30', 'Dallas')$$,
  'Maria adds a weekly info session at 7:00 to 8:30 PM');
select lives_ok($$select public.make_event_repeat('t-t', 'weekly', null)$$, 'and makes it repeat');
select is((select start_time || '-' || end_time from public.event_series where id = pg_temp.sid('t-t')), '19:00:00-20:30:00',
  'the series takes the event''s times');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-t')
              and start_time = '19:00' and end_time = '20:30'), 8, 'all eight occurrences carry them');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-t') and series_overrides is not null), 0,
  'none of them is marked as changed on its own');
select pg_temp.logout();
select is(pg_temp.fill(pg_temp.sid('t-t'), 28), 4, 'four weeks on the series makes the next four occurrences');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-t')
              and start_time = '19:00' and end_time = '20:30'), 12, 'and they get the times too');

-- "This event": a changed time is remembered as that occurrence's own change -------------------------------
select pg_temp.login('1');
select lives_ok($$update public.events set start_time = '18:00', end_time = '19:30' where id = pg_temp.at(pg_temp.sid('t-t'), 17)$$,
  'Maria moves occurrence 3 to 6:00 to 7:30 PM on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-t'), 17)),
  array['end_time', 'start_time'], 'both times are remembered as its own');
select lives_ok($$update public.events set end_time = '21:00' where id = pg_temp.at(pg_temp.sid('t-t'), 10)$$,
  'she ends occurrence 2 later, on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-t'), 10)), array['end_time'],
  'only its end time is remembered');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-t') and series_overrides is not null), 2,
  'only those two carry marks');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-t')
              and start_time = '19:00' and end_time = '20:30'), 10, 'and the others keep 7:00 to 8:30 PM');
select lives_ok($$update public.events set name = 'Renamed' where id = pg_temp.at(pg_temp.sid('t-t'), 52)$$,
  'a rename of occurrence 8 (52 days out) on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-t'), 52)), array['name'],
  'marks only the name');
select is(pg_temp.t(pg_temp.sid('t-t'), 52), '19:00-20:30', 'and leaves its times alone');

-- "This and following" from occurrence 4 ------------------------------------------------------------------
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 24),
  '{"start_time": "17:00", "end_time": "18:30"}'::jsonb, null)$$, 'Maria changes the times from occurrence 4 (24 days out) on');
select is((select array_agg(pg_temp.t(pg_temp.sid('t-t'), d) order by d) from unnest(array[3, 10]) d),
  array['19:00-20:30', '19:00-21:00'], 'occurrences 1 and 2 are untouched (2 keeps its own end)');
select is(pg_temp.t(pg_temp.sid('t-t'), 17), '18:00-19:30', 'occurrence 3 keeps its own times');
select is((select array_agg(pg_temp.t(pg_temp.sid('t-t'), d) order by d) from unnest(array[24, 31, 38, 45, 52, 59, 66, 73]) d),
  array['17:00-18:30', '17:00-18:30', '17:00-18:30', '17:00-18:30', '17:00-18:30', '17:00-18:30', '17:00-18:30', '17:00-18:30'],
  'occurrence 4 and every later one have the new times');
select is((select start_time || '-' || end_time from public.event_series where id = pg_temp.sid('t-t')), '17:00:00-18:30:00',
  'and so does the series, for occurrences made later');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-t'), 24)), null,
  'occurrence 4 carries no mark: the series now says what it says');
select pg_temp.logout();
select is(pg_temp.fill(pg_temp.sid('t-t'), 56), 4, 'eight weeks on, four more occurrences');
select is(pg_temp.t(pg_temp.sid('t-t'), 80), '17:00-18:30', 'they get the series'' current times');

-- An edit from an earlier occurrence leaves an occurrence's own time alone; one from it overwrites it
select pg_temp.login('1');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 10),
  '{"start_time": "16:00"}'::jsonb, null)$$, 'Maria changes only the start time from occurrence 2 on');
select is(pg_temp.t(pg_temp.sid('t-t'), 3), '19:00-20:30', 'occurrence 1 is untouched');
select is(pg_temp.t(pg_temp.sid('t-t'), 10), '16:00-21:00', 'occurrence 2 takes the new start and keeps its own end');
select is(pg_temp.t(pg_temp.sid('t-t'), 17), '18:00-19:30', 'occurrence 3 keeps both of its own times');
select is(pg_temp.t(pg_temp.sid('t-t'), 24), '16:00-18:30', 'occurrence 4 takes the start and keeps the series'' end');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 17),
  '{"start_time": "15:00", "end_time": "16:00"}'::jsonb, null)$$, 'an edit that starts at occurrence 3 itself');
select is(pg_temp.t(pg_temp.sid('t-t'), 17), '15:00-16:00', 'overwrites its own times');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-t'), 17)), null,
  'and clears their marks');
select is(pg_temp.t(pg_temp.sid('t-t'), 10), '16:00-21:00', 'an earlier occurrence is not touched by it');

-- Clearing the times, and a time that no longer fits ------------------------------------------------------
select lives_ok($$update public.events set end_time = '23:00' where id = pg_temp.at(pg_temp.sid('t-t'), 45)$$,
  'occurrence 7 (45 days out) ends at 11 PM on its own');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 24),
  '{"start_time": null, "end_time": null}'::jsonb, null)$$, 'Maria clears the times from occurrence 4 on');
select is((select array_agg(pg_temp.t(pg_temp.sid('t-t'), d) order by d) from unnest(array[24, 31, 38, 45, 52, 80]) d),
  array['-', '-', '-', '-', '-', '-'], 'every one of them is all-day, also the one that had an end time of its own');
select is(pg_temp.t(pg_temp.sid('t-t'), 17), '15:00-16:00', 'an earlier occurrence keeps its times');
select ok((select start_time is null and end_time is null from public.event_series where id = pg_temp.sid('t-t')),
  'and the series makes all-day occurrences from now on');
select throws_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 52),
  '{"start_time": "19:00", "end_time": "18:00"}'::jsonb, null)$$, '23514', null, 'an end before the start is refused');
select throws_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 52),
  '{"end_time": "18:00"}'::jsonb, null)$$, '23514', null, 'so is an end time with no start time');
select throws_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-t'), 52),
  '{"starts": "19:00"}'::jsonb, null)$$, '22023', null, 'and an unknown field still is');
select is(pg_temp.t(pg_temp.sid('t-t'), 52), '-', 'a refused edit changed nothing');

-- A later occurrence of a different length: an end time that no longer fits it is dropped, not made up
select lives_ok($$insert into public.events (id, name, category_id, date, start_time, end_time)
  values ('t-v', 'Work session', 'w1-work_session', pg_temp.today() + 4, '09:00', '17:00')$$, 'Maria adds a work session 9 to 5');
select lives_ok($$select public.make_event_repeat('t-v', 'weekly', null)$$, 'and makes it repeat');
select lives_ok($$update public.events set end_time = '10:00' where id = pg_temp.at(pg_temp.sid('t-v'), 18)$$,
  'the one 18 days out ends at 10 AM on its own');
select lives_ok($$update public.events set end_date = date + 1, end_time = '08:00' where id = pg_temp.at(pg_temp.sid('t-v'), 25)$$,
  'and the one 25 days out becomes a two-day event ending at 8 AM on its own');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-v'), 11),
  '{"start_time": "11:00", "end_time": "12:00"}'::jsonb, null)$$, 'a change to 11 AM to noon from the second occurrence on');
select is(pg_temp.t(pg_temp.sid('t-v'), 11), '11:00-12:00', 'applies to it');
select is(pg_temp.t(pg_temp.sid('t-v'), 18), '11:00-', 'the one with an own 10 AM end would end before it starts: it has no end time');
select is(pg_temp.t(pg_temp.sid('t-v'), 25), '11:00-08:00', 'the two-day one keeps its own end (the next morning)');
select is(pg_temp.t(pg_temp.sid('t-v'), 32), '11:00-12:00', 'the others take both');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-v'), 11),
  format('{"end_date": "%s", "end_time": "07:30"}', pg_temp.today() + 12)::jsonb, null)$$,
  'making the series two-day events ending at 7:30 AM');
select is(pg_temp.t(pg_temp.sid('t-v'), 32), '11:00-07:30', 'later occurrences are two-day events with that end');
select is((select length_days from public.event_series where id = pg_temp.sid('t-v')), 1, 'and the series has the new length');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-v'), 11),
  '{"end_date": null, "end_time": "13:00"}'::jsonb, null)$$, 'and back to one-day events ending at 1 PM');
select is(pg_temp.t(pg_temp.sid('t-v'), 32), '11:00-13:00', 'later occurrences are one-day events again');
select is((select start_time::text || '-' || end_time::text || '-' || length_days::text
             from public.event_series where id = pg_temp.sid('t-v')), '11:00:00-13:00:00-0', 'with the series');
select pg_temp.logout();

-- A series' times when an occurrence of another length is the one edited: the template's end time is dropped
-- when it would no longer fit (here an end earlier than the start, on what is now a one-day template)
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, end_date, start_time, end_time)
  values ('t-z', 'Two-day', 'w1-conference', pg_temp.today() + 6, pg_temp.today() + 7, '19:00', '11:00')$$,
  'Maria adds a weekly two-day event from 7 PM to 11 AM');
select lives_ok($$select public.make_event_repeat('t-z', 'weekly', null)$$, 'and makes it repeat');
select lives_ok($$update public.events set end_date = null, start_time = '18:00', end_time = '20:00'
  where id = pg_temp.at(pg_temp.sid('t-z'), 13)$$, 'one occurrence becomes a one-day event, 6 to 8 PM, on its own');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-z'), 13), '{"location": "Dallas"}'::jsonb, null)$$,
  'and she edits from it on');
select is((select start_time::text || '-' || coalesce(end_time::text, 'none') || '-' || length_days::text
             from public.event_series where id = pg_temp.sid('t-z')), '19:00:00-none-0',
  'the series is one-day now and keeps no end time that would come before its start');
select is(pg_temp.t(pg_temp.sid('t-z'), 20), '19:00-11:00', 'a later two-day occurrence keeps its times');
select pg_temp.logout();

-- updated_at ----------------------------------------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('t-u', 'Updated', 'w1-info_session', pg_temp.today() + 2)$$,
  'Maria adds an event');
select is((select updated_at = now() and updated_at = created_at from public.events where id = 't-u'), true,
  'its updated_at starts at its creation');
select pg_temp.logout();
select pg_temp.age('t-u');
select pg_temp.age('t-b');
select is((select updated_at from public.events where id = 't-u'), '2020-01-01 12:00+00'::timestamptz, 'a long-ago updated_at (set with the trigger off)');
select pg_temp.login('1');
select lives_ok($$update public.events set name = 'Other event, other row' where id = 't-b'$$, 'Maria edits another event');
select is((select updated_at from public.events where id = 't-u'), '2020-01-01 12:00+00'::timestamptz, 'this one is untouched');
select lives_ok($$update public.events set location = 'Dallas' where id = 't-u'$$, 'she edits it');
select is((select updated_at = now() from public.events where id = 't-u'), true, 'its updated_at is now');
select pg_temp.logout();
select pg_temp.age('t-u');
select pg_temp.login('1');
select lives_ok($$update public.events set name = name where id = 't-u'$$, 'an update that changes nothing');
select is((select updated_at = now() from public.events where id = 't-u'), true, 'is still an update: it moves too');
select pg_temp.logout();
select pg_temp.age('t-u');
select pg_temp.login('1');
select lives_ok($$update public.events set updated_at = '2000-01-01' where id = 't-u'$$, 'she tries to write updated_at');
select is((select updated_at = now() from public.events where id = 't-u'), true, 'it is current anyway');
select pg_temp.logout();
select pg_temp.age(pg_temp.at(pg_temp.sid('t-v'), 32));
select pg_temp.login('1');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-v'), 11), '{"location": "Austin"}'::jsonb, null)$$,
  'a "this and following" edit');
select is((select updated_at = now() from public.events where id = pg_temp.at(pg_temp.sid('t-v'), 32)), true,
  'moves the updated_at of the later occurrences it changed');
select pg_temp.logout();

-- A client that knows nothing about times keeps working --------------------------------------------------
select pg_temp.login('4');
select lives_ok($$insert into public.events (id, name, category_id, date, location, format)
  values ('t-old', 'Plain event', 'w1-work_session', pg_temp.today() + 1, 'Dallas', 'in_person')$$, 'Jamal adds an event the old way');
select lives_ok($$update public.events set name = 'Plain event 2', location = 'Austin' where id = 't-old'$$, 'edits it');
select lives_ok($$select public.make_event_repeat('t-old', 'weekly', null)$$, 'makes it repeat with the same three arguments');
select ok((select start_time is null and end_time is null from public.event_series where id = pg_temp.sid('t-old')),
  'a series without times');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-old') and start_time is null and end_time is null), 8,
  'whose occurrences are all-day');
select lives_ok($$update public.events set location = 'Elsewhere', date = date + 1 where id = pg_temp.at(pg_temp.sid('t-old'), 8)$$,
  'he edits one occurrence on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-old'), 8)), array['date', 'location'],
  'the guard still marks exactly the fields he changed');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-old'), 15),
  '{"location": "Round Rock"}'::jsonb, null)$$, 'and uses "this and following" with the fields he knows');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-old') and location = 'Round Rock'), 6,
  'it changes this one and the later ones');
select pg_temp.logout();
select pg_temp.login('1');
select lives_ok($$update public.events set location = 'Fort Worth' where id = 't-a'$$,
  'an old client''s edit of a timed event (which writes no time column)');
select is((select start_time::text || '-' || end_time::text from public.events where id = 't-a'), '19:00:00-20:30:00',
  'leaves its times as they were');
select pg_temp.logout();

select * from finish();
rollback;
