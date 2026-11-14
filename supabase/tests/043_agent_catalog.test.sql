-- Agent connector: the catalog checks and the ordinary session (migrations 20261105000100 and 20261105000200).
--  * every function named agent_% in public is a SECURITY INVOKER tool that starts with the guard and is
--    executable only by the signed-in role; the list of tools is exactly the whitelist below, so adding
--    a tool means adding it here too, on purpose
--  * every table in public has row-level security (a new table without it fails this file)
--  * a session that was not opened by the connector role is refused by every agent_% function, even
--    when it sets the connection id itself.
-- Here the session is an ordinary one (session_user is not agent_connector), which is the real
-- condition under PostgREST too, so nothing is pretended in this file.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- The test team: workspace agw. Leader Lena (agl), apprentice Alex (aga), IBO Bea (agb) and a
-- candidate Dana (agd: a prospect with a login). Alex sponsors prospects agp1 and agp2, Bea sponsors
-- agp3. A fifth login (c) has no person record. The team's 'agents' switch is on. Connections:
-- 1 Alex write, 2 Alex read, 3 Bea write, 4 Lena write, 5 Alex write but revoked.

-- Act as a login the way the app does (PostgREST): claims and the authenticated role, no connection.
create function pg_temp.as_ordinary(p_who text) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', ('00000000-0000-4000-8000-0000000a900' || case p_who when 'l' then '1' when 'a' then '2' when 'b' then '3'
                                                                when 'd' then '4' else '5' end)::uuid,
    'role', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Act the way the Edge Function does: the login's claims, the connection id, `set local role authenticated`.
create function pg_temp.as_connector(p_who text, p_conn int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', ('00000000-0000-4000-8000-0000000a900' || case p_who when 'l' then '1' when 'a' then '2' when 'b' then '3'
                                                                when 'd' then '4' else '5' end)::uuid,
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
-- One value, read as the database owner without losing the current role.
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

-- A pgTAP session is not opened by agent_connector (and a plain `postgres` cannot
-- `set session authorization`), so for the tests that exercise the tools the one
-- question "was this session opened by the connector?" is answered yes. The statement is
-- rolled back with the rest. Every other check in the guard runs for real; the
-- real session check is covered by 043 (ordinary sessions are refused) and, with a real login
-- as agent_connector, by tests/integration/agentConnector.test.ts.
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;

insert into public.workspaces (id, name) values ('agw', 'Agent Test Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date, pipeline_stage, phone, notes) values
  ('agl', 'agw', 'Lena Leader', 'ibo', null, current_date - 900, 'ibo', null, null),
  ('aga', 'agw', 'Alex Apprentice', 'apprentice', 'agl', current_date - 100, 'apprentice', null, null),
  ('agb', 'agw', 'Bea Ibo', 'ibo', 'agl', current_date - 700, 'ibo', null, null),
  ('agd', 'agw', 'Dana Candidate', 'prospect', 'agl', null, 'prospect', null, null),
  ('agp1', 'agw', 'Pat Prospect One', 'prospect', 'aga', null, 'prospect', '555-0101', 'first note'),
  ('agp2', 'agw', 'Pia Prospect Two', 'prospect', 'aga', null, 'prospect', null, null),
  ('agp3', 'agw', 'Paul Prospect Three', 'prospect', 'agb', null, 'prospect', '555-0103', 'private to Bea');
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', ('00000000-0000-4000-8000-0000000a900' || n)::uuid,
       'authenticated', 'authenticated', 'agent-test-' || n || '@agent.test'
  from generate_series(1, 5) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('agw', 'agl', '00000000-0000-4000-8000-0000000a9001', 'leader'),
  ('agw', 'aga', '00000000-0000-4000-8000-0000000a9002', 'member'),
  ('agw', 'agb', '00000000-0000-4000-8000-0000000a9003', 'member'),
  ('agw', 'agd', '00000000-0000-4000-8000-0000000a9004', 'member');
insert into public.events (id, workspace_id, name, category_id, date, end_date, location) values
  ('age1', 'agw', 'Summit', 'agw-conference', current_date + 10, current_date + 11, 'Hall A'),
  ('age2', 'agw', 'Info session', 'agw-conference', current_date + 3, null, 'Room 2'),
  ('agex', 'agw', 'Running now', 'agw-conference', current_date - 1, current_date + 1, null),
  ('agep', 'agw', 'Last month', 'agw-conference', current_date - 30, null, null);
insert into public.feature_switches (workspace_id, feature, enabled) values ('agw', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(1), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'Alex write', pg_temp.hash('key-1'), 'write', null),
  (pg_temp.conn(2), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'Alex read', pg_temp.hash('key-2'), 'read', null),
  (pg_temp.conn(3), '00000000-0000-4000-8000-0000000a9003', 'agb', 'agw', 'Bea write', pg_temp.hash('key-3'), 'write', null),
  (pg_temp.conn(4), '00000000-0000-4000-8000-0000000a9001', 'agl', 'agw', 'Lena write', pg_temp.hash('key-4'), 'write', null),
  (pg_temp.conn(5), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'Alex old', pg_temp.hash('key-5'), 'write', now() - interval '1 day');

-- The whitelist -----------------------------------------------------------------------------------
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%'),
  array['agent_add_prospect', 'agent_export_events_ics', 'agent_get_person', 'agent_list_customers', 'agent_list_learning',
        'agent_list_prospects', 'agent_list_team', 'agent_list_upcoming_events', 'agent_log_learning', 'agent_set_event_answer',
        'agent_update_my_profile', 'agent_update_prospect', 'agent_whoami'],
  'the agent_ functions in public are exactly the thirteen tools');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%' and p.prosecdef), 0,
  'none of them is SECURITY DEFINER (they run as the person, so row-level security applies)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%' and p.prosrc not like '%agent_private.ctx(%'), 0,
  'every one starts with the guard, agent_private.ctx()');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%'
              and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 0,
  'and an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%'
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
                   or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))), 0,
  'none is executable by anon, service_role or PUBLIC');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%' and not has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'each one is executable by the signed-in role (the connector switches to it)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'agent_private'
              and (has_function_privilege('anon', p.oid, 'execute')
                   or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))), 0,
  'nothing in agent_private is executable by anon or PUBLIC');
