-- Prospect check-in intervals (migration 20261115000100): the four checkin_*_months columns on pipeline_team_settings
-- and public.my_checkin_months(), the nearest person up your own sponsor line who set them (all four from that one
-- person; no row = the app's defaults). Self-contained (workspace ckw), all rolled back.
--
-- Team 'ckw': Lena (cl, leader, login 1) -> Mia (cm, login 2) -> Noah (cn, login 3) -> Omar (co, login 4); Pam (cp, login 7)
-- is Lena's other downline (beside Mia); Xavier (cx, login 5) leads another line (a crossline); Cal (cc, login 6) is
-- a candidate under Lena. Set values read "hot/warm/cold/not_interested from <person>".
-- No date is compared here: the rule's dates (when a check-in is due) are computed by the app from the team's day.
-- People are created with the team's own day (workspace_today), never the server's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(64);

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e500' || p_n)::uuid $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.as_login(p_n int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_n), 'role', 'authenticated',
    'aud', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Run a statement as a login: 'rows=N' (what it changed or returned) or the SQLSTATE it failed with. Back as the owner afterwards.
create function pg_temp.run_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
  v_out text;
begin
  perform pg_temp.as_login(p_n);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := 'rows=' || v_rows;
  exception when others then v_out := sqlstate;
  end;
  perform pg_temp.as_postgres();
  return v_out;
end $$;
-- One value, as a login (back as the owner afterwards).
create function pg_temp.val_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_login(p_n);
  execute p_sql into v;
  perform pg_temp.as_postgres();
  return v;
end $$;
-- The check-in months a login uses, and whose they are ('none' = the defaults apply).
create function pg_temp.mine(p_n int) returns text language sql as $$
  select pg_temp.val_as(p_n, $q$select coalesce((select hot || '/' || warm || '/' || cold || '/' || not_interested
                                                  || ' from ' || from_person_id from public.my_checkin_months()), 'none')$q$) $$;
-- Save a full set as a login (the client's upsert).
create function pg_temp.save(p_n int, p_person text, p_hot int, p_warm int, p_cold int, p_ni int) returns text language sql as $$
  select pg_temp.run_as(p_n, format($q$insert into public.pipeline_team_settings
      (person_id, workspace_id, checkin_hot_months, checkin_warm_months, checkin_cold_months, checkin_not_interested_months)
      values (%L, 'ckw', %s, %s, %s, %s)
      on conflict (person_id) do update set checkin_hot_months = excluded.checkin_hot_months,
        checkin_warm_months = excluded.checkin_warm_months, checkin_cold_months = excluded.checkin_cold_months,
        checkin_not_interested_months = excluded.checkin_not_interested_months$q$, p_person, p_hot, p_warm, p_cold, p_ni)) $$;
-- Clear a login's own set (the client's reset: the four go back to null, the row stays).
create function pg_temp.clear(p_n int, p_person text) returns text language sql as $$
  select pg_temp.run_as(p_n, format($q$update public.pipeline_team_settings set checkin_hot_months = null,
      checkin_warm_months = null, checkin_cold_months = null, checkin_not_interested_months = null
      where person_id = %L$q$, p_person)) $$;

insert into public.workspaces (id, name, timezone) values
  ('ckw', 'Check-in Team',
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date) values
  ('cl', 'ckw', 'Lena Leader',  'ibo',        null, null, public.workspace_today('ckw') - 900),
  ('cm', 'ckw', 'Mia Mid',      'ibo',        'cl', null, public.workspace_today('ckw') - 700),
  ('cn', 'ckw', 'Noah Nested',  'apprentice', 'cm', null, public.workspace_today('ckw') - 100),
  ('co', 'ckw', 'Omar Outer',   'apprentice', 'cn', null, public.workspace_today('ckw') - 50),
  ('cp', 'ckw', 'Pam Parallel', 'ibo',        'cl', null, public.workspace_today('ckw') - 600),
  ('cx', 'ckw', 'Xavier Cross', 'ibo',        null, null, public.workspace_today('ckw') - 800),
  ('cc', 'ckw', 'Cal Candidate', 'prospect',  'cl', null, null);
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'checkin-' || n || '@checkin.test'
  from generate_series(1, 7) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('ckw', 'cl', pg_temp.login(1), 'leader'),
  ('ckw', 'cm', pg_temp.login(2), 'member'),
  ('ckw', 'cn', pg_temp.login(3), 'member'),
  ('ckw', 'co', pg_temp.login(4), 'member'),
  ('ckw', 'cx', pg_temp.login(5), 'member'),
  ('ckw', 'cc', pg_temp.login(6), 'member'),
  ('ckw', 'cp', pg_temp.login(7), 'member');

-- The columns, and the function's settings -------------------------------------------------------------------------------------
select has_column('public', 'pipeline_team_settings', 'checkin_hot_months', 'the Hot interval is a column');
select has_column('public', 'pipeline_team_settings', 'checkin_warm_months', 'the Warm interval is a column');
select has_column('public', 'pipeline_team_settings', 'checkin_cold_months', 'the Cold interval is a column');
select has_column('public', 'pipeline_team_settings', 'checkin_not_interested_months', 'the Not interested interval is a column');
select is((select prosecdef from pg_proc where oid = 'public.my_checkin_months()'::regprocedure), false,
  'my_checkin_months runs as the caller (their row access applies)');
select is((select proconfig from pg_proc where oid = 'public.my_checkin_months()'::regprocedure), array['search_path=""'],
  'its search_path is empty');
select is(has_function_privilege('anon', 'public.my_checkin_months()', 'execute'), false, 'anon cannot call it');
select is(has_function_privilege('authenticated', 'public.my_checkin_months()', 'execute'), true, 'a signed-in person can');

-- Nobody has set anything: the defaults ------------------------------------------------------------------------------------------
select is(pg_temp.mine(4), 'none', 'nobody up the line set them: no row (the app''s defaults apply)');
-- A row that only holds a goal (the existing use) is still valid, with no check-in values.
insert into public.pipeline_team_settings (person_id, workspace_id, mg1_goal) values ('cl', 'ckw', 40);
select is(pg_temp.mine(1), 'none', 'a goal alone sets no check-in values');

-- Your own ------------------------------------------------------------------------------------------------------------------------
select is(pg_temp.save(1, 'cl', 2, 5, 9, 10), 'rows=1', 'Lena saves her own four');
select is(pg_temp.mine(1), '2/5/9/10 from cl', 'she uses her own');
select is((select mg1_goal from public.pipeline_team_settings where person_id = 'cl'), 40, 'her goal is untouched by the check-in values');

-- Inherited from the sponsor, two and three levels up -------------------------------------------------------------------------
select is(pg_temp.mine(2), '2/5/9/10 from cl', 'Mia, who set none, uses her sponsor Lena''s');
select is(pg_temp.mine(3), '2/5/9/10 from cl', 'Noah uses Lena''s, two levels up');
select is(pg_temp.mine(4), '2/5/9/10 from cl', 'Omar uses Lena''s, three levels up');
select is(pg_temp.mine(7), '2/5/9/10 from cl', 'Pam, Lena''s other downline, uses hers');

-- The nearest wins (all four from the one person) ------------------------------------------------------------------------------
select is(pg_temp.save(2, 'cm', 1, 2, 3, 4), 'rows=1', 'Mia saves her own four');
select is(pg_temp.mine(2), '1/2/3/4 from cm', 'Mia uses her own, not Lena''s');
select is(pg_temp.mine(3), '1/2/3/4 from cm', 'Noah now uses Mia''s (nearer than Lena)');
select is(pg_temp.mine(4), '1/2/3/4 from cm', 'so does Omar');
select is(pg_temp.mine(1), '2/5/9/10 from cl', 'Lena still uses hers');
select is(pg_temp.mine(7), '2/5/9/10 from cl', 'Pam, beside Mia, is not affected by Mia''s');
select is(pg_temp.save(3, 'cn', 36, 12, 24, 6), 'rows=1', 'Noah saves his own');
select is(pg_temp.mine(4), '36/12/24/6 from cn', 'Omar uses Noah''s, the nearest');
select is(pg_temp.mine(2), '1/2/3/4 from cm', 'Mia is not affected by someone below her');

-- Reset: clearing your own goes back to the upline's -------------------------------------------------------------------------
select is(pg_temp.clear(3, 'cn'), 'rows=1', 'Noah clears his own (use my upline''s)');
select is(pg_temp.mine(3), '1/2/3/4 from cm', 'Noah is back on Mia''s');
select is(pg_temp.mine(4), '1/2/3/4 from cm', 'Omar follows');
select is(pg_temp.clear(2, 'cm'), 'rows=1', 'Mia clears hers');
select is(pg_temp.mine(3), '2/5/9/10 from cl', 'Noah is back on Lena''s');
select is(pg_temp.mine(2), '2/5/9/10 from cl', 'and Mia');
select is((select checkin_hot_months is null and checkin_warm_months is null and checkin_cold_months is null
                  and checkin_not_interested_months is null from public.pipeline_team_settings where person_id = 'cm'), true,
  'a cleared row holds none of the four (not a stale half)');

-- A downline's values never reach up ---------------------------------------------------------------------------------------------
select is(pg_temp.save(3, 'cn', 7, 8, 9, 10), 'rows=1', 'Noah sets his own again');
select is(pg_temp.clear(1, 'cl'), 'rows=1', 'Lena clears hers');
select is(pg_temp.val_as(1, $$select count(*)::text from public.pipeline_team_settings where person_id = 'cn' and checkin_hot_months is not null$$),
  '1', 'Lena can read her downline''s row');
select is(pg_temp.mine(1), 'none', 'but does not use it: she is on the defaults');
select is(pg_temp.mine(2), 'none', 'Mia (above Noah) is on the defaults too');
select is(pg_temp.mine(3), '7/8/9/10 from cn', 'Noah uses his own');

-- A crossline's values are never used ----------------------------------------------------------------------------------------------
select is(pg_temp.save(5, 'cx', 11, 12, 13, 14), 'rows=1', 'Xavier, who leads another line, sets his');
select is(pg_temp.save(1, 'cl', 2, 5, 9, 10), 'rows=1', 'Lena sets hers again');
select is(pg_temp.val_as(1, $$select count(*)::text from public.pipeline_team_settings where person_id = 'cx'$$), '0',
  'Lena cannot read a crossline''s row');
select is(pg_temp.mine(5), '11/12/13/14 from cx', 'Xavier uses his');
select is(pg_temp.mine(2) || ' ' || pg_temp.mine(7), '2/5/9/10 from cl 2/5/9/10 from cl', 'nobody in Lena''s line uses Xavier''s');
select is(pg_temp.val_as(5, $$select count(*)::text from public.pipeline_team_settings where person_id in ('cl', 'cm', 'cn')$$), '0',
  'and Xavier cannot read theirs');

-- Only your own row is writable ---------------------------------------------------------------------------------------------------------
select is(pg_temp.run_as(2, $$update public.pipeline_team_settings set checkin_hot_months = 1 where person_id = 'cl'$$), 'rows=0',
  'Mia cannot change Lena''s row');
select is(pg_temp.run_as(1, $$update public.pipeline_team_settings set checkin_hot_months = 1 where person_id = 'cn'$$), 'rows=0',
  'Lena (an upline) cannot change Noah''s either');
select is(pg_temp.run_as(1, $$delete from public.pipeline_team_settings where person_id = 'cn'$$), 'rows=0', 'nor delete it');
select is(pg_temp.save(2, 'co', 1, 1, 1, 1), '42501', 'Mia cannot create a row for Omar');
select is(pg_temp.save(6, 'cc', 3, 6, 12, 12), '42501', 'a candidate has no pipeline: no row of their own');
select is(pg_temp.mine(3) || ' ' || pg_temp.mine(1), '7/8/9/10 from cn 2/5/9/10 from cl', 'nothing above changed');

-- Out of range or half set is refused (each of the four, each end) --------------------------------------------------------------------------------
select is(pg_temp.save(2, 'cm',
    case when c = 'hot' then v else 3 end, case when c = 'warm' then v else 6 end,
    case when c = 'cold' then v else 12 end, case when c = 'not_interested' then v else 12 end),
  '23514', c || ' = ' || v || ' months is refused')
  from unnest(array['hot', 'warm', 'cold', 'not_interested']) c, unnest(array[0, 37]) v;
select is(pg_temp.run_as(2, format($q$update public.pipeline_team_settings set checkin_%s_months = 3 where person_id = 'cm'$q$, c)),
  '23514', c || ' alone is refused (a set comes from one person)')
  from unnest(array['hot', 'warm', 'cold', 'not_interested']) c;
select is(pg_temp.save(2, 'cm', 1, 36, 12, 12), 'rows=1', '1 and 36 are the ends of the range and are accepted');

select * from finish();
rollback;
