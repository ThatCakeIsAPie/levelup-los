-- Repeating events (migration 20261020000100_recurring_events).
--
-- Seed facts (src/data/seed.ts): Maria (1) is the leader, Marcus (6) her deputy, Anita (2) a moderator,
-- Jamal (4) an apprentice under Anita, Tasha (700) under Jamal, Beau (20) a candidate. A second team
-- (w2, leader 901) is made below. Every date is relative to "today" in the team's time zone.
begin;
create extension if not exists pgtap with schema extensions;
select plan(217);

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
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
-- Today in the team's time zone (America/Chicago in the seed).
create function pg_temp.today() returns date language sql stable as
  $$ select (now() at time zone 'America/Chicago')::date $$;
-- The series an event belongs to, and the id of a series' k-th occurrence (1 = the first, by date of its place).
create function pg_temp.sid(p_event text) returns text language sql stable as
  $$ select series_id from public.events where id = p_event $$;
create function pg_temp.nth(p_series text, p_k integer) returns text language sql stable as
  $$ select id from public.events where series_id = p_series order by series_date offset p_k - 1 limit 1 $$;
-- How many occurrences a series has, and the most it has for one date (always 1).
create function pg_temp.n(p_series text) returns integer language sql stable as
  $$ select count(*)::int from public.events where series_id = p_series $$;
create function pg_temp.most_per_date(p_series text) returns integer language sql stable as
  $$ select coalesce(max(c), 0)::int from (select count(*)::int c from public.events
      where series_id = p_series group by series_date) q $$;
-- A series' occurrence dates, as days from today, e.g. '3 10 17'.
create function pg_temp.days(p_series text) returns text language sql stable as
  $$ select coalesce(string_agg((series_date - pg_temp.today())::text, ' ' order by series_date), '')
       from public.events where series_id = p_series $$;

-- The occurrence of a series on a date, as days from today (its place in the series).
create function pg_temp.at(p_series text, p_days integer) returns text language sql stable as
  $$ select id from public.events where series_id = p_series and series_date = pg_temp.today() + p_days $$;
-- Remember an id (a table, because an event's place changes while a test runs).
create table public.t_ids (k text primary key, v text);
grant all on public.t_ids to authenticated;
create function pg_temp.keep(p_k text, p_id text) returns void language sql as
  $$ insert into public.t_ids values (p_k, p_id) $$;
create function pg_temp.kept(p_k text) returns text language sql stable as
  $$ select v from public.t_ids where k = p_k $$;
-- What a database job or a second copy of the app that doesn't know about series would do: make a
-- series' occurrences vanish without a trace (so the next top-up has to make them again).
create function pg_temp.drain(p_series text) returns integer language plpgsql as $$
declare
  v_role text := current_user;
  v_n integer;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('app.series_internal', 'on', true);
  delete from public.events where series_id = p_series
    and series_date > (select starts_on from public.event_series where id = p_series);
  get diagnostics v_n = row_count;
  perform set_config('app.series_internal', '', true);
  perform set_config('role', v_role, true);
  return v_n;
end $$;
-- A second copy of an occurrence for a date: what two clients racing would make if nothing stopped them.
create function pg_temp.twin(p_series text, p_days integer) returns void language plpgsql as $$
declare
  v_role text := current_user;
begin
  perform set_config('role', 'postgres', true);
  perform set_config('app.series_internal', 'on', true);
  insert into public.events (workspace_id, name, category_id, date, series_id, series_date)
  values ('w1', 'Twin', 'w1-info_session', pg_temp.today() + p_days, p_series, pg_temp.today() + p_days);
exception when others then
  perform set_config('app.series_internal', '', true);
  perform set_config('role', v_role, true);
  raise;
end $$;

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

-- Existing events don't repeat; schema, grants, policies ----------------------------------------------
select ok(exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'event_series'),
  'event_series exists');
select ok((select relrowsecurity from pg_class where oid = 'public.event_series'::regclass),
  'row-level security is on for event_series');
select is((select count(*)::int from public.events where series_id is not null), 0,
  'every event from before simply doesn''t repeat');
select ok((select count(*) = 3 from information_schema.columns
            where table_schema = 'public' and table_name = 'events'
              and column_name in ('series_id', 'series_date', 'series_overrides') and is_nullable = 'YES'),
  'the three new columns on events are nullable');
select is((select array_agg(cmd order by cmd) from pg_policies
            where schemaname = 'public' and tablename = 'event_series'), array['SELECT'],
  'event_series has a read policy and nothing else');
select ok(has_table_privilege('authenticated', 'public.event_series', 'select')
          and not has_table_privilege('authenticated', 'public.event_series', 'insert')
          and not has_table_privilege('authenticated', 'public.event_series', 'update')
          and not has_table_privilege('authenticated', 'public.event_series', 'delete')
          and not has_table_privilege('anon', 'public.event_series', 'select'),
  'signed-in people may only read event_series; anon nothing');
