-- Agent connector: the tools, run the way the Edge Function runs them (migration 20261105000200_agent_tools).
-- Each call: the login's claims and the connection id in settings, `set local role authenticated`, then the tool.
-- Row-level security decides what a person sees and changes; the guard refuses read connections, revoked ones,
-- someone else's, and everything once the team's switch is off. Self-contained (workspace agw), all rolled back.
-- (A pgTAP session is not opened by the connector role; see the note in 043 and pretend_connector_session().)
begin;
create extension if not exists pgtap with schema extensions;
select plan(113);

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
create function pg_temp.audits(p_conn int) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || '''')::int $$;
create function pg_temp.person_row(p_id text) returns text language sql as $$
  select pg_temp.q('select concat_ws(''|'', name, coalesce(phone, ''~''), coalesce(email, ''~''), coalesce(location, ''~''), coalesce(notes, ''~''), biz_class, sponsor_id, pipeline_stage) from public.people where id = '''
                   || p_id || '''') $$;

-- Who sees which prospects --------------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select is((select jsonb_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(public.agent_list_prospects() -> 'prospects') x)::text,
  '["agp1", "agp2"]', 'Alex''s agent sees his two prospects, not Bea''s');
select pg_temp.as_connector('b', 3);
select is((select jsonb_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(public.agent_list_prospects() -> 'prospects') x)::text,
  '["agp3"]', 'Bea''s agent sees only hers: not Alex''s, who is on the same level');
select pg_temp.as_connector('l', 4);
select is((select jsonb_agg(x ->> 'id' order by x ->> 'id') from jsonb_array_elements(public.agent_list_prospects() -> 'prospects') x)::text,
  '["agd", "agp1", "agp2", "agp3"]', 'the leader''s agent sees her whole team''s prospects (Dana, a prospect who has a login, among them)');
select is((select jsonb_array_length(public.agent_list_prospects(1) -> 'prospects')), 1, 'a limit is honoured');
select is(((select public.agent_list_prospects() -> 'prospects' -> 0) ?& array['id', 'full_name', 'phone', 'email', 'location', 'notes']), true,
  'each prospect has id, full_name, phone, email, location and notes (047 checks the rest of the shape)');
select pg_temp.as_connector('a', 1);
select is((select count(*)::int from public.people where id in ('agl', 'agb', 'agp3', 'agd')), 0,
  'Alex sees neither his leader, nor Bea, nor Bea''s prospect: row-level security, the tools add nothing');

-- whoami ------------------------------------------------------------------------------------------
select is((select public.agent_whoami() -> 'person' ->> 'name'), 'Alex Apprentice', 'whoami names the person');
select is((select public.agent_whoami() ->> 'team'), 'Agent Test Team', 'and the team');
select is((select public.agent_whoami() ->> 'access'), 'write', 'and what the connection may do');
select is((select public.agent_whoami() -> 'person' ->> 'stage'), 'apprentice', 'and the stage');
select is((((select public.agent_whoami()) -> 'person') ? 'ibo_number'), false, 'but no IBO number');
select pg_temp.as_connector('l', 4);
select is((select public.agent_whoami() ->> 'team_role'), 'leader', 'the leader''s role is leader');

-- add_prospect --------------------------------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select is((select count(*)::int from public.people where biz_class = 'prospect'), 2, 'Alex sees 2 prospects before');
select is((select public.agent_add_prospect('  Quinn Newlead ', '555-0199') ->> 'name'), 'Quinn Newlead', 'he adds one (the name is trimmed)');
select is((select count(*)::int from public.people where biz_class = 'prospect'), 3, 'and sees 3 after');
select is((select pg_temp.q('select concat_ws(''|'', biz_class, pipeline_stage, sponsor_id, phone, workspace_id, jsonb_array_length(stage_history)::text) from public.people where name = ''Quinn Newlead''')),
  'prospect|prospect|aga|555-0199|agw|1', 'a prospect under him, in his team, with its stage history');
