-- Moving an occurrence of a repeating event on the calendar (migration 20261116000100_move_event_occurrences):
-- move_event_one ("Move just this one": the occurrence leaves its series, its old date is never made again),
-- move_event_series_following ("Move all": this and later occurrences shift together with the rule, earlier ones stay,
-- answers stay on the same events) and restore_event_move (the Undo).
--
-- Seed facts (src/data/seed.ts): Maria (1) is the leader, Marcus (6) her deputy, Anita (2) a moderator, Jamal (4) an
-- apprentice under Anita, Tasha (700) under Jamal, Beau (20) a candidate. A second team (w2, leader 902) is made below.
-- Every date is relative to "today" in the team's time zone. All rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(106);

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
-- The id of a series' k-th occurrence (1 = the first, by date of its place).
create function pg_temp.nth(p_series text, p_k integer) returns text language sql stable as
  $$ select id from public.events where series_id = p_series order by series_date offset p_k - 1 limit 1 $$;
-- A series' occurrence dates (where they are, not their places), as days from today, e.g. '3 10 17'.
create function pg_temp.days(p_series text) returns text language sql stable as
  $$ select coalesce(string_agg((date - pg_temp.today())::text, ' ' order by series_date), '')
       from public.events where series_id = p_series $$;
-- The same for the places in the rule.
create function pg_temp.places(p_series text) returns text language sql stable as
  $$ select coalesce(string_agg((series_date - pg_temp.today())::text, ' ' order by series_date), '')
       from public.events where series_id = p_series $$;
create function pg_temp.d(p_event text) returns integer language sql stable as
  $$ select (date - pg_temp.today())::int from public.events where id = p_event $$;
-- Remember an id or a value (a table, because an event's place changes while a test runs).
create table public.t_ids (k text primary key, v text);
grant all on public.t_ids to authenticated;
create function pg_temp.keep(p_k text, p_id text) returns void language sql as
  $$ insert into public.t_ids values (p_k, p_id) $$;
create function pg_temp.kept(p_k text) returns text language sql stable as
  $$ select v from public.t_ids where k = p_k $$;
-- What a database job or a copy of the app that doesn't know about series would do: make a series' later
-- occurrences vanish without a trace (so the next top-up has to make them again).
create function pg_temp.drain(p_series text) returns integer language plpgsql as $$
declare
  v_role text := current_user;
  v_n integer;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('app.series_internal', 'on', true);
  delete from public.events where series_id = p_series and date >= pg_temp.today();
  get diagnostics v_n = row_count;
  perform set_config('app.series_internal', '', true);
  perform set_config('role', v_role, true);
  return v_n;
end $$;
-- series_fill() is internal: the tests call it as the database does, then go back.
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

-- Grants and settings ----------------------------------------------------------------------------------
select ok(has_function_privilege('authenticated', 'public.move_event_one(text, date, date)', 'execute')
          and has_function_privilege('authenticated', 'public.move_event_series_following(text, integer)', 'execute')
          and has_function_privilege('authenticated', 'public.restore_event_move(jsonb, jsonb, text[])', 'execute')
          and not has_function_privilege('anon', 'public.move_event_one(text, date, date)', 'execute')
          and not has_function_privilege('anon', 'public.move_event_series_following(text, integer)', 'execute')
          and not has_function_privilege('anon', 'public.restore_event_move(jsonb, jsonb, text[])', 'execute'),
  'the three move functions: signed-in people yes, anon no');
select ok(not has_function_privilege('authenticated', 'public.series_slot_index(text, date, date)', 'execute')
          and not has_function_privilege('authenticated', 'public.series_move_slot(text, date, integer, date, integer, date)', 'execute'),
  'the two helpers are not callable by clients');
select ok((select count(*) = 3 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('move_event_one', 'move_event_series_following', 'restore_event_move')),
  'each move function is security definer with search_path set to nothing');
select ok((select count(*) = 2 and bool_and(not p.prosecdef and 'search_path=""' = any(p.proconfig))
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname in ('series_slot_index', 'series_move_slot')),
  'the helpers are plain functions with search_path set to nothing');

-- The helpers: places of a rule, and where a place goes when the rule moves ---------------------------
select is(public.series_slot_index('weekly', '2026-11-17', '2026-12-08'), 3, 'a weekly rule: Dec 8 is its fourth place (n = 3)');
select is(public.series_slot_index('weekly', '2026-11-17', '2026-12-09'), null, 'a date that is not a place has none');
select is(public.series_slot_index('weekly', '2026-11-17', '2026-11-10'), null, 'nor one before the start');
select is(public.series_slot_index('monthly_date', '2026-01-31', '2026-02-28'), 1, 'a monthly rule counts months (the 31st in February is the 28th)');
select is(public.series_move_slot('weekly', '2026-11-17', 2, '2026-12-03', 2, '2026-12-08'), '2026-12-10'::date,
  'weekly: a place moves by exactly the days');
select is(public.series_move_slot('monthly_weekday', '2026-11-10', 0, '2026-11-16', 6, '2026-12-08'), '2026-12-21'::date,
  'monthly on a weekday: the place of the next month is that month''s own (2nd Tuesday moved to the 3rd Monday: Dec 21)');
select is(public.series_move_slot('weekly', '2026-11-17', 2, '2026-12-03', 2, '2026-12-09'), '2026-12-11'::date,
  'a date that is no place just shifts');

-- Setup: Maria's weekly Info session at +3 days with times, a roster row and a "going" on the 4th occurrence -------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, start_time, end_time, location, format)
  values ('mv-a', 'Weekly info', 'w1-info_session', pg_temp.today() + 3, '19:00', '20:30', 'Dallas, TX', 'in_person')$$,
  'Maria adds an event with a start and an end time');