select ok(has_function_privilege('authenticated', 'public.topup_event_series()', 'execute')
          and has_function_privilege('authenticated', 'public.make_event_repeat(text, text, date)', 'execute')
          and has_function_privilege('authenticated', 'public.update_event_series_following(text, jsonb, jsonb)', 'execute')
          and has_function_privilege('authenticated', 'public.delete_event_following(text)', 'execute')
          and not has_function_privilege('anon', 'public.topup_event_series()', 'execute')
          and not has_function_privilege('anon', 'public.make_event_repeat(text, text, date)', 'execute')
          and not has_function_privilege('anon', 'public.update_event_series_following(text, jsonb, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.delete_event_following(text)', 'execute'),
  'the four series functions: signed-in people yes, anon no');
select ok(not has_function_privilege('authenticated', 'public.series_fill(text, date)', 'execute')
          and not has_function_privilege('authenticated', 'public.event_has_dependents(text)', 'execute')
          and not has_function_privilege('authenticated', 'public.may_edit_events(text)', 'execute'),
  'the internals are not callable by clients');
select ok((select count(*) = 8 and bool_and(p.prosecdef and 'search_path=""' = any(p.proconfig))
             from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public'
              and p.proname in ('topup_event_series', 'make_event_repeat', 'update_event_series_following',
                                'delete_event_following', 'series_fill', 'event_has_dependents',
                                'may_edit_events', 'events_series_tombstone')),
  'every security definer function here sets search_path to nothing');

-- The date arithmetic: the same table of cases as src/data/recurrence/cases.ts (rule.test.ts checks the two are identical)
select is(public.series_nth_date(c.freq, c.anchor::date, c.n), c.expected::date, c.name || ' (' || c.anchor || ', n=' || c.n || ')')
  from (values
  ('weekly across the spring daylight change', 'weekly', '2026-03-02', 1, '2026-03-09'),
  ('weekly across the spring daylight change', 'weekly', '2026-03-02', 2, '2026-03-16'),
  ('weekly across the autumn daylight change', 'weekly', '2026-10-27', 1, '2026-11-03'),
  ('weekly across the autumn daylight change', 'weekly', '2026-10-27', 2, '2026-11-10'),
  ('every 2 weeks across a year end', 'biweekly', '2026-12-21', 1, '2027-01-04'),
  ('every 2 weeks across a year end', 'biweekly', '2026-12-21', 2, '2027-01-18'),
  ('every 2 weeks across a year end', 'biweekly', '2026-12-28', 1, '2027-01-11'),
  ('daily across a year end', 'daily', '2026-12-30', 2, '2027-01-01'),
  ('daily across a leap day', 'daily', '2028-02-28', 1, '2028-02-29'),
  ('daily across a leap day', 'daily', '2028-02-28', 2, '2028-03-01'),
  ('monthly on day 31 in a short month', 'monthly_date', '2026-01-31', 1, '2026-02-28'),
  ('monthly on day 31 in a 31-day month', 'monthly_date', '2026-01-31', 2, '2026-03-31'),
  ('monthly on day 31 in a 30-day month', 'monthly_date', '2026-01-31', 3, '2026-04-30'),
  ('monthly on day 31 after a short month', 'monthly_date', '2026-01-31', 4, '2026-05-31'),
  ('monthly on day 31 across a year', 'monthly_date', '2026-01-31', 13, '2027-02-28'),
  ('monthly on day 31, leap February', 'monthly_date', '2028-01-31', 1, '2028-02-29'),
  ('monthly on day 30 in February', 'monthly_date', '2026-01-30', 1, '2026-02-28'),
  ('monthly on day 14', 'monthly_date', '2026-11-14', 1, '2026-12-14'),
  ('monthly on a leap day, next month', 'monthly_date', '2028-02-29', 1, '2028-03-29'),
  ('monthly on a leap day, next February', 'monthly_date', '2028-02-29', 12, '2029-02-28'),
  ('monthly on a leap day, the next leap year', 'monthly_date', '2028-02-29', 48, '2032-02-29'),
  ('weekly from a leap day', 'weekly', '2028-02-29', 1, '2028-03-07'),
  ('monthly on the second Tuesday', 'monthly_weekday', '2026-11-10', 0, '2026-11-10'),
  ('monthly on the second Tuesday', 'monthly_weekday', '2026-11-10', 1, '2026-12-08'),
  ('monthly on the second Tuesday across a year end', 'monthly_weekday', '2026-11-10', 2, '2027-01-12'),
  ('monthly on the first Tuesday', 'monthly_weekday', '2026-11-03', 1, '2026-12-01'),
  ('monthly on the first Tuesday across a year end', 'monthly_weekday', '2026-11-03', 2, '2027-01-05'),
  ('monthly on the fifth Friday, a month with four', 'monthly_weekday', '2026-01-30', 1, '2026-02-27'),
  ('monthly on the fifth Friday, another month with four', 'monthly_weekday', '2026-01-30', 2, '2026-03-27'),
  ('monthly on the fifth Friday, a month with five', 'monthly_weekday', '2026-01-30', 4, '2026-05-29'),
  ('monthly on the fifth Friday, April', 'monthly_weekday', '2026-01-30', 3, '2026-04-24'),
  ('monthly on the fifth Tuesday of a leap February', 'monthly_weekday', '2028-02-29', 0, '2028-02-29'),
  ('monthly on the fifth Tuesday of a leap February', 'monthly_weekday', '2028-02-29', 1, '2028-03-28'),
  ('monthly on the fifth Tuesday, next February (four)', 'monthly_weekday', '2028-02-29', 12, '2029-02-27'),
  ('monthly on the fourth Wednesday', 'monthly_weekday', '2026-11-25', 1, '2026-12-23')
  ) as c(name, freq, anchor, n, expected);