select is((select pg_temp.q('select count(*)::text from public.people where workspace_id = ''agw'' and biz_class = ''prospect''')), '5', 'the team has 5 prospects in all');
select is((select public.agent_add_prospect('   ') ->> 'error'), 'A name of 1 to 120 characters is required (phone at most 40).', 'a blank name is refused');
select is((select public.agent_add_prospect(repeat('x', 121)) ->> 'error' is not null), true, 'so is a name over 120 characters');
select is((select public.agent_add_prospect('Fine Name', repeat('1', 41)) ->> 'error' is not null), true, 'and a phone over 40');
select is((select pg_temp.q('select count(*)::text from public.people where workspace_id = ''agw'' and biz_class = ''prospect''')), '5', 'nothing was added by the refused calls');
select is((select pg_temp.q('select new_values ->> ''name'' from public.agent_audit where tool = ''add_prospect'' and result like ''created %''')),
  'Quinn Newlead', 'the audit row of the addition holds what was created');
select is((select pg_temp.q('select count(*)::text from public.agent_audit where tool = ''add_prospect'' and result like ''refused:%''')), '3',
  'and the refused attempts are audited too');

-- update_prospect: the whitelist ---------------------------------------------------------------------
select is((select public.agent_update_prospect('agp1', '{"phone": "555-0111", "notes": "called, call back Friday"}'::jsonb) ->> 'phone'),
  '555-0111', 'Alex changes his prospect''s phone and notes');
select is((select pg_temp.person_row('agp1')), 'Pat Prospect One|555-0111|~|~|called, call back Friday|prospect|aga|prospect'::text,
  'the row holds the new values and nothing else moved');
select is((select pg_temp.q('select (old_values ->> ''notes'') || ''>'' || (new_values ->> ''notes'') from public.agent_audit where tool = ''update_prospect'' and result = ''updated agp1''')),
  'first note>called, call back Friday', 'the audit row has the old and the new values');
select is((select public.agent_update_prospect('agp1', '{"email": "pat@agent.test", "location": "Austin"}'::jsonb) ->> 'location'), 'Austin',
  'email and location can be changed too');
select is((select public.agent_update_prospect('agp1', '{"phone": null}'::jsonb) ->> 'phone' is null), true, 'null clears a field');
select is((select public.agent_update_prospect('agp1', '{"name": "  Patricia One "}'::jsonb) ->> 'name'), 'Patricia One', 'the name can be changed (trimmed)');
select is((select pg_temp.person_row('agp1')), 'Patricia One|~|pat@agent.test|Austin|called, call back Friday|prospect|aga|prospect'::text, 'as the row shows');

select is((select count(*)::int from unnest(array['biz_class', 'sponsor_id', 'pipeline_stage', 'business_start_date', 'ibo_number', 'ltd_number',
                'stage_history', 'id', 'workspace_id', 'owner_id', 'tags', 'joined_date', 'monthly_volume', 'referred_by', 'los_uid']) k
            where public.agent_update_prospect('agp1', jsonb_build_object(k, 'x')) ->> 'error' is null), 0,
  'stage, sponsor, IBO#, LTD#, start date and every other field outside the whitelist are rejected');
select is((select public.agent_update_prospect('agp1', '{"biz_class": "ibo"}'::jsonb) ->> 'error'),
  'Only name, phone, email, location and notes can be changed; "biz_class" cannot. Nothing was changed.', 'with a clear message');
select is((select public.agent_update_prospect('agp1', '{"notes": "sneaky", "sponsor_id": "agl"}'::jsonb) ->> 'error' is not null), true,
  'one bad key rejects the whole patch');
select is((select pg_temp.person_row('agp1')), 'Patricia One|~|pat@agent.test|Austin|called, call back Friday|prospect|aga|prospect'::text,
  'and the good key in it was not applied either');
select is((select public.agent_update_prospect('agp1', '{}'::jsonb) ->> 'error' is not null), true, 'an empty patch is refused');
select is((select public.agent_update_prospect('agp1', '{"name": null}'::jsonb) ->> 'error' is not null), true, 'a name cannot be cleared');
select is((select public.agent_update_prospect('agp1', '{"phone": 5}'::jsonb) ->> 'error' is not null), true, 'a number is not text');
select is((select public.agent_update_prospect('agp1', jsonb_build_object('notes', repeat('n', 4001))) ->> 'error' is not null), true, 'notes are limited to 4000 characters');
select is((select public.agent_update_prospect('agp1', '[1]'::jsonb) ->> 'error' is not null), true, 'a patch that is not an object is refused');
select is((select pg_temp.person_row('agp1')), 'Patricia One|~|pat@agent.test|Austin|called, call back Friday|prospect|aga|prospect'::text,
  'none of those changed anything');