select lives_ok($$select public.make_event_repeat('mv-a', 'weekly', null)$$, 'and makes it repeat weekly');
select pg_temp.keep('a', pg_temp.sid('mv-a'));
select is(pg_temp.days(pg_temp.kept('a')), '3 10 17 24 31 38 45 52', 'it has the next 8 weeks');
select lives_ok($$insert into public.attendances (event_id, person_id, attended)
  values (pg_temp.nth(pg_temp.kept('a'), 3), '4', true)$$, 'Jamal is on the roster of the 3rd occurrence');
select pg_temp.keep('a3', pg_temp.nth(pg_temp.kept('a'), 3));
select pg_temp.keep('a2', pg_temp.nth(pg_temp.kept('a'), 2));

-- Move just this one ----------------------------------------------------------------------------------------
select lives_ok($$select public.move_event_one(pg_temp.kept('a2'), pg_temp.today() + 12, null)$$,
  'Maria moves the 2nd occurrence (day 10) to day 12, just that one');
select is((select series_id is null and series_date is null and series_overrides is null
             from public.events where id = pg_temp.kept('a2')), true, 'it is a one-time event now');
select is(pg_temp.d(pg_temp.kept('a2')), 12, 'on its new day');
select is((select to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') from public.events where id = pg_temp.kept('a2')),
  '19:00-20:30', 'with its start and end time');
select is((select name || '/' || location from public.events where id = pg_temp.kept('a2')), 'Weekly info/Dallas, TX',
  'and what else it had');
select is(pg_temp.days(pg_temp.kept('a')), '3 17 24 31 38 45 52', 'the series has its other occurrences where they were');
select is((select skipped from public.event_series where id = pg_temp.kept('a')), array[(pg_temp.today() + 10)]::date[],
  'its old day is kept as a skipped date');

-- Length is kept (a one-day event can't be stretched by a move), a date is needed, and it has to be part of a series
select throws_ok($$select public.move_event_one(pg_temp.kept('a3'), pg_temp.today() + 20, pg_temp.today() + 22)$$, '22023', null,
  'a move that would change the length is refused');
select throws_ok($$select public.move_event_one(pg_temp.kept('a3'), null, null)$$, '23514', null, 'and one with no date');
select throws_ok($$select public.move_event_one(pg_temp.kept('a3'), pg_temp.today() + 20, pg_temp.today() + 19)$$, '23514', null,
  'and one that ends before it starts');
select throws_ok($$select public.move_event_one(pg_temp.kept('a2'), pg_temp.today() + 20, null)$$, '22023', null,
  'an event that no longer repeats (the one just moved) is not part of this: that is a plain update');

-- The occurrence with a roster row, and the first occurrence
select lives_ok($$select public.move_event_one(pg_temp.kept('a3'), pg_temp.today() + 19, null)$$, 'the 3rd occurrence (day 17) goes to day 19');
select is((select count(*)::int from public.attendances where event_id = pg_temp.kept('a3') and person_id = '4' and attended), 1,
  'the roster row is still on the same event');
select lives_ok($$select public.move_event_one('mv-a', pg_temp.today() + 4, null)$$, 'the first occurrence (day 3) goes to day 4');
select is(pg_temp.days(pg_temp.kept('a')), '24 31 38 45 52', 'the rest of the series is as it was');
select is((select starts_on from public.event_series where id = pg_temp.kept('a')), pg_temp.today() + 3,
  'the series still counts from its first place (day 3)');
select is((select skipped from public.event_series where id = pg_temp.kept('a')),
  array[pg_temp.today() + 3, pg_temp.today() + 10, pg_temp.today() + 17]::date[], 'and the three places are skipped');

-- A top-up never brings the places back, however many times it runs
select is(pg_temp.drain(pg_temp.kept('a')) > 0, true, 'the occurrences still in the series vanish without a trace (a stand-in for a lost job)');
select lives_ok($$select public.topup_event_series()$$, 'the next top-up runs');
select lives_ok($$select public.topup_event_series()$$, 'and again');
select is(pg_temp.days(pg_temp.kept('a')), '24 31 38 45 52', 'it makes the series again without the three places that were moved out');
select is((select count(*)::int from public.events where series_id = pg_temp.kept('a')
             and series_date in (pg_temp.today() + 3, pg_temp.today() + 10, pg_temp.today() + 17)), 0, 'nothing is made on a moved place');
select is((select count(*)::int from public.events where id in (pg_temp.kept('a2'), pg_temp.kept('a3'), 'mv-a')), 3,
  'the three moved events are still there, once each');
select pg_temp.logout();

-- Undo of "just this one" -----------------------------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$select public.restore_event_move(
  jsonb_build_array(jsonb_build_object('id', pg_temp.kept('a2'), 'date', pg_temp.today() + 10, 'end_date', null,
    'series_id', pg_temp.kept('a'), 'series_date', pg_temp.today() + 10, 'series_overrides', null)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.kept('a'), 'starts_on', pg_temp.today() + 3, 'ends_on', null,
    'skipped', jsonb_build_array(pg_temp.today() + 3, pg_temp.today() + 17))),
  '{}')$$, 'Undo puts the occurrence back into its series and the series'' skipped dates back');