-- Making an event repeat, and exactly one occurrence per date ---------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, location, format)
  values ('t-w', 'Weekly info', 'w1-info_session', pg_temp.today() + 3, 'Dallas, TX', 'in_person')$$,
  'Maria adds an event');
select lives_ok($$select public.make_event_repeat('t-w', 'weekly', null)$$, 'Maria makes it repeat weekly, no end');
select is(pg_temp.days(pg_temp.sid('t-w')), '3 10 17 24 31 38 45 52',
  'the first date and every week within 8 weeks are there, none in the past');
select is((select created_by from public.events where id = 't-w'), '1', 'the first occurrence is still Maria''s');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-w') and created_by is distinct from '1'), 0,
  'every generated occurrence is made as the series'' creator (Maria)');
select pg_temp.logout();

-- Repeated top-ups, by different people, change nothing
select pg_temp.login('4');
select lives_ok($$select public.topup_event_series()$$, 'Jamal''s app tops up');
select lives_ok($$select public.topup_event_series()$$, 'and again');
select pg_temp.logout();
select pg_temp.login('20');
select lives_ok($$select public.topup_event_series()$$, 'a candidate''s app tops up too');
select pg_temp.logout();
select pg_temp.login('1');
select lives_ok($$select public.topup_event_series()$$, 'Maria''s');
select is(pg_temp.days(pg_temp.sid('t-w')), '3 10 17 24 31 38 45 52', 'after five top-ups the dates are the same');
select is(pg_temp.most_per_date(pg_temp.sid('t-w')), 1, 'and each date has exactly one occurrence');
select pg_temp.logout();

-- A day later, three weeks later: the series tops itself up, one per date
select is(pg_temp.fill(pg_temp.sid('t-w'), 21), 3,
  'three weeks on, three more are made (59, 66, 73)');
select is(pg_temp.fill(pg_temp.sid('t-w'), 21), 0, 'filling again makes none');
select is(pg_temp.fill(pg_temp.sid('t-w'), 21), 0, 'nor a third time');
select is(pg_temp.days(pg_temp.sid('t-w')), '3 10 17 24 31 38 45 52 59 66 73', 'eleven dates in all');
select is(pg_temp.most_per_date(pg_temp.sid('t-w')), 1, 'still exactly one per date');
select throws_ok($$select pg_temp.twin(pg_temp.sid('t-w'), 10)$$, '23505', null,
  'the database refuses a second occurrence for a date, whoever tries');

-- Who may make an event repeat, and who may use "this and following"
select pg_temp.login('4');
select throws_ok($$select public.make_event_repeat('t-w', 'daily', null)$$, '42501', null,
  'Jamal can''t make Maria''s event repeat (he didn''t add it)');
select throws_ok($$select public.update_event_series_following('t-w', '{"location":"x"}', null)$$, '42501', null,
  'nor edit it and the following ones');
select throws_ok($$select public.delete_event_following('t-w')$$, '42501', null, 'nor delete it and the following ones');
select is(pg_temp.affected($$update public.events set name = name where series_id = pg_temp.sid('t-w')$$), 0,
  'and can''t edit a generated occurrence either (they are Maria''s, not his)');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-j', 'Jamal''s night', 'w1-night_owls', pg_temp.today() + 2, 'in_person')$$, 'Jamal adds an event of his own');
select lives_ok($$select public.make_event_repeat('t-j', 'weekly', null)$$, 'and may make it repeat (he added it)');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-j') and created_by = '4'), 8,
  'its occurrences are his (8 of them)');
select pg_temp.logout();
select pg_temp.login('2');
select is(pg_temp.affected($$update public.events set name = name where series_id = pg_temp.sid('t-w')$$), 11,
  'Anita (a moderator) may edit all of Maria''s occurrences');
select pg_temp.logout();
select pg_temp.login('6');
select is(pg_temp.affected($$update public.events set name = name where series_id = pg_temp.sid('t-w')$$), 11,
  'Marcus (her deputy) too');
select pg_temp.logout();
select pg_temp.login('20');
select throws_ok($$insert into public.events (name, category_id, date) values ('No', 'w1-info_session', pg_temp.today() + 1)$$,
  '42501', null, 'a candidate still can''t add events');