-- update_prospect: what row-level security decides -----------------------------------------------------------
select is((select public.agent_update_prospect('agp3', '{"notes": "Alex was here"}'::jsonb) ->> 'error'),
  'No such prospect among the people you can see. Nothing was changed.', 'Alex''s agent cannot change Bea''s prospect');
select is((select pg_temp.person_row('agp3')), 'Paul Prospect Three|555-0103|~|~|private to Bea|prospect|agb|prospect'::text, 'which stays exactly as it was');
select is((select public.agent_update_prospect('agb', '{"name": "Renamed"}'::jsonb) ->> 'error' is not null), true,
  'a person who is not a prospect cannot be changed through this tool');
select is((select public.agent_update_prospect('does-not-exist', '{"name": "x"}'::jsonb) ->> 'error' is not null), true, 'neither can an unknown id');
select is((select pg_temp.q('select name from public.people where id = ''agb''')), 'Bea Ibo', 'Bea''s own record is untouched');
select is((select pg_temp.q('select result from public.agent_audit where connection_id = ''' || pg_temp.conn(1) || ''' and arguments ->> ''id'' = ''agp3'' ')),
  'refused: no such prospect among the visible ones', 'the refusal is audited');
select pg_temp.as_connector('l', 4);
select is((select public.agent_update_prospect('agp3', '{"notes": "the leader edits her downline"}'::jsonb) ->> 'notes'),
  'the leader edits her downline', 'the leader''s agent can change a prospect anywhere in her team');
select pg_temp.as_connector('b', 3);
select is((select public.agent_update_prospect('agp1', '{"notes": "Bea was here"}'::jsonb) ->> 'error' is not null), true,
  'Bea''s agent cannot change Alex''s prospect');
select is((select pg_temp.person_row('agp1')), 'Patricia One|~|pat@agent.test|Austin|called, call back Friday|prospect|aga|prospect'::text, 'it is unchanged');

-- Events ---------------------------------------------------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select is((select jsonb_agg(x ->> 'id' order by x ->> 'start_date', x ->> 'id') from jsonb_array_elements(public.agent_list_upcoming_events() -> 'events') x)::text,
  '["agex", "age2", "age1"]', 'upcoming events: the one running now, the next, the later; not the past one');
select is(((select public.agent_list_upcoming_events() -> 'events' -> 2) ?& array['id', 'uid', 'summary', 'location', 'category', 'last_modified', 'all_day', 'start_date', 'end_date_exclusive', 'my_answer', 'partstat']), true,
  'each has id, uid, summary, location, category, last_modified, all_day, start and end dates, my answer and partstat (the shape is checked in 046)');
select is((select public.agent_list_upcoming_events() -> 'events' -> 2 ->> 'category' is not null), true, 'the category is named');
select is((select public.agent_list_upcoming_events() -> 'events' -> 2 ->> 'my_answer' is null), true, 'no answer yet');
select is((select pg_temp.q('select count(*)::text from public.attendances where workspace_id = ''agw''')), '0', 'there are no attendance rows before');
select is((select public.agent_set_event_answer('age1', 'yes') ->> 'answer'), 'yes', 'Alex''s agent answers yes');
select is((select public.agent_list_upcoming_events() -> 'events' -> 2 ->> 'my_answer'), 'yes', 'the list shows it');
select is((select pg_temp.q('select count(*)::text from public.attendances where event_id = ''age1''')), '1', 'one attendance row');
select is((select pg_temp.q('select person_id from public.attendances where event_id = ''age1''')), 'aga', 'his own');
select is((select public.agent_set_event_answer('age1', 'maybe') ->> 'answer'), 'maybe', 'he changes his mind');
select is((select pg_temp.q('select count(*)::text from public.attendances where event_id = ''age1''')), '1', 'still one row');
select is((select pg_temp.q('select (old_values ->> ''answer'') || ''>'' || (new_values ->> ''answer'') from public.agent_audit where tool = ''set_event_answer'' and result = ''set maybe''')),
  'yes>maybe', 'the audit row has the old and new answer');
select is((select public.agent_set_event_answer('age1', 'attending') ->> 'error'), 'The answer must be yes, no or maybe.', 'another word is refused');
select is((select public.agent_set_event_answer('nope', 'yes') ->> 'error'), 'No such event.', 'an unknown event too');
select is((select pg_temp.q('select count(*)::text from public.attendances where workspace_id = ''agw''')), '1', 'nothing else was written');
select is((select pg_temp.q('select count(*)::text from public.attendances where workspace_id = ''agw'' and person_id <> ''aga''')), '0', 'and nobody else''s answer exists');
select pg_temp.as_connector('b', 3);
select is((select public.agent_list_upcoming_events() -> 'events' -> 2 ->> 'my_answer' is null), true, 'Bea''s own answer is still empty');

