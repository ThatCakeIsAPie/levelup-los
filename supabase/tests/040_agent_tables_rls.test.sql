-- Agent connector: row-level security and grants of the new tables (migration 20261025000100_agent_connector).
-- A person reads only their own connections (never the key hash) and their own audit rows; no client
-- writes anything; pairings and attempts are not reachable at all.
-- Self-contained: builds its own team (workspace agw), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

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

-- Audit rows: two for Alex's connection, one for Bea's, one for Lena's
insert into public.agent_audit (connection_id, person_id, workspace_id, tool, arguments, result, old_values, new_values) values
  (pg_temp.conn(1), 'aga', 'agw', 'update_prospect', '{"id":"agp1"}', 'updated agp1', '{"notes":"a"}', '{"notes":"b"}'),
  (pg_temp.conn(1), 'aga', 'agw', 'whoami', '{}', 'ok', null, null),
  (pg_temp.conn(3), 'agb', 'agw', 'whoami', '{}', 'ok', null, null),
  (pg_temp.conn(4), 'agl', 'agw', 'whoami', '{}', 'ok', null, null);

-- Schema and RLS ------------------------------------------------------------------------
select has_table('public', 'agent_pairings', 'agent_pairings exists');
select has_table('public', 'agent_connections', 'agent_connections exists');
select has_table('public', 'agent_audit', 'agent_audit exists');
select has_table('public', 'agent_pair_attempts', 'agent_pair_attempts exists');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('agent_pairings', 'agent_connections', 'agent_audit', 'agent_pair_attempts')
              and c.relrowsecurity), 4, 'row-level security is on for all four');

-- Grants: nothing for anon or service_role, no write for anyone, hashes unreadable
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'public' and table_name like 'agent\_%' and grantee in ('anon', 'PUBLIC', 'service_role')),
          0, 'anon, PUBLIC and service_role hold no privilege on the agent tables');