select is((select count(*)::int from information_schema.schemata where schema_name = 'agent_private'), 1, 'agent_private exists');
select ok(not has_schema_privilege('anon', 'agent_private', 'usage'), 'anon has no use of agent_private');

-- Every table has row-level security ------------------------------------------------------------------
select is((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null::text[], 'every table in public has row-level security');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'agent_private' and c.relkind in ('r', 'p', 'v', 'm')), 0, 'agent_private holds no table or view');

-- An ordinary session is refused every tool -------------------------------------------------------------------
select pg_temp.as_ordinary('a');
select is((select pg_temp.q('select (session_user <> ''agent_connector'')::text')), 'true', 'this session was not opened by the connector role');
select throws_ok($$select public.agent_whoami()$$, '42501', 'agent functions can only be called through the connector', 'whoami');
select throws_ok($$select public.agent_list_prospects()$$, '42501', null, 'list_prospects');
select throws_ok($$select public.agent_add_prospect('Sneaky')$$, '42501', null, 'add_prospect');
select throws_ok($$select public.agent_update_prospect('agp1', '{"notes": "sneaky"}'::jsonb)$$, '42501', null, 'update_prospect');
select throws_ok($$select public.agent_list_upcoming_events()$$, '42501', null, 'list_upcoming_events');
select throws_ok($$select public.agent_export_events_ics()$$, '42501', null, 'export_events_ics');
select throws_ok($$select public.agent_set_event_answer('age1', 'yes')$$, '42501', null, 'set_event_answer');
select throws_ok($$select public.agent_list_team()$$, '42501', null, 'list_team');
select throws_ok($$select public.agent_list_customers()$$, '42501', null, 'list_customers');
select throws_ok($$select public.agent_get_person('agp1')$$, '42501', null, 'get_person');
select throws_ok($$select public.agent_update_my_profile('{"phone": "1"}'::jsonb)$$, '42501', null, 'update_my_profile');
select throws_ok($$select public.agent_log_learning('pages', 'x', 5)$$, '42501', null, 'log_learning');
select throws_ok($$select public.agent_list_learning()$$, '42501', null, 'list_learning');
-- even with a real connection id of the same login, set by the caller
select set_config('app.agent_connection_id', pg_temp.conn(1)::text, true);
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'with a live connection id set by the caller: whoami');
select throws_ok($$select public.agent_add_prospect('Sneaky')$$, '42501', null, 'add_prospect');
select throws_ok($$select public.agent_update_prospect('agp1', '{"notes": "sneaky"}'::jsonb)$$, '42501', null, 'update_prospect');
select throws_ok($$select public.agent_set_event_answer('age1', 'yes')$$, '42501', null, 'set_event_answer');
select throws_ok($$select public.agent_update_my_profile('{"phone": "sneaky"}'::jsonb)$$, '42501', null, 'update_my_profile');
select throws_ok($$select public.agent_log_learning('pages', 'sneaky', 5)$$, '42501', null, 'log_learning');
select throws_ok($$select public.agent_list_team()$$, '42501', null, 'list_team');
select pg_temp.as_postgres();
select is((select count(*)::int from public.agent_audit), 0, 'none of it wrote an audit row');
select is((select notes from public.people where id = 'agp1'), 'first note', 'or changed a prospect');
select is((select count(*)::int from public.people where phone = 'sneaky') + (select count(*)::int from public.learning where title = 'sneaky'), 0, 'or a profile or a learning entry');
select is((select count(*)::int from public.people where name = 'Sneaky'), 0, 'or added one');

-- The anonymous role cannot even call them
select pg_temp.as_postgres();
set local role anon;
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'anon: permission denied');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', null, 'anon cannot create a pairing');
select throws_ok($$select agent_private.ctx(false)$$, '42501', null, 'anon cannot reach agent_private');
reset role;

select * from finish();
rollback;