select is(pg_temp.d(pg_temp.kept('a2')), 10, 'it is on its old day');
select is((select series_id from public.events where id = pg_temp.kept('a2')), pg_temp.kept('a'), 'in its series');
select is((select skipped from public.event_series where id = pg_temp.kept('a')),
  array[pg_temp.today() + 3, pg_temp.today() + 17]::date[], 'and its place is no longer skipped');
select pg_temp.logout();

-- Move all, from the middle of a series ---------------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, start_time, end_time)
  values ('mv-b', 'Tuesday night', 'w1-info_session', pg_temp.today() + 4, '18:00', '19:00')$$, 'Maria adds another event');
select lives_ok($$select public.make_event_repeat('mv-b', 'weekly', pg_temp.today() + 60)$$, 'weekly, ending on day 60');
select pg_temp.keep('b', pg_temp.sid('mv-b'));
select is(pg_temp.days(pg_temp.kept('b')), '4 11 18 25 32 39 46 53', 'eight occurrences');
select pg_temp.keep('b4', pg_temp.nth(pg_temp.kept('b'), 4));
select lives_ok($$insert into public.attendances (event_id, person_id, attended) values (pg_temp.kept('b4'), '4', false)$$,
  'a roster row on the 4th (day 25)');
select lives_ok($$update public.events set location = 'Room 9' where id = pg_temp.nth(pg_temp.kept('b'), 5)$$,
  'the 5th (day 32) has a change of its own');
