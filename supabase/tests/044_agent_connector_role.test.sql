-- Agent connector: how the connector role is confined (migration 20261025000100_agent_connector).
-- It can do exactly three things: look a connection up by key hash, redeem a pairing code and record
-- attempts (SECURITY DEFINER functions in agent_private, executable only by it), and `set role authenticated`.
-- It owns nothing and holds no table privilege. Self-contained, rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

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

select is((select count(*)::int from pg_roles where rolname = 'agent_connector'), 1, 'the role exists');
select is((select (rolcanlogin)::text from pg_roles where rolname = 'agent_connector'), 'false',
  'created NOLOGIN: a deployment gives it a password and login outside the repository');
select is((select rolsuper or rolcreatedb or rolcreaterole or rolbypassrls or rolreplication or rolinherit
             from pg_roles where rolname = 'agent_connector'), false,
  'no superuser, createdb, createrole, bypassrls, replication, and NOINHERIT');
select is((select array_agg(r.rolname::text order by r.rolname) from pg_auth_members m
             join pg_roles r on r.oid = m.roleid where m.member = (select oid from pg_roles where rolname = 'agent_connector')),
  array['authenticated'], 'its only membership is the authenticated role (to `set role` to it)');
select is((select count(*)::int from pg_class where relowner = (select oid from pg_roles where rolname = 'agent_connector')), 0, 'it owns no relation');
select is((select count(*)::int from pg_proc where proowner = (select oid from pg_roles where rolname = 'agent_connector')), 0, 'no function');
select is((select count(*)::int from pg_namespace where nspowner = (select oid from pg_roles where rolname = 'agent_connector')), 0, 'no schema');
select is((select count(*)::int from information_schema.role_table_grants where grantee = 'agent_connector'), 0, 'no table privilege is granted to it');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname in ('public', 'agent_private') and c.relkind in ('r', 'p', 'v', 'm')
              and has_table_privilege('agent_connector', c.oid, 'select, insert, update, delete, truncate, references, trigger')), 0,
  'and it holds none on any table or view in public or agent_private');
select ok(has_schema_privilege('agent_connector', 'agent_private', 'usage'), 'it may use the private schema');
select is((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'agent_private' and has_function_privilege('agent_connector', p.oid, 'execute')),
  array['connector_lookup', 'connector_pair_blocked', 'connector_pair_failed', 'connector_redeem', 'connector_refusal'],
  'the functions in agent_private it may execute are exactly the five it needs');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'agent_private' and p.proname like 'connector\_%'
              and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 0,
  'each of them is SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'agent_private' and p.proname like 'connector\_%'
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                   or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'and no other role may execute them');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'agent_private' and p.prosecdef and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 0,
  'every SECURITY DEFINER function in agent_private has an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and p.proname in ('my_agent_access', 'create_agent_pairing', 'revoke_agent_connection', 'purge_agent_housekeeping')
              and (p.proconfig is null or not ('search_path=""' = any (p.proconfig)))), 0,
  'the new SECURITY DEFINER functions in public have an empty search_path too');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('my_agent_access', 'create_agent_pairing', 'revoke_agent_connection')
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
                   or not has_function_privilege('authenticated', p.oid, 'execute'))), 0,
  'the app''s functions are executable by signed-in people only');
select ok(not has_function_privilege('authenticated', 'public.purge_agent_housekeeping()', 'execute')
          and has_function_privilege('service_role', 'public.purge_agent_housekeeping()', 'execute'),
  'housekeeping is for the service role only');

-- The connector functions refuse a session that is not the connector's (the real session check) ---
select throws_ok($$select * from agent_private.connector_lookup(repeat('a', 64))$$, '42501', 'only the connector role may call this', 'lookup');
select throws_ok($$select * from agent_private.connector_redeem(repeat('a', 64), repeat('b', 64), 'x')$$, '42501', null, 'redeem');
select throws_ok($$select agent_private.connector_pair_blocked('aaaaaaaaaaaaaaaa')$$, '42501', null, 'throttle check');
select throws_ok($$select agent_private.connector_pair_failed('aaaaaaaaaaaaaaaa')$$, '42501', null, 'throttle record');
select throws_ok($$select agent_private.connector_refusal(gen_random_uuid(), 't', '{}', 'r')$$, '42501', null, 'refusal row');
select pg_temp.as_ordinary('a');
select throws_ok($$select * from agent_private.connector_lookup(repeat('a', 64))$$, '42501', null, 'a signed-in person: permission denied on lookup');
select throws_ok($$select * from agent_private.connector_redeem(repeat('a', 64), repeat('b', 64), 'x')$$, '42501', null, 'and on redeem');
select throws_ok($$select * from agent_private.access_for(gen_random_uuid())$$, '42501', null, 'and on the access check');
select pg_temp.as_postgres();

-- Hashes are what they say
select throws_ok($$insert into public.agent_connections (user_id, person_id, workspace_id, label, key_hash, access)
  values ('00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'plain key', 'crmak_not_a_hash', 'write')$$,
  '23514', null, 'a connection row cannot hold anything but a SHA-256 hex hash');
select throws_ok($$insert into public.agent_pairings (code_hash, user_id, person_id, workspace_id, access, expires_at)
  values ('ABCD-EFGH-JKLM-NPQR', '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now() + interval '1 minute')$$,
  '23514', null, 'nor a pairing row anything but a hash of the code');
select throws_ok($$insert into public.feature_switches (workspace_id, feature, enabled) values ('agw', 'nonsense', true)$$,
  '23514', null, 'the feature switch accepts agents and still refuses unknown features');
select lives_ok($$insert into public.feature_switches (workspace_id, feature, enabled) values ('agw', 'agents', true) on conflict do nothing$$,
  'agents is a feature');

select * from finish();
rollback;
