-- Agent connector, part 3a: the people tools on a team of a few hundred (migration 20261106000100_agent_people_tools).
-- A leader with 300 registered people below her in three levels, 150 prospects, 40 customers and, outside her
-- downline, a second line of 50: the lists page correctly through every level, totals are exact, nothing
-- outside the downline appears, each call is one audit row. (How fast the one query runs is measured with
-- `explain analyze` and stated in the pull request; a unit test does not assert timing.)
-- Self-contained (workspace ags), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000b300' || p_n)::uuid $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000f00' || p_n)::uuid $$;
create function pg_temp.hash(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'utf8')), 'hex') $$;
create function pg_temp.as_connector(p_login int, p_conn int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_login),
    'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', pg_temp.conn(p_conn)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.agent_connection_id', '', true);
end $$;
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;
create function pg_temp.mid(p_n int) returns text language sql immutable as $$ select 'ags' || lpad(p_n::text, 3, '0') $$;

insert into public.workspaces (id, name) values ('ags', 'Scale Test Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date) values
  ('agsl', 'ags', 'Lena Leader', 'ibo', null, current_date - 900),
  ('agsx', 'ags', 'Xavier Outsider', 'ibo', null, current_date - 900);
-- level 1: members 1 to 6 under the leader; level 2: 7 to 48, seven under each of them; level 3: 49 to 300, six under each
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date)
select pg_temp.mid(n), 'ags', 'Member ' || lpad(n::text, 3, '0'), 'apprentice',
       case when n <= 6 then 'agsl' when n <= 48 then pg_temp.mid((n - 7) / 7 + 1) else pg_temp.mid((n - 49) / 6 + 7) end,
       current_date - 30
  from generate_series(1, 300) n;
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date)
select 'agsx' || lpad(n::text, 2, '0'), 'ags', 'Outsider ' || lpad(n::text, 2, '0'), 'apprentice', 'agsx', current_date - 30
  from generate_series(1, 50) n;
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, pipeline_stage)
select 'agsp' || lpad(n::text, 3, '0'), 'ags', 'Prospect ' || lpad(n::text, 3, '0'), 'prospect', pg_temp.mid((n - 1) % 300 + 1), 'prospect'
  from generate_series(1, 150) n;
insert into public.people (id, workspace_id, name, biz_class, owner_id)
select 'agsc' || lpad(n::text, 2, '0'), 'ags', 'Customer ' || lpad(n::text, 2, '0'), 'customer', 'agsl'
  from generate_series(1, 40) n;
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'agent-scale-' || n || '@agent.test'
  from generate_series(1, 2) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('ags', 'agsl', pg_temp.login(1), 'leader'),
  ('ags', pg_temp.mid(1), pg_temp.login(2), 'member');
insert into public.feature_switches (workspace_id, feature, enabled) values ('ags', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access) values
  (pg_temp.conn(1), pg_temp.login(1), 'agsl', 'ags', 'Lena', pg_temp.hash('k1'), 'write'),
  (pg_temp.conn(2), pg_temp.login(2), pg_temp.mid(1), 'ags', 'Member one', pg_temp.hash('k2'), 'read');
select pg_temp.pretend_connector_session();

create temp table pages (p int, doc jsonb);
grant insert, select on pages to public;

select pg_temp.as_connector(1, 1);
insert into pages values (1, public.agent_list_team(null, 200, 0)), (2, public.agent_list_team(null, 200, 200));
select is((select (doc ->> 'total')::int from pages where p = 1), 300, 'the leader''s total is 300, not the 350 in the workspace');
select is((select jsonb_array_length(doc -> 'team') from pages where p = 1), 200, 'a page of 200');
select is((select jsonb_array_length(doc -> 'team') from pages where p = 2), 100, 'and the next holds the other 100');
select is((select count(distinct x ->> 'id')::int from pages p, jsonb_array_elements(p.doc -> 'team') x), 300, 'together 300 different people');
select is((select count(*)::int from pages p, jsonb_array_elements(p.doc -> 'team') x where x ->> 'id' like 'agsx%'), 0, 'none of the second line');
select is((select string_agg((x ->> 'level') || ':' || n, ',' order by o) from (
             select x, o, count(*) over (partition by x ->> 'level') as n from pages p, jsonb_array_elements(p.doc -> 'team') with ordinality t (x, o) where p.p = 1) z
            where o in (1, 6, 7, 48, 49, 200)), '1:6,1:6,2:42,2:42,3:152,3:152', 'level 1 comes first (6), then level 2 (42), then level 3 (152 of its 252 on the first page)');