select pg_temp.keep('before', (select string_agg(id, ',' order by id) from public.events where series_id = pg_temp.kept('b')));
select lives_ok($$select public.move_event_series_following(pg_temp.kept('b4'), 2)$$, 'Maria moves the 4th and later by 2 days');
select pg_temp.keep('b2', pg_temp.sid(pg_temp.kept('b4')));
select is((select count(*)::int from public.event_series where name = 'Tuesday night' and workspace_id = 'w1'), 2,
  'the series split: a new one for this and the later ones');
select isnt(pg_temp.kept('b2'), pg_temp.kept('b'), 'the moved ones are in the new one');
select is(pg_temp.days(pg_temp.kept('b')), '4 11 18', 'the first three stay with the old series, where they were');
select is((select ends_on from public.event_series where id = pg_temp.kept('b')), pg_temp.today() + 24,
  'the old series now ends the day before the moved place');
select is(pg_temp.days(pg_temp.kept('b2')), '27 34 41 48 55', 'this and the later ones are 2 days on');
select is(pg_temp.places(pg_temp.kept('b2')), '27 34 41 48 55', 'and so are their places in the new rule');
select is((select starts_on from public.event_series where id = pg_temp.kept('b2')), pg_temp.today() + 27, 'the new series starts there');
select is((select ends_on from public.event_series where id = pg_temp.kept('b2')), pg_temp.today() + 62, 'and its end moved with it');
select is((select to_char(start_time, 'HH24:MI') || '-' || to_char(end_time, 'HH24:MI') || '/' || coalesce(location, '')
             from public.events where id = pg_temp.kept('b4')), '18:00-19:00/', 'times are as they were');
select is((select count(*)::int from public.attendances where event_id = pg_temp.kept('b4') and person_id = '4'), 1,
  'the roster row is still on the same event');
select is((select count(*)::int from public.events e where e.series_id = pg_temp.kept('b2')
             and e.location = 'Room 9' and e.series_overrides = array['location']), 1,
  'the change of its own is still on the event it was on');
select is((select string_agg(id, ',' order by id) from public.events where series_id in (pg_temp.kept('b'), pg_temp.kept('b2'))),
  pg_temp.kept('before'), 'the same events, none made and none gone');

-- Undo of "Move all": the series is put back together, the new one dropped, the old one's end restored
select lives_ok($$select public.restore_event_move(
  (select jsonb_agg(jsonb_build_object('id', e.id, 'date', e.date - 2, 'end_date', null, 'series_id', pg_temp.kept('b'),
     'series_date', e.date - 2, 'series_overrides', case when e.location = 'Room 9' then jsonb_build_array('location') end))
     from public.events e where e.series_id = pg_temp.kept('b2')),
  jsonb_build_array(jsonb_build_object('id', pg_temp.kept('b'), 'starts_on', pg_temp.today() + 4,
    'ends_on', pg_temp.today() + 60, 'skipped', '[]'::jsonb)),
  array[pg_temp.kept('b2')])$$, 'Undo: events back in the old series, its rule back, the new series dropped');
select is(pg_temp.days(pg_temp.kept('b')), '4 11 18 25 32 39 46 53', 'all eight are where they were');
select is((select count(*)::int from public.event_series where id = pg_temp.kept('b2')), 0, 'the series the move made is gone');
select is((select ends_on from public.event_series where id = pg_temp.kept('b')), pg_temp.today() + 60, 'the old series ends where it did');
select is((select count(*)::int from public.events where series_id = pg_temp.kept('b') and series_overrides = array['location']), 1,
  'the change of its own is still marked');
select throws_ok($$select public.restore_event_move('[]', '[]', array[pg_temp.kept('b')])$$, '22023', null,
  'a series that still has events is never dropped');

