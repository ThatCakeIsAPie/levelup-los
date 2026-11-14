-- Agent connector: pairing codes, redemption, the key lookup, throttling and housekeeping
-- (migration 20261025000100_agent_connector). Self-contained: builds its own team (agw), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(63);

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

select pg_temp.pretend_connector_session();

-- Who may add an agent ---------------------------------------------------------------------
select pg_temp.as_ordinary('a');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'an apprentice may, with the switch on');
select is((select public.my_agent_access() ->> 'preview'), 'false', 'and it is no preview');
select pg_temp.as_ordinary('l');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'the leader may');
select pg_temp.as_ordinary('b');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'an IBO may');
select pg_temp.as_ordinary('c');
select is((select public.my_agent_access() ->> 'reason'), 'no_person', 'a login with no person record is told so');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501',
  'This login is not attached to a person record in a team', 'and gets no code');
select pg_temp.as_ordinary('d');
select is((select public.my_agent_access() ->> 'reason'), 'not_registered', 'a candidate is not registered');
select throws_ok($$select public.create_agent_pairing('read')$$, '42501', null, 'and gets no code');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', null, 'not for write either');
select pg_temp.as_postgres();
select is((select count(*)::int from public.agent_pairings), 0, 'no code was made for them');

-- A code ------------------------------------------------------------------------------------
select pg_temp.as_ordinary('a');
select throws_ok($$select public.create_agent_pairing('admin')$$, '22023', null, 'the access is read or write');
select throws_ok($$select public.create_agent_pairing(null)$$, '22023', null, 'not null');
select matches((select public.create_agent_pairing('write') ->> 'code'), '^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$',
  'Alex gets a code of 16 symbols in four groups');
select is((select pg_temp.q('select count(*)::text from public.agent_pairings where user_id = ''00000000-0000-4000-8000-0000000a9002''')), '1',
  'one pairing row exists');
select is((select pg_temp.q('select (expires_at > now() + interval ''9 minutes'' and expires_at <= now() + interval ''10 minutes'')::text from public.agent_pairings')),
  'true', 'it expires in ten minutes');
select is((select pg_temp.q('select access from public.agent_pairings')), 'write', 'for the access asked');
select is((select pg_temp.q('select (used_at is null)::text from public.agent_pairings')), 'true', 'unused');

-- What is stored is a hash of the code, never the code
select pg_temp.as_postgres();
create temp table code_seen (code text);
grant all on code_seen to public;
select pg_temp.as_ordinary('a');
insert into code_seen select public.create_agent_pairing('read') ->> 'code';
select is((select pg_temp.q('select count(*)::text from public.agent_pairings p, code_seen c where p.code_hash = encode(sha256(convert_to(replace(c.code, ''-'', ''''), ''utf8'')), ''hex'')')),
  '1', 'the row holds the SHA-256 of the code without dashes');
select is((select pg_temp.q('select count(*)::text from public.agent_pairings p, code_seen c where p.code_hash = c.code or p.code_hash = replace(c.code, ''-'', '''')')),
  '0', 'and not the code');

-- Limits: five unused codes
select lives_ok($$select public.create_agent_pairing('write')$$, 'a third code');
select lives_ok($$select public.create_agent_pairing('write')$$, 'a fourth');
select lives_ok($$select public.create_agent_pairing('write')$$, 'a fifth');
select throws_ok($$select public.create_agent_pairing('write')$$, '54000', null, 'a sixth unused code is refused');

-- Redeeming (as the connector would): single use ----------------------------------------------
select pg_temp.as_postgres();
delete from public.agent_pairings;
create temp table code_a (code text);
grant all on code_a to public;
select pg_temp.as_ordinary('a');
insert into code_a select replace(public.create_agent_pairing('write') ->> 'code', '-', '');
select pg_temp.as_postgres();
select is((select count(*)::int from agent_private.connector_redeem('0000000000000000000000000000000000000000000000000000000000000000', pg_temp.hash('new-key-1'), 'Dot')),
  0, 'a code that was never issued gives nothing');
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_a)), pg_temp.hash('new-key-1'), 'Dot')),
  1, 'the right code makes a connection');
select is((select count(*)::int from public.agent_connections where key_hash = pg_temp.hash('new-key-1') and person_id = 'aga'
            and user_id = '00000000-0000-4000-8000-0000000a9002' and workspace_id = 'agw' and access = 'write' and label = 'Dot' and revoked_at is null),
  1, 'for Alex, with his access, holding only the hash of the key');
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_a)), pg_temp.hash('new-key-2'), 'Again')),
  0, 'the same code a second time gives nothing (single use)');