select is((select count(*)::int from information_schema.role_table_grants
            where table_schema = 'public' and table_name like 'agent\_%' and grantee = 'authenticated'
              and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
          0, 'signed-in people hold no write privilege on the agent tables');
select ok(not has_column_privilege('authenticated', 'public.agent_connections', 'key_hash', 'select'),
  'the key hash is not readable through the API');
select ok(has_column_privilege('authenticated', 'public.agent_connections', 'label', 'select'),
  'the label is');
select ok(not has_table_privilege('authenticated', 'public.agent_pairings', 'select'), 'pairings are not readable');
select ok(not has_table_privilege('authenticated', 'public.agent_pair_attempts', 'select'), 'attempts are not readable');
select ok(not has_table_privilege('authenticated', 'public.agent_audit', 'insert'), 'audit rows are not client-written');

-- Alex sees only his own connections ------------------------------------------------------
select pg_temp.as_ordinary('a');
select is((select count(*)::int from public.agent_connections), 3, 'Alex sees his three connections (one revoked)');
select is((select string_agg(label, ',' order by label) from public.agent_connections), 'Alex old,Alex read,Alex write',
  'and only those');
select is((select count(*)::int from public.agent_connections where person_id <> 'aga'), 0, 'none of anyone else''s');
select is((select revoked_at is not null from public.agent_connections where id = pg_temp.conn(5)), true,
  'he sees which one is revoked');
select throws_ok($$select * from public.agent_connections$$, '42501', null, 'select * is refused (the hash column is not granted)');
select throws_ok($$select key_hash from public.agent_connections$$, '42501', null, 'the key hash cannot be selected');
select throws_ok($$insert into public.agent_connections (user_id, person_id, workspace_id, label, key_hash, access)
  values ('00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'mine', repeat('a', 64), 'write')$$,
  '42501', null, 'he cannot make a connection himself');
select throws_ok($$update public.agent_connections set access = 'write' where id = pg_temp.conn(2)$$,
  '42501', null, 'he cannot change a connection''s access');
select throws_ok($$update public.agent_connections set revoked_at = null where id = pg_temp.conn(5)$$,
  '42501', null, 'he cannot bring a revoked connection back');
select throws_ok($$delete from public.agent_connections where id = pg_temp.conn(1)$$, '42501', null, 'he cannot delete one');
select throws_ok($$select id from public.agent_pairings$$, '42501', null, 'pairings are closed to him');
select throws_ok($$select id from public.agent_pair_attempts$$, '42501', null, 'attempts too');
select throws_ok($$insert into public.agent_pairings (code_hash, user_id, person_id, workspace_id, access, expires_at)
  values (repeat('b', 64), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now() + interval '1 hour')$$,
  '42501', null, 'he cannot make a pairing code himself');

-- The audit: his own rows only, with the details; nobody writes
select is((select count(*)::int from public.agent_audit), 2, 'Alex reads his two audit rows');
select is((select new_values ->> 'notes' from public.agent_audit where tool = 'update_prospect'), 'b',
  'with the values the agent changed');
select throws_ok($$insert into public.agent_audit (connection_id, person_id, workspace_id, tool)
  values (pg_temp.conn(1), 'aga', 'agw', 'made up')$$, '42501', null, 'he cannot write audit rows');
select throws_ok($$update public.agent_audit set result = 'nothing happened'$$, '42501', null, 'or edit them');
select throws_ok($$delete from public.agent_audit$$, '42501', null, 'or delete them');

-- Bea, and the leader: only their own
select pg_temp.as_ordinary('b');
select is((select count(*)::int from public.agent_connections), 1, 'Bea sees her one connection');
select is((select count(*)::int from public.agent_audit), 1, 'and her one audit row');
select pg_temp.as_ordinary('l');
select is((select count(*)::int from public.agent_connections), 1, 'the leader sees only her own connection, not her team''s');
select is((select count(*)::int from public.agent_audit where person_id <> 'agl'), 0,
  'and not what her team''s agents did: audit rows hold people''s details');

-- A login with no person, a candidate
select pg_temp.as_ordinary('c');
select is((select count(*)::int from public.agent_connections), 0, 'a login with no person sees no connections');
select is((select count(*)::int from public.agent_audit), 0, 'and no audit rows');
select pg_temp.as_ordinary('d');
select is((select count(*)::int from public.agent_connections), 0, 'a candidate sees none either');

-- Revoking: your own through the function, nobody else's, no delete -------------------------
select pg_temp.as_ordinary('b');
select throws_ok($$select public.revoke_agent_connection(pg_temp.conn(1))$$, 'PT404', null, 'Bea cannot revoke Alex''s connection');
select pg_temp.as_ordinary('c');
select throws_ok($$select public.revoke_agent_connection(pg_temp.conn(1))$$, 'PT404', null, 'a login with no person cannot either');
select pg_temp.as_ordinary('a');
select is((select pg_temp.q('select revoked_at is null from public.agent_connections where id = ''' || pg_temp.conn(1) || '''')), 'true',
  'Alex''s connection is live before');
select lives_ok($$select public.revoke_agent_connection(pg_temp.conn(1))$$, 'Alex revokes his own connection');
select is((select pg_temp.q('select revoked_at is not null from public.agent_connections where id = ''' || pg_temp.conn(1) || '''')), 'true',
  'it is marked revoked');
select is((select pg_temp.q('select count(*)::text from public.agent_connections where user_id = ''00000000-0000-4000-8000-0000000a9002''')),
  '3', 'and no row was deleted');
select throws_ok($$select public.revoke_agent_connection(pg_temp.conn(1))$$, 'PT404', null, 'revoking twice says there is no such live connection');
select throws_ok($$select public.revoke_agent_connection(gen_random_uuid())$$, 'PT404', null, 'an unknown id too');

select pg_temp.as_postgres();
select * from finish();
rollback;