select throws_ok($$select public.make_event_repeat('t-w', 'daily', null)$$, '42501', null, 'nor make one repeat');
select pg_temp.logout();

-- No direct writes to the series or to the columns that hold it
select pg_temp.login('1');
select throws_ok($$insert into public.event_series (freq, starts_on, name, category_id)
  values ('daily', pg_temp.today(), 'x', 'w1-training')$$, '42501', null, 'no direct insert into event_series');
select throws_ok($$update public.event_series set ends_on = pg_temp.today()$$, '42501', null, 'no direct update');
select throws_ok($$delete from public.event_series$$, '42501', null, 'no direct delete (the history of a series stays)');
select throws_ok($$insert into public.events (name, category_id, date, series_id, series_date)
  values ('Sneaky', 'w1-training', pg_temp.today() + 400, pg_temp.sid('t-w'), pg_temp.today() + 400)$$,
  '42501', null, 'no occurrence made by hand');
select throws_ok($$update public.events set series_id = null where id = 't-w'$$, '42501', null, 'no detaching by hand');
select throws_ok($$update public.events set series_date = pg_temp.today() + 1 where id = 't-w'$$, '42501', null,
  'no moving an occurrence''s place in its series by hand');
select throws_ok($$update public.events set series_overrides = '{}' where id = 't-w'$$, '42501', null,
  'no clearing the marks by hand');
select pg_temp.logout();

-- "This event": one occurrence changed on its own is remembered; one deleted on its own never comes back
select pg_temp.login('1');
select lives_ok($$update public.events set name = 'Seven special' where id = pg_temp.at(pg_temp.sid('t-w'), 45)$$,
  'Maria renames the occurrence 45 days out on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-w'), 45)), array['name'],
  'the name is remembered as its own');
select lives_ok($$update public.events set name = 'Three special', date = date + 1 where id = pg_temp.at(pg_temp.sid('t-w'), 17)$$,
  'she renames and moves the one 17 days out on its own');
select is((select series_overrides from public.events where id = pg_temp.at(pg_temp.sid('t-w'), 17)), array['date', 'name'],
  'both are remembered');
select is((select date - pg_temp.today() from public.events where id = pg_temp.at(pg_temp.sid('t-w'), 17)), 18,
  'it moved a day (18 days out)');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-w') and series_date = pg_temp.today() + 17), 1,
  'but keeps its place in the series (17), so the top-up does not make another for that date');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-w') and series_overrides is not null), 2,
  'and only those two carry marks');
select lives_ok($$delete from public.events where id = pg_temp.at(pg_temp.sid('t-w'), 31)$$,
  'Maria deletes the occurrence 31 days out on its own (a plain delete, like any client)');
select is((select skipped from public.event_series where id = pg_temp.sid('t-w')), array[(pg_temp.today() + 31)],
  'its date is kept on the series');
select lives_ok($$select public.topup_event_series()$$, 'a top-up');
select is(pg_temp.fill(pg_temp.sid('t-w'), 21), 0, 'and a fill three weeks on: nothing');
select is(pg_temp.fill(pg_temp.sid('t-w'), 28), 1, 'a fill four weeks on makes only the new date (80), not the deleted one');
select is(pg_temp.days(pg_temp.sid('t-w')), '3 10 17 24 38 45 52 59 66 73 80', 'the deleted date (31) stays gone');
select lives_ok($$insert into public.attendances (event_id, person_id, attended)
  values (pg_temp.at(pg_temp.sid('t-w'), 10), '4', true)$$, 'Jamal is on the roster of the occurrence 10 days out (came)');
select lives_ok($$insert into public.attendances (event_id, person_id)
  values (pg_temp.at(pg_temp.sid('t-w'), 52), '4')$$, 'and of the one 52 days out');
select pg_temp.logout();

-- "This and following": from the occurrence 24 days out (rename, new location)
select pg_temp.login('1');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-w'), 24),
  '{"name": "Weekly info (new)", "location": "Room 9"}', null)$$, 'Maria changes name and location from the one 24 days out on');
select is((select string_agg(name || '|' || coalesce(location, '-'), ' ; ' order by series_date)
             from public.events where series_id = pg_temp.sid('t-w') and series_date <= pg_temp.today() + 24),
  'Weekly info|Dallas, TX ; Weekly info|Dallas, TX ; Three special|Dallas, TX ; Weekly info (new)|Room 9',
  'the earlier ones are untouched (the one renamed on its own too); that one has both changes');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-w') and series_date > pg_temp.today() + 24
              and location = 'Room 9'), 7, 'all seven later ones have the new location');
select is((select string_agg(name, ' ; ' order by series_date) from public.events
            where series_id = pg_temp.sid('t-w') and series_date in (pg_temp.today() + 45, pg_temp.today() + 52)),
  'Seven special ; Weekly info (new)',
  'the later one that was renamed on its own keeps its own name (and takes the new location)');
select is((select attended::text from public.attendances where event_id = pg_temp.at(pg_temp.sid('t-w'), 10) and person_id = '4'),
  'true', 'the attendance on the earlier occurrence is intact');