select is((select count(*)::int from public.agent_connections where label = 'Again'), 0, 'and no second connection');
select is((select count(*)::int from public.agent_pairings where used_at is not null), 1, 'the pairing is marked used');

-- Expired, and a read pairing
select pg_temp.as_ordinary('a');
create temp table code_b (code text);
grant all on code_b to public;
insert into code_b select replace(public.create_agent_pairing('read') ->> 'code', '-', '');
select pg_temp.as_postgres();
update public.agent_pairings set expires_at = now() - interval '1 second' where code_hash = pg_temp.hash((select code from code_b));
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_b)), pg_temp.hash('new-key-3'), 'Late')),
  0, 'an expired code gives nothing');
update public.agent_pairings set expires_at = now() + interval '5 minutes' where code_hash = pg_temp.hash((select code from code_b));
select is((select access from agent_private.connector_redeem(pg_temp.hash((select code from code_b)), pg_temp.hash('new-key-3'), 'Reader')),
  'read', 'a read pairing makes a read connection');

-- The team switch off: nothing redeems, an app admin may still preview -------------------------
select pg_temp.as_ordinary('a');
create temp table code_c (code text);
grant all on code_c to public;
insert into code_c select replace(public.create_agent_pairing('write') ->> 'code', '-', '');
select pg_temp.as_postgres();
update public.feature_switches set enabled = false where workspace_id = 'agw' and feature = 'agents';
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_c)), pg_temp.hash('new-key-4'), 'Off')),
  0, 'with the switch off a code already issued is not redeemed');
select pg_temp.as_ordinary('a');
select is((select public.my_agent_access() ->> 'reason'), 'switched_off', 'Alex is told the switch is off');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', 'Agents are not switched on for this team',
  'and gets no new code');
select pg_temp.as_postgres();
insert into public.app_admins (user_id) values ('00000000-0000-4000-8000-0000000a9003');
select pg_temp.as_ordinary('b');
select is((select public.my_agent_access() ->> 'allowed'), 'true', 'an app admin is allowed with the switch off');
select is((select public.my_agent_access() ->> 'preview'), 'true', 'as a preview');
select matches((select public.create_agent_pairing('write') ->> 'code'), '^[A-Z2-9-]{19}$', 'and gets a code');
select pg_temp.as_ordinary('c');
select throws_ok($$select public.create_agent_pairing('write')$$, '42501', null, 'an app admin''s preview does not rescue a login with no person');
select pg_temp.as_postgres();
update public.feature_switches set enabled = true where workspace_id = 'agw' and feature = 'agents';
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_c)), pg_temp.hash('new-key-4'), 'On again')),
  1, 'switched back on, the unused code works');

-- A person who stopped being registered cannot redeem
select pg_temp.as_ordinary('a');
create temp table code_d (code text);
grant all on code_d to public;
insert into code_d select replace(public.create_agent_pairing('write') ->> 'code', '-', '');
select pg_temp.as_postgres();
update public.people set biz_class = 'prospect', pipeline_stage = 'prospect', business_start_date = null where id = 'aga';
select is((select count(*)::int from agent_private.connector_redeem(pg_temp.hash((select code from code_d)), pg_temp.hash('new-key-5'), 'Demoted')),
  0, 'a person who is no longer registered redeems nothing');
update public.people set biz_class = 'apprentice', pipeline_stage = 'apprentice', business_start_date = current_date - 100 where id = 'aga';

-- The key lookup -------------------------------------------------------------------------------
select is((select count(*)::int from agent_private.connector_lookup(pg_temp.hash('new-key-1'))), 1, 'a live key finds its connection');
select is((select person_id || '/' || workspace_name || '/' || label || '/' || access from agent_private.connector_lookup(pg_temp.hash('new-key-1'))),
  'aga/Agent Test Team/Dot/write', 'with the person, the team''s name and the access');
select is((select count(*)::int from agent_private.connector_lookup(pg_temp.hash('no-such-key'))), 0, 'an unknown key finds nothing');
select is((select last_used_at is not null from public.agent_connections where key_hash = pg_temp.hash('new-key-1')), true,
  'looking it up marked it used');
update public.agent_connections set last_used_at = now() - interval '30 seconds' where key_hash = pg_temp.hash('new-key-1');
create temp table seen_at (t timestamptz);
insert into seen_at select last_used_at from public.agent_connections where key_hash = pg_temp.hash('new-key-1');
select lives_ok($$select * from agent_private.connector_lookup(pg_temp.hash('new-key-1'))$$, 'looking it up again');
select is((select last_used_at = (select t from seen_at) from public.agent_connections where key_hash = pg_temp.hash('new-key-1')), true,
  'within a minute it is not touched again');
