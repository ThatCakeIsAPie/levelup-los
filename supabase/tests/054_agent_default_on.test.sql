-- AI agents are on by default (migration 20261110000100_agents_on_by_default): a team with no
-- `agents` row in feature_switches has the feature on; an explicit row decides. Self-contained:
-- builds its own teams (dfw: no row, dfx: an explicit false row), all rolled back. Dates come from
-- public.workspace_today(<team>), never current_date.
begin;
create extension if not exists pgtap with schema extensions;
select plan(43);

-- Act as a login the way the app does (PostgREST): claims and the authenticated role, no connection.
create function pg_temp.login_id(p_who text) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000b900' || case p_who
           when 'l' then '1' when 'a' then '2' when 'b' then '3' when 'd' then '4' when 'c' then '5' else '6' end)::uuid $$;
create function pg_temp.as_ordinary(p_who text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login_id(p_who), 'role', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Act the way the Edge Function does: the login's claims, the connection id, `set local role authenticated`.
create function pg_temp.as_connector(p_who text, p_conn int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login_id(p_who), 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', ('00000000-0000-4000-8000-00000000d00' || p_conn)::uuid::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.agent_connection_id', '', true);
end $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000d00' || p_n)::uuid $$;
create function pg_temp.hash(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'utf8')), 'hex') $$;
-- One value from a statement run as the current role, or the error text (so a refusal is a
-- failed assertion, not an aborted file).
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute p_sql into v;
  return v;
exception when others then
  return 'ERROR: ' || sqlerrm;
end $$;
-- As in 041/042: a pgTAP session is not opened by agent_connector, so the one question
-- "was this session opened by the connector?" is answered yes (rolled back with the rest).
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;

-- Team dfw (no switch row): leader Lena, apprentice Alex, IBO Bea, candidate Dana; login c has no person.
-- Team dfx (an explicit false row): its leader Xena (login 6).
insert into public.workspaces (id, name) values ('dfw', 'Default Test Team'), ('dfx', 'Switched Off Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date, pipeline_stage) values
  ('dfl', 'dfw', 'Lena Leader', 'ibo', null, public.workspace_today('dfw') - 900, 'ibo'),
  ('dfa', 'dfw', 'Alex Apprentice', 'apprentice', 'dfl', public.workspace_today('dfw') - 100, 'apprentice'),
  ('dfb', 'dfw', 'Bea Ibo', 'ibo', 'dfl', public.workspace_today('dfw') - 700, 'ibo'),
  ('dfd', 'dfw', 'Dana Candidate', 'prospect', 'dfl', null, 'prospect'),
  ('dfp', 'dfw', 'Pat Prospect', 'prospect', 'dfa', null, 'prospect'),
  ('dxl', 'dfx', 'Xena Leader', 'ibo', null, public.workspace_today('dfx') - 900, 'ibo');
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-8000-0000000b900' || n)::uuid,
       'authenticated', 'authenticated', 'default-test-' || n || '@agent.test'
  from generate_series(1, 6) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('dfw', 'dfl', pg_temp.login_id('l'), 'leader'),
  ('dfw', 'dfa', pg_temp.login_id('a'), 'member'),
  ('dfw', 'dfb', pg_temp.login_id('b'), 'member'),
  ('dfw', 'dfd', pg_temp.login_id('d'), 'member'),
  ('dfx', 'dxl', pg_temp.login_id('x'), 'leader');
insert into public.feature_switches (workspace_id, feature, enabled) values ('dfx', 'agents', false);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access) values
  (pg_temp.conn(1), pg_temp.login_id('a'), 'dfa', 'dfw', 'Alex write', pg_temp.hash('key-1'), 'write'),
  (pg_temp.conn(3), pg_temp.login_id('b'), 'dfb', 'dfw', 'Bea write', pg_temp.hash('key-3'), 'write'),
  (pg_temp.conn(6), pg_temp.login_id('x'), 'dxl', 'dfx', 'Xena write', pg_temp.hash('key-6'), 'write');
select pg_temp.pretend_connector_session();

-- No row: on --------------------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.feature_switches where workspace_id = 'dfw'), 0, 'team dfw has no switch row at all');
select pg_temp.as_ordinary('a');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'no row: a registered member is allowed');
select is((select public.my_agent_access() ->> 'switch_on'), 'true', 'the switch reads as on');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'and it is not a preview');
select ok((select public.my_agent_access() ->> 'reason') is null, 'with no reason');
create temp table code_a (code text);
grant all on code_a to public;
select lives_ok($$insert into code_a select replace(public.create_agent_pairing('write') ->> 'code', '-', '')$$, 'no row: he can pair');
select is((select count(*)::int from code_a where code ~ '^[A-Z2-9]{16}$'), 1, 'and a code is issued');
select pg_temp.as_postgres();
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_a)), pg_temp.hash('new-key-a'), 'Fresh')),
  1, 'no row: the code redeems');