-- A read connection: reads, never writes ---------------------------------------------------------------------------
select pg_temp.as_connector('a', 2);
select is((select jsonb_array_length(public.agent_list_prospects() -> 'prospects')), 3, 'a read connection lists');
select is((select jsonb_array_length(public.agent_list_upcoming_events() -> 'events')), 3, 'and reads events');
select is((select public.agent_whoami() ->> 'access'), 'read', 'and says it is read-only');
select throws_ok($$select public.agent_add_prospect('Nope')$$, '42501', 'this connection is read-only', 'it cannot add');
select throws_ok($$select public.agent_update_prospect('agp2', '{"notes": "x"}'::jsonb)$$, '42501', 'this connection is read-only', 'or update');
select throws_ok($$select public.agent_set_event_answer('age2', 'yes')$$, '42501', 'this connection is read-only', 'or answer');
select is((select pg_temp.person_row('agp2')), 'Pia Prospect Two|~|~|~|~|prospect|aga|prospect'::text, 'nothing changed');
select is((select pg_temp.q('select count(*)::text from public.attendances where workspace_id = ''agw''')), '1', 'no attendance was written');
select is((select pg_temp.q('select count(*)::text from public.people where workspace_id = ''agw'' and biz_class = ''prospect''')), '5', 'and no prospect was added');
select is(pg_temp.audits(2), 3, 'the three reads are audited; the three refused writes left no row (the function records those itself)');

-- A revoked connection, someone else's, none -------------------------------------------------------------------------
select pg_temp.as_connector('a', 5);
select throws_ok($$select public.agent_whoami()$$, '28000', 'agent connection is not active', 'a revoked connection is refused');
select throws_ok($$select public.agent_list_prospects()$$, '28000', null, 'for every tool');
select pg_temp.as_connector('a', 3);
select throws_ok($$select public.agent_whoami()$$, '28000', 'agent connection is not active', 'Alex''s login with Bea''s connection id is refused');
select throws_ok($$select public.agent_set_event_answer('age1', 'no')$$, '28000', null, 'even for a write');
select pg_temp.as_connector('a', 4);
select throws_ok($$select public.agent_list_prospects()$$, '28000', null, 'or with the leader''s');
select pg_temp.as_ordinary('a');
select throws_ok($$select public.agent_whoami()$$, '42501', 'agent functions can only be called through the connector',
  'no connection id at all is refused');