update public.agent_connections set last_used_at = now() - interval '2 minutes' where key_hash = pg_temp.hash('new-key-1');
select lives_ok($$select * from agent_private.connector_lookup(pg_temp.hash('new-key-1'))$$, 'and once more');
select is((select last_used_at > now() - interval '10 seconds' from public.agent_connections where key_hash = pg_temp.hash('new-key-1')), true,
  'after a minute it is');
update public.agent_connections set revoked_at = now() where key_hash = pg_temp.hash('new-key-1');
select is((select count(*)::int from agent_private.connector_lookup(pg_temp.hash('new-key-1'))), 0, 'a revoked key finds nothing');

-- Throttling failed attempts by address
select is(agent_private.connector_pair_blocked('aaaaaaaaaaaaaaaa'), false, 'a clean address is not blocked');
select agent_private.connector_pair_failed('aaaaaaaaaaaaaaaa') from generate_series(1, 7);
select is(agent_private.connector_pair_blocked('aaaaaaaaaaaaaaaa'), false, 'seven failures: not yet');
select agent_private.connector_pair_failed('aaaaaaaaaaaaaaaa');
select is(agent_private.connector_pair_blocked('aaaaaaaaaaaaaaaa'), true, 'the eighth blocks the address');
select is(agent_private.connector_pair_blocked('bbbbbbbbbbbbbbbb'), false, 'another address is not blocked');
update public.agent_pair_attempts set at = now() - interval '11 minutes';
select is(agent_private.connector_pair_blocked('aaaaaaaaaaaaaaaa'), false, 'ten minutes later it is free again');
select agent_private.connector_pair_failed('cccc' || lpad(n::text, 4, '0')) from generate_series(1, 100) n;
select is(agent_private.connector_pair_blocked('dddddddddddddddd'), true, 'a hundred failures from anywhere block everyone for a while');
select throws_ok($$select agent_private.connector_pair_failed('x')$$, '22023', null, 'a malformed address hash is refused');

-- A refusal the tool could not write itself
select agent_private.connector_refusal(gen_random_uuid(), 'add_prospect', '{}', 'unknown connection');
select is((select count(*)::int from public.agent_audit), 0, 'a refusal for a connection that does not exist leaves no row');
select agent_private.connector_refusal(pg_temp.conn(3), 'add_prospect', '{"name":"x"}', 'refused: read-only connection');
select is((select tool || ' | ' || result || ' | ' || person_id from public.agent_audit where connection_id = pg_temp.conn(3)),
  'add_prospect | refused: read-only connection | agb', 'a refusal is recorded for the connection''s person');

-- Housekeeping -------------------------------------------------------------------------------
delete from public.agent_pairings;
delete from public.agent_pair_attempts;
delete from public.agent_audit;
insert into public.agent_pairings (id, code_hash, user_id, person_id, workspace_id, access, created_at, expires_at, used_at) values
  (gen_random_uuid(), pg_temp.hash('h1'), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now() - interval '3 days', now() - interval '3 days', now() - interval '3 days'),
  (gen_random_uuid(), pg_temp.hash('h2'), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now() - interval '2 days', now() - interval '2 days', null),
  (gen_random_uuid(), pg_temp.hash('h3'), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now() - interval '2 hours', now() - interval '110 minutes', now() - interval '3 hours'),
  (gen_random_uuid(), pg_temp.hash('h4'), '00000000-0000-4000-8000-0000000a9002', 'aga', 'agw', 'write', now(), now() + interval '10 minutes', null);
insert into public.agent_pair_attempts (ip_hash, at) values ('eeeeeeee', now() - interval '2 days'), ('eeeeeeee', now() - interval '1 hour');
insert into public.agent_audit (connection_id, person_id, workspace_id, tool, at) values
  (pg_temp.conn(3), 'agb', 'agw', 'whoami', now() - interval '181 days'),
  (pg_temp.conn(3), 'agb', 'agw', 'whoami', now() - interval '179 days'),
  (pg_temp.conn(3), 'agb', 'agw', 'whoami', now());
select is(public.purge_agent_housekeeping(), '{"pairings": 2, "attempts": 1, "audit": 1}'::jsonb,
  'housekeeping reports what it removed: old used and expired pairings, old attempts, audit past 180 days');
select is((select count(*)::int from public.agent_pairings), 2, 'a pairing used or expired within the day, and a live one, stay');
select is((select count(*)::int from public.agent_pair_attempts), 1, 'a recent attempt stays');
select is((select count(*)::int from public.agent_audit), 2, 'recent audit rows stay');
select pg_temp.as_ordinary('a');
select throws_ok($$select public.purge_agent_housekeeping()$$, '42501', null, 'a signed-in person cannot run it');
select pg_temp.as_postgres();

select * from finish();
rollback;