select is((select count(*)::int from (
             select (x ->> 'level')::int as lv, x ->> 'full_name' as nm,
                    lag((x ->> 'level')::int) over (order by p.p, o) as plv, lag(x ->> 'full_name') over (order by p.p, o) as pnm
               from pages p, jsonb_array_elements(p.doc -> 'team') with ordinality t (x, o)) z
            where plv > lv or (plv = lv and pnm > nm)), 0, 'across both pages the order never goes back: by level, then name');
select is((select count(*)::int from pages p, jsonb_array_elements(p.doc -> 'team') x where (x ->> 'level')::int = 3 and x ->> 'sponsor_name' not like 'Member 0%'), 0,
  'every sponsor name is a member''s');
select is((select (x ->> 'sponsor_name') from pages p, jsonb_array_elements(p.doc -> 'team') x where x ->> 'full_name' = 'Member 100'), 'Member 015',
  'Member 100 (the 52nd of level 3) is under Member 015');
select is((public.agent_list_team('09', 50, 0) ->> 'total')::int, (select count(*)::int from generate_series(1, 300) n where lpad(n::text, 3, '0') like '%09%'),
  'a search counts exactly the names it matches');
select is((public.agent_list_team('MEMBER 3', 200, 0) ->> 'total')::int, (select count(*)::int from generate_series(1, 300) n where lpad(n::text, 3, '0') like '3%'), 'another search: "member 3" is Member 300 only');
select is((public.agent_list_team(null, 7, 295) ->> 'total')::int, 300, 'an offset near the end still reports the total');
select is(jsonb_array_length(public.agent_list_team(null, 7, 295) -> 'team'), 5, 'and the 5 left');
select is((public.agent_whoami() ->> 'team_size')::int, 300, 'whoami''s team_size is 300');
select is((public.agent_list_prospects(200, null, 0) ->> 'total')::int, 150, 'the prospects of the whole team: 150');
select is(jsonb_array_length(public.agent_list_prospects(200, null, 0) -> 'prospects'), 150, 'all on one page');
select is((public.agent_list_prospects(10, 'prospect 14', 0) ->> 'total')::int, 10, 'a search over them (Prospect 140 to 149)');
select is((public.agent_list_customers() ->> 'total')::int, 40, 'her 40 customers');
select is(jsonb_array_length(public.agent_list_customers(true, null, 200, 0) -> 'customers'), 40, 'on one page');
select pg_temp.as_connector(2, 2);
select is((public.agent_list_team(null, 200, 0) ->> 'total')::int, 49, 'Member 001 sees 49: seven under him and six under each of those');
select is((select string_agg(distinct x ->> 'level', ',') from jsonb_array_elements(public.agent_list_team(null, 200, 0) -> 'team') x), '1,2', 'at levels 1 and 2');
select is((public.agent_list_prospects(200, null, 0) ->> 'total')::int, (select count(*)::int from generate_series(1, 150) n where (n - 1) % 300 + 1 in (1) or (n - 1) % 300 + 1 between 7 and 13 or (n - 1) % 300 + 1 between 49 and 90),
  'his prospects are exactly those of his own downline');
select pg_temp.as_postgres();
select is((select count(*)::int from public.agent_audit where connection_id = pg_temp.conn(1)), 12, 'the leader''s calls: one audit row each (12 calls)');
select is((select count(*)::int from public.agent_audit where connection_id = pg_temp.conn(2)), 3, 'and the member''s: 3');

select * from finish();
rollback;