select is(pg_temp.fill(pg_temp.sid('t-w'), 35), 1, 'a fill 5 weeks on makes the next date (87)');
select is((select name || '|' || location from public.events
            where series_id = pg_temp.sid('t-w') and series_date = pg_temp.today() + 87), 'Weekly info (new)|Room 9',
  'and it is made with the new name and location');
select pg_temp.logout();

-- From the renamed occurrence itself, its own name is overwritten (the person chose to change from there)
select pg_temp.login('1');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-w'), 45),
  '{"name": "Weekly info (v3)"}', null)$$, 'Maria changes the name from the one 45 days out on');
select is((select string_agg(name, ' ; ' order by series_date) from public.events
            where series_id = pg_temp.sid('t-w') and series_date in (pg_temp.today() + 45, pg_temp.today() + 52)),
  'Weekly info (v3) ; Weekly info (v3)', 'its own name is replaced, and the later one follows');
select is((select series_overrides from public.events where series_date = pg_temp.today() + 45 and series_id = pg_temp.sid('t-w')),
  null, 'and its mark for the name is gone');
select is((select name from public.events where series_id = pg_temp.sid('t-w') and series_date = pg_temp.today() + 38),
  'Weekly info (new)', 'earlier occurrences are untouched');
select pg_temp.logout();

-- Changing the schedule from the occurrence 38 days out (a day later): the later ones are planned again
select pg_temp.login('1');
select is(pg_temp.days(pg_temp.sid('t-w')), '3 10 17 24 38 45 52 59 66 73 80 87', 'before: eleven dates plus the new one');
select pg_temp.keep('t-sid', pg_temp.sid('t-w'));
select pg_temp.keep('e38', pg_temp.at(pg_temp.sid('t-w'), 38));
select pg_temp.keep('e45', pg_temp.at(pg_temp.sid('t-w'), 45));
select pg_temp.keep('e52', pg_temp.at(pg_temp.sid('t-w'), 52));
select pg_temp.keep('e59', pg_temp.at(pg_temp.sid('t-w'), 59));
select lives_ok($$select public.update_event_series_following(pg_temp.kept('e38'),
  ('{"date": "' || (pg_temp.today() + 39) || '"}')::jsonb, null)$$,
  'Maria moves that one a day later, for it and the following ones');
select is(pg_temp.days(pg_temp.kept('t-sid')), '3 10 17 24', 'the old series keeps its first four occurrences, untouched');
select is((select ends_on from public.event_series where id = pg_temp.kept('t-sid')), pg_temp.today() + 37,
  'and stops the day before');
select ok(pg_temp.sid(pg_temp.kept('e38')) is distinct from pg_temp.kept('t-sid') and pg_temp.sid(pg_temp.kept('e38')) is not null,
  'the moved occurrence leads a new series');
select is(pg_temp.days(pg_temp.sid(pg_temp.kept('e38'))), '39 46 53', 'which is filled from there, nothing earlier');
select is((select count(*)::int from public.events where id in (pg_temp.kept('e45'), pg_temp.kept('e59'))), 0,
  'later occurrences nobody had touched were dropped and made again by the rule');
select is((select series_id is null from public.events where id = pg_temp.kept('e52')), true,
  'the later occurrence with a roster is kept, as a single event (its date doesn''t fit the new rule)');
select is((select count(*)::int from public.attendances where event_id = pg_temp.kept('e52')), 1,
  'with its attendance');
select is((select count(*)::int from public.events where series_id in (pg_temp.kept('t-sid'), pg_temp.sid(pg_temp.kept('e38')))
              and series_date is not null), 7, 'seven in the two series, one per date');
select is(pg_temp.most_per_date(pg_temp.sid(pg_temp.kept('e38'))) + pg_temp.most_per_date(pg_temp.kept('t-sid')), 2,
  'exactly one per date in both');
select pg_temp.logout();

-- Changing Ends (from the first occurrence of a series: the series itself changes)
select pg_temp.login('1');
select pg_temp.keep('n-sid', pg_temp.sid(pg_temp.kept('e38')));
select lives_ok($$insert into public.attendances (event_id, person_id) values (pg_temp.at(pg_temp.kept('n-sid'), 53), '4')$$,
  'Jamal is on the roster of the last occurrence (53 days out)');
select lives_ok($$select public.update_event_series_following(pg_temp.kept('e38'), '{}',
  ('{"freq": "weekly", "ends_on": "' || (pg_temp.today() + 46) || '"}')::jsonb)$$, 'Maria makes the series end on its second occurrence');
select is(pg_temp.sid(pg_temp.kept('e38')), pg_temp.kept('n-sid'), 'it is the same series (this was its first occurrence)');
select is(pg_temp.days(pg_temp.kept('n-sid')), '39 46', 'nothing after the end');
select is((select series_id is null from public.events where id = (select event_id from public.attendances
            where person_id = '4' and event_id in (select id from public.events where date = pg_temp.today() + 53) limit 1)), true,
  'the one after the end that had a roster is kept as a single event, not deleted');