select pg_temp.as_connector('a', 1);
select lives_ok($$select public.agent_whoami()$$, 'no row: a connection calls a tool');
select is(pg_temp.try($$select public.agent_whoami() -> 'person' ->> 'name'$$), 'Alex Apprentice', 'and the call is as Alex');
select lives_ok($$select public.agent_add_prospect('Default On')$$, 'no row: a write tool works too');
select pg_temp.as_ordinary('l');
select is((select public.my_agent_access() ->> 'switch_on'), 'true', 'no row: the leader sees the switch on');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'not as a preview');
select pg_temp.as_ordinary('d');
select is((select public.my_agent_access() ->> 'reason'), 'not_registered', 'the default does not open it to a candidate');
select pg_temp.as_ordinary('c');
select is((select public.my_agent_access() ->> 'reason'), 'no_person', 'nor to a login with no person record');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', null, 'which still cannot pair');
select pg_temp.as_postgres();
select is((select allowed::text || ':' || switch_on::text || ':' || preview::text from agent_private.access_for(pg_temp.login_id('b'))),
  'true:true:false', 'access_for itself: allowed, switch on, no preview, with no row');
insert into public.app_admins (user_id) values (pg_temp.login_id('b'));
select is((select allowed::text || ':' || switch_on::text || ':' || preview::text from agent_private.access_for(pg_temp.login_id('b'))),
  'true:true:true', 'an app admin with no row: allowed because the switch is on (the preview flag is only set for admins)');
select pg_temp.as_ordinary('b');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'but my_agent_access reports no preview while the switch is on');

-- An explicit false row: off, as before; an app admin still previews ------------------------------------------
select pg_temp.as_postgres();
insert into public.feature_switches (workspace_id, feature, enabled) values ('dfw', 'agents', false);
select pg_temp.as_ordinary('a');
select is((select public.my_agent_access() ->> 'allowed'), 'false', 'explicit false: a member is refused');
select is((select public.my_agent_access() ->> 'reason'), 'switched_off', 'with the switched_off reason');
select is((select public.my_agent_access() ->> 'switch_on'), 'false', 'the switch reads as off');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', 'Agents are not switched on for this team',
  'explicit false: no new code');
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '42501', 'Agents are not switched on for this team',
  'flipping to false cuts a live connection on its next call');
select throws_ok($$select public.agent_add_prospect('Off')$$, '42501', null, 'writes too');
select pg_temp.as_ordinary('l');
select is((select public.my_agent_access() ->> 'allowed'), 'false', 'explicit false: the leader is refused too');
select pg_temp.as_ordinary('b');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'explicit false: an app admin is still allowed');
select is((select public.my_agent_access() ->> 'preview'), 'true', 'as a preview');
select pg_temp.as_connector('b', 3);
select is(pg_temp.try($$select public.agent_whoami() -> 'person' ->> 'name'$$), 'Bea Ibo', 'an app admin''s connection still works (preview)');
select pg_temp.as_postgres();
select is((select allowed::text || ':' || switch_on::text || ':' || preview::text from agent_private.access_for(pg_temp.login_id('a'))),
  'false:false:false', 'access_for: off, no preview for a member');

-- An explicit true row: on ------------------------------------------------------------------------------------------------
update public.feature_switches set enabled = true where workspace_id = 'dfw' and feature = 'agents';
select pg_temp.as_ordinary('a');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'explicit true: allowed');
select is((select public.my_agent_access() ->> 'switch_on'), 'true', 'switch on');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'no preview');
select pg_temp.as_connector('a', 1);
select lives_ok($$select public.agent_whoami()$$, 'explicit true: the connection works again');
select pg_temp.as_ordinary('b');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'explicit true: the admin is not a preview either');

-- true -> false cuts the connection on its next call, false -> row gone is on again ---------------------------
select pg_temp.as_postgres();
update public.feature_switches set enabled = false where workspace_id = 'dfw' and feature = 'agents';
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_list_prospects()$$, '42501', null, 'true -> false: refused on the next call');
select pg_temp.as_postgres();
delete from public.feature_switches where workspace_id = 'dfw' and feature = 'agents';
select pg_temp.as_connector('a', 1);
select lives_ok($$select public.agent_list_prospects()$$, 'row cleared: on again (the default)');

-- The default is per team: dfx stored false and stays off -------------------------------------------------------------
select pg_temp.as_ordinary('x');
select is((select public.my_agent_access() ->> 'allowed'), 'false', 'team dfx (explicit false) is off while team dfw (no row) is on');
select pg_temp.as_connector('x', 6);
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'and its connection is refused');
select pg_temp.as_postgres();
update public.feature_switches set enabled = true where workspace_id = 'dfx' and feature = 'agents';
select pg_temp.as_connector('x', 6);
select lives_ok($$select public.agent_whoami()$$, 'flipping dfx to true switches it on');

-- Nothing else widened ------------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select is((select count(*)::int from public.feature_switches where workspace_id = 'dfw'), 0, 'reading the switch never writes a row');
select is((select p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p
            where p.oid = 'agent_private.access_for(uuid)'::regprocedure), 'true:search_path=""', 'access_for is still security definer with an empty search_path');
select is(has_function_privilege('authenticated', 'agent_private.access_for(uuid)', 'execute')
          or has_function_privilege('anon', 'agent_private.access_for(uuid)', 'execute')
          or has_function_privilege('service_role', 'agent_private.access_for(uuid)', 'execute'), false,
  'and none of the app roles can execute it');

select * from finish();
rollback;