select pg_temp.as_ordinary('a');
select set_config('app.agent_connection_id', 'not-a-uuid', true);
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'a connection id that is not a uuid is refused');
select pg_temp.as_postgres();
select is((select pg_temp.q('select (revoked_at is not null)::text from public.agent_connections where id = ''' || pg_temp.conn(5) || '''')), 'true',
  'the revoked connection stays revoked');

-- Revoking cuts the agent off on its next call ----------------------------------------------------------------------------
select pg_temp.as_connector('a', 1);
select lives_ok($$select public.agent_whoami()$$, 'Alex''s connection works');
select pg_temp.as_ordinary('a');
select lives_ok($$select public.revoke_agent_connection(pg_temp.conn(1))$$, 'he revokes it in the app');
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '28000', null, 'the next call is refused');
select pg_temp.as_postgres();
update public.agent_connections set revoked_at = null where id = pg_temp.conn(1);

-- The team's switch, and the app admin's preview ------------------------------------------------------------------------------
update public.feature_switches set enabled = false where workspace_id = 'agw' and feature = 'agents';
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '42501', 'Agents are not switched on for this team', 'switching the team off cuts a live connection at once');
select throws_ok($$select public.agent_add_prospect('Off')$$, '42501', null, 'writes too');
select pg_temp.as_connector('l', 4);
select throws_ok($$select public.agent_list_prospects()$$, '42501', null, 'the leader''s as well');
select pg_temp.as_postgres();
insert into public.app_admins (user_id) values ('00000000-0000-4000-8000-0000000a9003');
select pg_temp.as_connector('b', 3);
select is((select public.agent_whoami() -> 'person' ->> 'name'), 'Bea Ibo', 'an app admin''s connection still works with the switch off (preview)');
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'while Alex''s stays cut off');
select pg_temp.as_postgres();
update public.feature_switches set enabled = true where workspace_id = 'agw' and feature = 'agents';
select pg_temp.as_connector('a', 1);
select lives_ok($$select public.agent_whoami()$$, 'switched back on, it works again');
select pg_temp.as_postgres();
delete from public.feature_switches where workspace_id = 'agw' and feature = 'agents';
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '42501', null, 'a team with no switch row is off');
select pg_temp.as_postgres();
insert into public.feature_switches (workspace_id, feature, enabled) values ('agw', 'agents', true);

-- The person changed under the connection --------------------------------------------------------------------------------------
update public.agent_connections set person_id = 'agb' where id = pg_temp.conn(2);
select pg_temp.as_connector('a', 2);
select throws_ok($$select public.agent_whoami()$$, '42501', 'agent connection no longer matches this login''s person',
  'a connection that no longer matches its login''s person is refused');
select pg_temp.as_postgres();
update public.agent_connections set person_id = 'aga' where id = pg_temp.conn(2);
update public.people set biz_class = 'prospect', pipeline_stage = 'prospect', business_start_date = null where id = 'aga';
select pg_temp.as_connector('a', 1);
select throws_ok($$select public.agent_whoami()$$, '42501', 'Only registered team members (apprentices and IBOs) and the team''s leader can use an agent',
  'a person who is no longer registered is refused');
select pg_temp.as_postgres();
update public.people set biz_class = 'apprentice', pipeline_stage = 'apprentice', business_start_date = current_date - 100 where id = 'aga';

-- Exactly one audit row per call ----------------------------------------------------------------------------------------------------
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access)
values (pg_temp.conn(6), '00000000-0000-4000-8000-0000000a9003', 'agb', 'agw', 'Bea second', pg_temp.hash('key-6'), 'write');
select is(pg_temp.audits(6), 0, 'a fresh connection has no audit rows');
select pg_temp.as_connector('b', 6);
select lives_ok($$select public.agent_whoami()$$, 'call 1: whoami');
select is((select pg_temp.audits(6)), 1, 'one row');
select lives_ok($$select public.agent_list_prospects()$$, 'call 2: list_prospects');
select lives_ok($$select public.agent_add_prospect('Audit Prospect')$$, 'call 3: add_prospect');
select lives_ok($$select public.agent_update_prospect('agp3', '{"phone": "555-0000"}'::jsonb)$$, 'call 4: update_prospect');
select lives_ok($$select public.agent_list_upcoming_events()$$, 'call 5: list_upcoming_events');
select lives_ok($$select public.agent_set_event_answer('age2', 'no')$$, 'call 6: set_event_answer');
select is(pg_temp.audits(6), 6, 'six calls wrote six audit rows');
select is((select pg_temp.q('select string_agg(tool, '','' order by id) from public.agent_audit where connection_id = ''' || pg_temp.conn(6) || '''')),
  'whoami,list_prospects,add_prospect,update_prospect,list_upcoming_events,set_event_answer', 'one per tool, in order');
select is((select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(6) || ''' and person_id = ''agb'' and workspace_id = ''agw''')),
  '6', 'all for Bea''s person and team');
select lives_ok($$select public.agent_update_prospect('agp1', '{"notes": "refused call"}'::jsonb)$$, 'a refused (not raising) call');
select is(pg_temp.audits(6), 7, 'also writes exactly one row');

-- Audit rows are private to the person -------------------------------------------------------------------------------------------------------
select pg_temp.as_ordinary('b');
select is((select count(*)::int from public.agent_audit where person_id = 'agb'), pg_temp.audits(3) + pg_temp.audits(6), 'Bea reads all her audit rows');
select is((select count(*)::int from public.agent_audit where person_id <> 'agb'), 0, 'and no one else''s');
select pg_temp.as_ordinary('l');
select is((select count(*)::int from public.agent_audit where person_id <> 'agl'), 0, 'the leader reads none of her team''s, though she sees their prospects');
select pg_temp.as_ordinary('a');
select is((select count(*)::int from public.agent_audit where tool = 'update_prospect' and new_values is not null), 4,
  'Alex reads his own with the values changed');

select pg_temp.as_postgres();
select * from finish();
rollback;