-- ...and moved again, the top-up lands on the new weekday
select lives_ok($$select public.move_event_series_following(pg_temp.kept('b4'), 2)$$, 'moved again');
select pg_temp.keep('b3', pg_temp.sid(pg_temp.kept('b4')));
select is(pg_temp.drain(pg_temp.kept('b3')) > 0, true, 'the moved occurrences vanish without a trace');
select lives_ok($$select public.topup_event_series()$$, 'the top-up runs');
select is((select count(*)::int from public.events e where e.series_id = pg_temp.kept('b3')), 5, 'it makes the new series: 5 places, 8 weeks ahead (27 to 55)');
select is((select count(*)::int from public.events e where e.series_id = pg_temp.kept('b3')
             and extract(dow from e.date) <> extract(dow from (pg_temp.today() + 27))), 0,
  'every one lands on the new weekday');
select is((select count(*)::int from public.events e where e.series_id = pg_temp.kept('b') and e.date > pg_temp.today() + 24), 0,
  'and none is made on the old part');
select is((select count(*)::int from (select series_date from public.events where series_id in (pg_temp.kept('b'), pg_temp.kept('b3'))
             group by series_id, series_date having count(*) > 1) q), 0, 'one occurrence per place');
select pg_temp.logout();

-- Move all, the first occurrence: the series moves in place -------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('mv-c', 'Weekly three', 'w1-info_session', pg_temp.today() + 6)$$,
  'Maria adds a third event');
select lives_ok($$select public.make_event_repeat('mv-c', 'weekly', pg_temp.today() + 90)$$, 'weekly, ending on day 90');
select pg_temp.keep('c', pg_temp.sid('mv-c'));
select lives_ok($$select public.move_event_one(pg_temp.nth(pg_temp.kept('c'), 3), pg_temp.today() + 21, null)$$,
  'its third occurrence (day 20) is moved out of the series');
select lives_ok($$select public.move_event_series_following('mv-c', -1)$$, 'the whole series moves a day earlier from its first occurrence');
select is((select count(*)::int from public.event_series where id = pg_temp.kept('c')), 1, 'it moved in place: the same series');
select is((select starts_on from public.event_series where id = pg_temp.kept('c')), pg_temp.today() + 5, 'starting a day earlier');
select is((select ends_on from public.event_series where id = pg_temp.kept('c')), pg_temp.today() + 89, 'ending a day earlier');
select is((select skipped from public.event_series where id = pg_temp.kept('c')), array[pg_temp.today() + 19]::date[],
  'and its skipped place moved with it (day 20 to 19)');
select is(pg_temp.days(pg_temp.kept('c')), '5 12 26 33 40 47 54', 'every occurrence is a day earlier (the one moved out is not part of it)');
select is(pg_temp.d('mv-c'), 5, 'the dragged one too');
select is(pg_temp.drain(pg_temp.kept('c')) > 0, true, 'the occurrences vanish without a trace');
select lives_ok($$select public.topup_event_series()$$, 'a top-up after');
select is((select count(*)::int from public.events where series_id = pg_temp.kept('c') and date = pg_temp.today() + 19), 0,
  'does not make the skipped place');
select pg_temp.keep('c2', pg_temp.nth(pg_temp.kept('c'), 2));
select pg_temp.keep('c4', pg_temp.nth(pg_temp.kept('c'), 4));
select pg_temp.logout();

-- Who may -----------------------------------------------------------------------------------------------------
select pg_temp.login('4');
select throws_ok($$select public.move_event_one(pg_temp.kept('c2'), pg_temp.today() + 40, null)$$, '42501', null,
  'Jamal (neither the creator nor a leader) can''t move one of Maria''s occurrences on its own');
select throws_ok($$select public.move_event_series_following(pg_temp.kept('c2'), 1)$$, '42501', null, 'nor the whole series');
select throws_ok($$select public.restore_event_move(jsonb_build_array(jsonb_build_object('id', pg_temp.kept('c2'),
  'date', pg_temp.today() + 12, 'end_date', null, 'series_id', pg_temp.kept('c'), 'series_date', pg_temp.today() + 12,
  'series_overrides', null)), '[]', '{}')$$, '42501', null, 'nor restore one');
select pg_temp.logout();

select pg_temp.login('700');
select throws_ok($$select public.move_event_series_following(pg_temp.kept('c2'), 1)$$, '42501', null, 'Tasha can''t either');
select pg_temp.logout();