select is(pg_temp.fill(pg_temp.kept('n-sid'), 70), 0, 'and a top-up 10 weeks on makes none after the end');
select pg_temp.logout();

-- Stopping from an occurrence: it becomes a single event, the series stops just before it
select pg_temp.login('1');
select lives_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.kept('n-sid'), 46), '{}', '{"freq": "none"}')$$,
  'Maria stops the series at its second occurrence');
select is(pg_temp.days(pg_temp.kept('n-sid')), '39', 'one occurrence is left in the series');
select is((select count(*)::int from public.events where series_id is null and date = pg_temp.today() + 46), 1,
  'the other is a single event now');
select is((select ends_on from public.event_series where id = pg_temp.kept('n-sid')), pg_temp.today() + 45, 'the series ends before it');
select pg_temp.logout();

-- "This and following" on delete, from the third occurrence of the old series
select pg_temp.login('1');
select lives_ok($$select public.delete_event_following(pg_temp.at(pg_temp.kept('t-sid'), 17))$$, 'Maria deletes from the one 17 days out on');
select is(pg_temp.days(pg_temp.kept('t-sid')), '3 10', 'it and the later one are gone; the earlier ones stay');
select is((select ends_on from public.event_series where id = pg_temp.kept('t-sid')), pg_temp.today() + 16, 'the series stops the day before');
select is((select attended::text from public.attendances where event_id = pg_temp.at(pg_temp.kept('t-sid'), 10) and person_id = '4'),
  'true', 'the earlier occurrence''s attendance is intact');
select is(pg_temp.fill(pg_temp.kept('t-sid'), 60), 0, 'and nothing is made after it, ever');
select pg_temp.logout();

-- Past occurrences keep their history
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-p', 'Started in the past', 'w1-work_session', pg_temp.today() - 14, 'in_person')$$, 'Maria adds a weekly event that started two weeks ago');
select lives_ok($$select public.make_event_repeat('t-p', 'weekly', null)$$, 'and makes it repeat');
select is(pg_temp.days(pg_temp.sid('t-p')), '-14 0 7 14 21 28 35 42 49 56',
  'only the first date is in the past (the date she chose); nothing is made for last week');
select lives_ok($$insert into public.attendances (event_id, person_id, attended) values ('t-p', '4', true)$$, 'Jamal came to the first one');
select lives_ok($$select public.delete_event_following(pg_temp.at(pg_temp.sid('t-p'), 14))$$, 'Maria deletes from 14 days out on');
select is(pg_temp.days(pg_temp.sid('t-p')), '-14 0 7', 'the earlier ones stay');
select is((select count(*)::int from public.attendances where event_id = 't-p'), 1, 'and the first one''s attendance is intact');
select pg_temp.logout();

-- Later occurrences that are already over are history: they stay as single events
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-q', 'Weekly', 'w1-work_session', pg_temp.today() + 1, 'in_person')$$, 'Maria adds another');
select lives_ok($$select public.make_event_repeat('t-q', 'weekly', null)$$, 'and makes it repeat');
select pg_temp.keep('q15', pg_temp.at(pg_temp.sid('t-q'), 15));
select pg_temp.logout();
-- (the 15th day has passed: moved back by the database for the test)
select lives_ok($$update public.events set date = pg_temp.today() - 3 where id = pg_temp.kept('q15')$$, 'the occurrence 15 days out is over');
select pg_temp.login('1');
select lives_ok($$insert into public.attendances (event_id, person_id, attended) values (pg_temp.kept('q15'), '4', true)$$, 'with a roster');
select lives_ok($$select public.delete_event_following(pg_temp.at(pg_temp.sid('t-q'), 8))$$, 'Maria deletes from the one 8 days out on');
select is((select series_id is null from public.events where id = pg_temp.kept('q15')), true, 'the finished one stays, as a single event');
select is((select count(*)::int from public.attendances where event_id = pg_temp.kept('q15')), 1, 'with its attendance');
select is(pg_temp.days(pg_temp.sid('t-q')), '1', 'the rest are gone');
select pg_temp.logout();

-- Multi-day events may repeat only with a period longer than their own length
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, end_date, format)
  values ('t-m', 'Workshop', 'w1-training', pg_temp.today() + 5, pg_temp.today() + 7, 'in_person')$$, 'Maria adds a three-day event');
select throws_ok($$select public.make_event_repeat('t-m', 'daily', null)$$, '22023', null, 'it can''t repeat daily');
select lives_ok($$select public.make_event_repeat('t-m', 'weekly', null)$$, 'but can repeat weekly');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-m') and end_date = date + 2), 8,
  'every occurrence is three days long (8 of them)');
select throws_ok($$select public.update_event_series_following('t-m',
  ('{"end_date": "' || (pg_temp.today() + 12) || '"}')::jsonb, null)$$, '22023', null,
  'and can''t be made eight days long');