select pg_temp.login('6');
select lives_ok($$select public.move_event_series_following(pg_temp.kept('c4'), 1)$$, 'Marcus, Maria''s deputy, can');
select pg_temp.logout();

select pg_temp.login('2');
select lives_ok($$select public.move_event_one(pg_temp.kept('c2'), pg_temp.today() + 13, null)$$,
  'Anita, a moderator, can move one on its own');
select pg_temp.logout();

-- A series of someone's own: they may move it ------------------------------------------------------------------
select pg_temp.login('4');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('mv-j', 'Jamal weekly', 'w1-work_session', pg_temp.today() + 2)$$,
  'Jamal adds an event');
select lives_ok($$select public.make_event_repeat('mv-j', 'weekly', null)$$, 'that repeats');
select pg_temp.keep('j', pg_temp.sid('mv-j'));
select lives_ok($$select public.move_event_series_following('mv-j', 3)$$, 'he moves all of his own');
select is(pg_temp.d('mv-j'), 5, 'it is 3 days later');
select throws_ok($$select public.move_event_series_following(pg_temp.nth(pg_temp.kept('j'), 2), 0)$$, '22023', null,
  'moving by no days is refused');
select throws_ok($$select public.move_event_series_following('mv-nope', 1)$$, '22023', null, 'an event that does not exist is refused');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('mv-j2', 'Jamal once', 'w1-work_session', pg_temp.today() + 50)$$,
  'Jamal adds a one-time event');
select throws_ok($$select public.restore_event_move(jsonb_build_array(jsonb_build_object('id', 'mv-j2', 'date', pg_temp.today() + 50,
  'end_date', null, 'series_id', null, 'series_date', null, 'series_overrides', null)),
  jsonb_build_array(jsonb_build_object('id', pg_temp.kept('c'), 'starts_on', pg_temp.today() + 1, 'ends_on', null, 'skipped', '[]'::jsonb)), '{}')$$,
  '42501', null, 'a restore can''t rewrite the rule of a series none of the listed events belongs to');
select pg_temp.logout();
-- One of the later occurrences of his series is not his to edit: the whole move is refused
select lives_ok($$update public.events set created_by = '1' where id = pg_temp.nth(pg_temp.kept('j'), 4)$$,
  'a later occurrence of Jamal''s series is Maria''s (set by hand)');
select pg_temp.login('4');
select throws_ok($$select public.move_event_series_following(pg_temp.nth(pg_temp.kept('j'), 2), 1)$$, '42501', null,
  'moving all from before it is refused: it is not his to move');
select pg_temp.logout();

-- Another team ---------------------------------------------------------------------------------------------------
insert into public.workspaces (id, name) values ('w2', 'Other team');
insert into public.people (id, workspace_id, name, biz_class, business_start_date)
values ('902', 'w2', 'Olivia Other', 'ibo', current_date - 900);
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000902',
        'authenticated', 'authenticated', 'olivia2@other.test');
insert into public.members (workspace_id, person_id, user_id, role)
values ('w2', '902', '00000000-0000-4000-8000-000000000902', 'leader');
select pg_temp.login('902');
select throws_ok($$select public.move_event_series_following(pg_temp.kept('c2'), 1)$$, '22023', null,
  'the other team''s leader can''t move an occurrence of this team''s series (it isn''t there for them)');
select throws_ok($$select public.move_event_one(pg_temp.kept('c2'), pg_temp.today() + 30, null)$$, '22023', null, 'nor one on its own');
select throws_ok($$select public.restore_event_move(jsonb_build_array(jsonb_build_object('id', pg_temp.kept('c2'),
  'date', pg_temp.today() + 12, 'end_date', null, 'series_id', null, 'series_date', null, 'series_overrides', null)), '[]', '{}')$$,
  'P0002', null, 'nor restore it');
select pg_temp.logout();

-- A signed-out caller ------------------------------------------------------------------------------------------------
select throws_ok($$select public.move_event_one('mv-a', pg_temp.today() + 1, null)$$, '42501', null, 'no one signed in: refused');

select * from finish();
rollback;