select lives_ok($$insert into public.events (id, name, category_id, date, end_date, format)
  values ('t-l', 'Long', 'w1-training', pg_temp.today() + 5, pg_temp.today() + 32, 'in_person')$$, 'a 28-day event');
select throws_ok($$select public.make_event_repeat('t-l', 'monthly_date', null)$$, '22023', null, 'can''t repeat monthly');
select pg_temp.logout();


-- A second team's app can't see or reach this team's series, and its top-up only fills its own
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('t-iso', 'Idle series', 'w1-info_session', pg_temp.today() + 4)$$,
  'Maria adds an event');
select lives_ok($$select public.make_event_repeat('t-iso', 'weekly', null)$$, 'and makes it repeat');
select is(pg_temp.drain(pg_temp.sid('t-iso')), 7, 'her team''s later occurrences vanish (nobody has opened the app)');
select pg_temp.logout();
insert into public.workspaces (id, name) values ('w2', 'Other team');
insert into public.people (id, workspace_id, name, biz_class, business_start_date)
values ('901', 'w2', 'Olivia Other', 'ibo', current_date - 900);
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000901',
        'authenticated', 'authenticated', 'olivia@other.test');
insert into public.members (workspace_id, person_id, user_id, role)
values ('w2', '901', '00000000-0000-4000-8000-000000000901', 'leader');
select pg_temp.login('901');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('w2-w', 'Other weekly', 'w2-night_owls', pg_temp.today() + 1)$$,
  'the other team''s leader adds an event');
select lives_ok($$select public.make_event_repeat('w2-w', 'daily', null)$$, 'and makes it repeat daily');
select is((select count(*)::int from public.event_series), 1, 'they see their own series and none of the first team''s');
select is(pg_temp.n(pg_temp.sid('w2-w')), 56, 'a daily series is kept filled 8 weeks ahead (tomorrow to 56 days out)');
select throws_ok($$select public.make_event_repeat('t-w', 'daily', null)$$, 'P0002', null, 'they can''t make the first team''s event repeat');
select throws_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.kept('n-sid'), 39), '{"name":"x"}', null)$$,
  '22023', null, 'nor edit its occurrences and the following ones');
select throws_ok($$select public.delete_event_following(pg_temp.at(pg_temp.kept('n-sid'), 39))$$, '22023', null, 'nor delete them');
select lives_ok($$select public.topup_event_series()$$, 'their top-up runs');
select pg_temp.logout();
select pg_temp.login('1');
select is((select count(*)::int from public.event_series where workspace_id = 'w2'), 0, 'Maria sees none of theirs');
select is((select count(*)::int from public.events where workspace_id = 'w1' and series_id = pg_temp.sid('w2-w')), 0,
  'and the other team''s series made nothing in her team');
select is(pg_temp.n(pg_temp.sid('t-iso')), 1, 'the other team''s top-up did not fill her team''s idle series');
select lives_ok($$select public.topup_event_series()$$, 'her own top-up does');
select is(pg_temp.n(pg_temp.sid('t-iso')), 8, 'eight again');
select pg_temp.logout();

-- Generated occurrences are the series creator's, whoever's app made them
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-g', 'Maria''s weekly', 'w1-info_session', pg_temp.today() + 6, 'in_person')$$, 'Maria adds an event');
select lives_ok($$select public.make_event_repeat('t-g', 'weekly', null)$$, 'and makes it repeat');
select is(pg_temp.n(pg_temp.sid('t-g')), 8, 'eight occurrences');
select is(pg_temp.drain(pg_temp.sid('t-g')), 7, 'seven vanish without a trace (nobody has opened the app for weeks)');
select pg_temp.logout();
select pg_temp.login('4');
select lives_ok($$select public.topup_event_series()$$, 'Jamal opens the app: his top-up fills the idle series');
select is(pg_temp.n(pg_temp.sid('t-g')), 8, 'eight again, one per date');
select is(pg_temp.most_per_date(pg_temp.sid('t-g')), 1, 'exactly one per date');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-g') and created_by = '1'), 8,
  'all eight are Maria''s, not Jamal''s');
select is(pg_temp.affected($$update public.events set name = name where series_id = pg_temp.sid('t-g')$$), 0,
  'so Jamal, whose app made them, can''t edit them');
select is(pg_temp.affected($$delete from public.events where series_id = pg_temp.sid('t-g')$$), 0, 'or delete them');
select pg_temp.logout();
select pg_temp.login('2');
select is(pg_temp.affected($$update public.events set name = name where series_id = pg_temp.sid('t-g')$$), 8,
  'Anita (a moderator) can');
select pg_temp.logout();

-- Merging categories moves a series along, and isn't an edit of each occurrence
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-tr', 'Training', 'w1-training', pg_temp.today() + 4, 'in_person')$$, 'Maria adds a repeating training');
select lives_ok($$select public.make_event_repeat('t-tr', 'biweekly', null)$$, 'every 2 weeks');
select lives_ok($$select public.merge_event_categories('w1-training', 'w1-work_session')$$, 'she merges Training into Work session');
select is((select category_id from public.event_series where id = pg_temp.sid('t-tr')), 'w1-work_session', 'the series follows');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-tr') and category_id = 'w1-work_session'),
  pg_temp.n(pg_temp.sid('t-tr')), 'and so does every occurrence');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-tr') and series_overrides is not null), 0,
  'none is marked as edited on its own');
select pg_temp.logout();

-- Things that are refused
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('t-x', 'Odd', 'w1-info_session', pg_temp.today() + 9)$$,
  'Maria adds an event');
select throws_ok($$select public.make_event_repeat('t-x', 'hourly', null)$$, '22023', null, 'an unknown repeat is refused');
select throws_ok($$select public.make_event_repeat('t-x', 'weekly', pg_temp.today())$$, '22023', null, 'a series can''t end before it starts');
select throws_ok($$select public.make_event_repeat('t-nothing', 'weekly', null)$$, 'P0002', null, 'an event that isn''t there');
select throws_ok($$select public.make_event_repeat(pg_temp.at(pg_temp.sid('t-g'), 6), 'weekly', null)$$, '22023', null,
  'an occurrence of a series can''t be made to repeat again');
select throws_ok($$select public.update_event_series_following('t-x', '{"name": "Y"}', null)$$, '22023', null,
  'a single event has no following ones');
select throws_ok($$select public.update_event_series_following(pg_temp.at(pg_temp.sid('t-g'), 6), '{"color": "red"}', null)$$,
  '22023', null, 'unknown fields are refused');
select throws_ok($$select public.delete_event_following('t-x')$$, '22023', null, 'nor a delete of the following ones');
select lives_ok($$select public.make_event_repeat('t-x', 'monthly_weekday', pg_temp.today() + 100)$$, 'a monthly series that ends on a date');
select is((select count(*)::int from public.events where series_id = pg_temp.sid('t-x') and date > pg_temp.today() + 100), 0,
  'has nothing after the end');
select pg_temp.logout();

-- A series that can't be filled doesn't stop the others
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, category_id, date) values ('t-ar', 'Soon archived', 'w1-night_owls', pg_temp.today() + 2)$$,
  'Maria adds an event in Night Owls');
select lives_ok($$select public.make_event_repeat('t-ar', 'weekly', null)$$, 'and makes it repeat');
select is(pg_temp.drain(pg_temp.sid('t-ar')), 7, 'its later occurrences vanish');
select is(pg_temp.drain(pg_temp.sid('t-g')), 7, 'and so do another series'' ones');
select pg_temp.logout();
update public.event_categories set archived_at = now() where id = 'w1-night_owls';
select pg_temp.login('1');
select lives_ok($$select public.topup_event_series()$$, 'the top-up runs though one series'' category was archived');
select is(pg_temp.n(pg_temp.sid('t-g')), 8, 'the other series is filled');
select is(pg_temp.n(pg_temp.sid('t-ar')), 1, 'the one in the archived category waits');
select pg_temp.logout();

-- A client that knows nothing about series keeps working
select pg_temp.login('4');
select lives_ok($$insert into public.events (id, name, category_id, date, location, format)
  values ('t-old', 'Plain event', 'w1-work_session', pg_temp.today() + 1, 'Dallas', 'in_person')$$, 'Jamal adds a plain event the old way');
select lives_ok($$update public.events set name = 'Plain event 2', location = 'Austin' where id = 't-old'$$, 'edits it');
select is((select series_id is null and series_date is null and series_overrides is null from public.events where id = 't-old'), true,
  'and nothing about it repeats');
select lives_ok($$delete from public.events where id = 't-old'$$, 'deletes it');
select pg_temp.logout();

-- What counts as something hanging off an event (so a re-plan never throws it away)
select lives_ok($$insert into public.events (id, workspace_id, name, category_id, date)
  values ('t-d', 'w1', 'Dependents', 'w1-info_session', pg_temp.today() + 9)$$, 'an event for the check');
select is(public.event_has_dependents('t-d'), false, 'nothing on it yet');
select lives_ok($$insert into public.attendances (workspace_id, event_id, person_id) values ('w1', 't-d', '4')$$, 'a roster row on it');
select is(public.event_has_dependents('t-d'), true, 'counts');
select lives_ok($$delete from public.attendances where event_id = 't-d'$$, 'gone');
select lives_ok($$insert into public.shared_costs (workspace_id, event_id, name, total, owner_id) values ('w1', 't-d', 'Van', 100, '1')$$,
  'a shared cost on it');
select is(public.event_has_dependents('t-d'), true, 'counts');
select lives_ok($$delete from public.shared_costs where event_id = 't-d'$$, 'gone');
select lives_ok($$insert into public.messages (conversation_id, author_id, body, card)
  values ('main', '1', 'Info session!', '{"type": "event", "eventId": "t-d"}')$$, 'a chat post about it');
select is(public.event_has_dependents('t-d'), true, 'counts too');

select * from finish();
rollback;
