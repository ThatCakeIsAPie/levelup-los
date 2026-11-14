-- Agent connector, part 3a: the people tools (migration 20261106000100_agent_people_tools): list_team,
-- list_prospects, list_customers, get_person and the new whoami fields. Run the way the Edge Function runs
-- them (the login's claims and the connection id in settings, `set local role authenticated`, then the tool).
-- Row-level security decides who sees whom; the tools add nothing and take nothing away.
-- (A pgTAP session is not opened by the connector role; see the note in 043 and pretend_connector_session().)
-- Self-contained (workspace agx), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(140);

-- The team: leader Lena (agxl). Under her: apprentices Alex (agxa1) and Ann (agxa2). Under Alex: IBO Bea
-- (agxb); under Bea: Abe (agxc, an apprentice whose first year is over, so effectively an IBO). So from Lena
-- Alex and Ann are level 1, Bea level 2, Abe level 3; from Alex Bea is level 1 and Abe level 2. Xavier (agxx)
-- leads a second line outside everyone else's downline, with Xia (agxm) under him. Prospects at several
-- levels, customers of Lena, Alex, Bea and Xavier. A person in another workspace (agyz) is in nobody's view.
-- Everyone with a number has an IBO and an LTD number: none may ever appear in a tool's answer.
-- Logins: 1 Lena, 2 Alex, 3 Ann, 4 Bea, 5 Xavier, 6 a login with no person.
-- Connections: 1 Lena write, 2 Alex write, 3 Alex read, 4 Bea write, 5 Xavier write, 6 Ann write,
-- 7 Alex write (revoked), 8 Lena read.

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000b100' || p_n)::uuid $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000d00' || p_n)::uuid $$;
create function pg_temp.hash(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'utf8')), 'hex') $$;
-- Act the way the Edge Function does: the login's claims, the connection id, `set local role authenticated`.
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
-- See the note in 043: the one question "was this session opened by the connector?" is answered yes.
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;
-- Every answer of every tool in this file lands here, so one assertion at the end can look for the numbers.
create temp table seen (tool text, doc jsonb);
grant insert on seen to public;
create function pg_temp.keep(p_tool text, p_doc jsonb) returns jsonb language plpgsql as $$
begin
  insert into pg_temp.seen values (p_tool, p_doc);
  return p_doc;
end $$;
-- The values of one field of a list, in the list's order: 'Alex,Ann,Bea'.
create function pg_temp.col(p_doc jsonb, p_key text, p_field text) returns text language sql as $$
  select string_agg(coalesce(x ->> p_field, '~'), ',' order by n)
    from jsonb_array_elements(p_doc -> p_key) with ordinality t (x, n) $$;
create function pg_temp.audits(p_conn int) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || '''')::int $$;
create function pg_temp.last_result(p_conn int) returns text language sql as $$
  select pg_temp.q('select result from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || ''' order by id desc limit 1') $$;

insert into public.workspaces (id, name) values ('agx', 'People Test Team'), ('agy', 'Other Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date, phone, email, location, notes, ibo_number, ltd_number) values
  ('agxl',  'agx', 'Lena Leader',     'ibo',        null,    null,   current_date - 900, '555-0001', 'lena@agent.test', 'Austin, TX', 'leader notes', 'IBO-SECRET-L', 'LTD-SECRET-L'),
  ('agxa1', 'agx', 'Alex Apprentice', 'apprentice', 'agxl',  null,   current_date - 100, '555-0002', 'alex@agent.test', 'Dallas, TX', 'alex notes', 'IBO-SECRET-A1', 'LTD-SECRET-A1'),
  ('agxa2', 'agx', 'Ann Apprentice',  'apprentice', 'agxl',  null,   current_date - 50,  null,       null,              null,         null, 'IBO-SECRET-A2', null),
  ('agxb',  'agx', 'Bea Ibo',         'ibo',        'agxa1', null,   current_date - 700, '555-0004', 'bea@agent.test',  'Plano, TX',  'bea notes', 'IBO-SECRET-B', 'LTD-SECRET-B'),
  ('agxc',  'agx', 'Abe Veteran',      'apprentice', 'agxb',  null,   current_date - 400, '555-0005', null,              null,         null, null, null),
  ('agxx',  'agx', 'Xavier Outsider', 'ibo',        null,    null,   current_date - 800, '555-0006', 'x@agent.test',    'Reno, NV',   'x notes', 'IBO-SECRET-X', 'LTD-SECRET-X'),
  ('agxm',  'agx', 'Xia Xmember',     'apprentice', 'agxx',  null,   current_date - 60,  '555-0007', null,              null,         null, 'IBO-SECRET-XM', null),
  ('agyz',  'agy', 'Zed Elsewhere',   'ibo',        null,    null,   current_date - 500, '555-0099', null,              null,         null, 'IBO-SECRET-Z', null),
  ('agxp1', 'agx', 'Pat Prospect One',   'prospect', 'agxl',  null, null, '555-0101', 'pat@agent.test', 'Waco, TX', 'first note', null, null),
  ('agxp2', 'agx', 'Pia Prospect Two',   'prospect', 'agxa1', null, null, null, null, null, null, null, null),
  ('agxp3', 'agx', 'Pat 100%_off Deal',  'prospect', 'agxa1', null, null, null, null, null, null, null, null),
  ('agxp4', 'agx', 'Paul Prospect Four', 'prospect', 'agxb',  null, null, '555-0104', null, null, 'private to Bea', null, null),
  ('agxp5', 'agx', 'Quinn Outside',      'prospect', 'agxx',  null, null, '555-0105', null, null, null, null, null),
  ('agxc1', 'agx', 'Cora Customer',  'customer', null, 'agxl',  null, '555-0201', 'cora@agent.test', 'Tyler, TX', 'cora notes', null, null),
  ('agxc2', 'agx', 'Carl Customer',  'customer', null, 'agxa1', null, '555-0202', null, null, null, null, null),
  ('agxc3', 'agx', 'Cleo Customer',  'customer', null, 'agxb',  null, null, null, null, null, null, null),
  ('agxc4', 'agx', 'Chad Customer',  'customer', null, 'agxx',  null, '555-0204', null, null, null, null, null);
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'agent-people-' || n || '@agent.test'
  from generate_series(1, 6) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('agx', 'agxl',  pg_temp.login(1), 'leader'),
  ('agx', 'agxa1', pg_temp.login(2), 'member'),
  ('agx', 'agxa2', pg_temp.login(3), 'member'),
  ('agx', 'agxb',  pg_temp.login(4), 'member'),
  ('agx', 'agxx',  pg_temp.login(5), 'member');
insert into public.feature_switches (workspace_id, feature, enabled) values ('agx', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(1), pg_temp.login(1), 'agxl',  'agx', 'Lena write',  pg_temp.hash('k1'), 'write', null),
  (pg_temp.conn(2), pg_temp.login(2), 'agxa1', 'agx', 'Alex write',  pg_temp.hash('k2'), 'write', null),
  (pg_temp.conn(3), pg_temp.login(2), 'agxa1', 'agx', 'Alex read',   pg_temp.hash('k3'), 'read', null),
  (pg_temp.conn(4), pg_temp.login(4), 'agxb',  'agx', 'Bea write',   pg_temp.hash('k4'), 'write', null),
  (pg_temp.conn(5), pg_temp.login(5), 'agxx',  'agx', 'Xavier write', pg_temp.hash('k5'), 'write', null),
  (pg_temp.conn(6), pg_temp.login(3), 'agxa2', 'agx', 'Ann write',   pg_temp.hash('k6'), 'write', null),
  (pg_temp.conn(7), pg_temp.login(2), 'agxa1', 'agx', 'Alex old',    pg_temp.hash('k7'), 'write', now() - interval '1 day'),
  (pg_temp.conn(8), pg_temp.login(1), 'agxl',  'agx', 'Lena read',   pg_temp.hash('k8'), 'read', null);

select pg_temp.pretend_connector_session();

-- list_team: the downline, with levels and sponsors ----------------------------------------------------
select pg_temp.as_connector(1, 1);
select is(pg_temp.col(pg_temp.keep('list_team', public.agent_list_team()), 'team', 'full_name'),
  'Alex Apprentice,Ann Apprentice,Bea Ibo,Abe Veteran', 'Lena''s team: her whole registered downline, ordered by level then name, not herself');
select is(pg_temp.col(public.agent_list_team(), 'team', 'level'), '1,1,2,3', 'with levels 1, 1, 2 and 3');
select is(pg_temp.col(public.agent_list_team(), 'team', 'sponsor_name'),
  'Lena Leader,Lena Leader,Alex Apprentice,Bea Ibo', 'and each one''s sponsor''s name');
select is(pg_temp.col(public.agent_list_team(), 'team', 'sponsor_id'), 'agxl,agxl,agxa1,agxb', 'and sponsor id');
select is(pg_temp.col(public.agent_list_team(), 'team', 'stage'), 'apprentice,apprentice,ibo,ibo',
  'stage is the effective one: Abe, an apprentice for over a year, is an IBO');
select is((public.agent_list_team() ->> 'total')::int, 4, 'total is 4');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_list_team() -> 'team' -> 0) k),
  array['business_start_date', 'email', 'full_name', 'id', 'level', 'location', 'phone', 'sponsor_id', 'sponsor_name', 'stage'],
  'each person has exactly id, full_name, stage, sponsor_id, sponsor_name, level, phone, email, location and business_start_date');
select is((public.agent_list_team() -> 'team' -> 0) ->> 'phone', '555-0002', 'Alex''s phone');
select is((public.agent_list_team() -> 'team' -> 0) ->> 'email', 'alex@agent.test', 'e-mail');
select is((public.agent_list_team() -> 'team' -> 0) ->> 'location', 'Dallas, TX', 'location');
select is((public.agent_list_team() -> 'team' -> 0) ->> 'business_start_date', (current_date - 100)::text, 'and business start date');
select is(public.agent_list_team() ? 'note', false, 'a list with rows has no note');
select is(pg_temp.col(public.agent_list_team(), 'team', 'id') like '%agxx%' or pg_temp.col(public.agent_list_team(), 'team', 'id') like '%agxm%'
          or pg_temp.col(public.agent_list_team(), 'team', 'id') like '%agyz%', false,
  'nobody outside her downline (Xavier''s line, another workspace) is in it');

select pg_temp.as_connector(2, 2);
select is(pg_temp.col(pg_temp.keep('list_team', public.agent_list_team()), 'team', 'full_name'), 'Bea Ibo,Abe Veteran', 'Alex''s team: Bea and Abe');
select is(pg_temp.col(public.agent_list_team(), 'team', 'level'), '1,2', 'levels count from the caller: Bea 1, Abe 2');
select is(pg_temp.col(public.agent_list_team(), 'team', 'sponsor_name'), 'Alex Apprentice,Bea Ibo', 'sponsor names');
select pg_temp.as_connector(4, 4);
select is(pg_temp.col(pg_temp.keep('list_team', public.agent_list_team()), 'team', 'full_name'), 'Abe Veteran', 'Bea''s team: Abe');
select pg_temp.as_connector(5, 5);
select is(pg_temp.col(pg_temp.keep('list_team', public.agent_list_team()), 'team', 'full_name'), 'Xia Xmember', 'Xavier''s team: only Xia, none of Lena''s');
select pg_temp.as_connector(3, 6);
select is(pg_temp.keep('list_team', public.agent_list_team()) -> 'team', '[]'::jsonb, 'Ann has nobody under her: an empty list');
select is(public.agent_list_team() ->> 'note', 'You have no registered team members under you yet.', 'and says so plainly in a note');
select is((public.agent_list_team() ->> 'total')::int, 0, 'with total 0');

-- search, limit, offset, total
select pg_temp.as_connector(1, 1);
select is(pg_temp.col(public.agent_list_team('APPRENTICE'), 'team', 'full_name'), 'Alex Apprentice,Ann Apprentice', 'search matches the name, case-insensitive');
select is((public.agent_list_team('APPRENTICE') ->> 'total')::int, 2, 'total counts the matches');
select is(pg_temp.col(public.agent_list_team('  bea '), 'team', 'full_name'), 'Bea Ibo', 'a search is trimmed');
select is(pg_temp.col(public.agent_list_team('lena'), 'team', 'full_name'), null::text, 'the caller is never in her own team, whatever the search');
select is(public.agent_list_team('zzz') ->> 'note', 'No team member matches that search.', 'no match: its own note, not the "no team" one');
select is(pg_temp.col(public.agent_list_team(null, 2, 1), 'team', 'full_name'), 'Ann Apprentice,Bea Ibo', 'limit 2 offset 1 pages through the order');
select is((public.agent_list_team(null, 2, 1) ->> 'total')::int, 4, 'total ignores the page');
select is(public.agent_list_team(null, 2, 1) ->> 'limit', '2', 'the result carries the limit');
select is(public.agent_list_team(null, 2, 1) ->> 'offset', '1', 'and the offset');
select is(public.agent_list_team(null, 2, 10) -> 'team', '[]'::jsonb, 'an offset past the end: no rows');
select is(public.agent_list_team(null, 2, 10) ->> 'note', 'offset is past the last team member (total 4).', 'with a note that is not the "no team" one');
select is((public.agent_list_team(null, 0, -5) ->> 'limit')::int, 1, 'limit is held to 1 at the least');
select is((public.agent_list_team(null, 5000, 0) ->> 'limit')::int, 200, 'and to 200 at most');
select is(public.agent_list_team(null, null, null) ->> 'offset', '0', 'null limit and offset are the defaults');
select is((public.agent_list_team(null, null, null) ->> 'limit')::int, 50, 'default limit 50');
select is(public.agent_list_team(repeat('x', 101)) ->> 'error', 'search must be at most 100 characters.', 'a search over 100 characters is refused');

-- list_prospects: same field names, sponsors, search, note --------------------------------------------------
select is(pg_temp.col(pg_temp.keep('list_prospects', public.agent_list_prospects()), 'prospects', 'full_name'),
  'Pat 100%_off Deal,Pat Prospect One,Paul Prospect Four,Pia Prospect Two', 'Lena sees the prospects of her whole team, ordered by name');
select is(pg_temp.col(public.agent_list_prospects(), 'prospects', 'sponsor_name'),
  'Alex Apprentice,Lena Leader,Bea Ibo,Alex Apprentice', 'each with the name of the member whose prospect it is');
select is(pg_temp.col(public.agent_list_prospects(), 'prospects', 'sponsor_id'), 'agxa1,agxl,agxb,agxa1', 'and their id');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_list_prospects() -> 'prospects' -> 0) k),
  array['email', 'full_name', 'id', 'location', 'notes', 'phone', 'sponsor_id', 'sponsor_name'],
  'each prospect has full_name, phone, email, location, notes, sponsor_id, sponsor_name and id');
select is((public.agent_list_prospects() ->> 'total')::int, 4, 'total 4 (not Xavier''s prospect)');
select is(pg_temp.col(public.agent_list_prospects(1, null, 2), 'prospects', 'full_name'), 'Paul Prospect Four', 'limit 1 offset 2');
select is((public.agent_list_prospects(1, null, 2) ->> 'total')::int, 4, 'total ignores the page');
select is(pg_temp.col(public.agent_list_prospects(50, 'PAT'), 'prospects', 'full_name'), 'Pat 100%_off Deal,Pat Prospect One', 'search is case-insensitive');
select is(pg_temp.col(public.agent_list_prospects(50, '%'), 'prospects', 'full_name'), 'Pat 100%_off Deal', 'a % in the search is plain text, not a wildcard');
select is(pg_temp.col(public.agent_list_prospects(50, '_'), 'prospects', 'full_name'), 'Pat 100%_off Deal', 'so is an underscore');
select is((public.agent_list_prospects(5) ->> 'total')::int, 4, 'the old one-argument call still works');
select is(public.agent_list_prospects() ? 'note', false, 'no note when there are rows');
select is(public.agent_list_prospects(50, 'nobody') ->> 'note', 'No prospect matches that search.', 'no match: a search note');
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(pg_temp.keep('list_prospects', public.agent_list_prospects()), 'prospects', 'full_name'),
  'Pat 100%_off Deal,Paul Prospect Four,Pia Prospect Two', 'Alex sees his, and his downline''s (Bea''s), not Lena''s');
select pg_temp.as_connector(4, 4);
select is(pg_temp.col(pg_temp.keep('list_prospects', public.agent_list_prospects()), 'prospects', 'full_name'), 'Paul Prospect Four', 'Bea sees only hers');
select pg_temp.as_connector(5, 5);
select is(pg_temp.col(pg_temp.keep('list_prospects', public.agent_list_prospects()), 'prospects', 'full_name'), 'Quinn Outside', 'Xavier sees only his own line''s');
select pg_temp.as_connector(3, 6);
select is(pg_temp.keep('list_prospects', public.agent_list_prospects()) -> 'prospects', '[]'::jsonb, 'Ann has none');
select is(public.agent_list_prospects() ->> 'note', 'No prospects yet. Use add_prospect to add one; registered team members are in list_team.', 'and the note says what to do');

-- list_customers: private to the owner -------------------------------------------------------------------------
select pg_temp.as_connector(1, 1);
select is(pg_temp.col(pg_temp.keep('list_customers', public.agent_list_customers()), 'customers', 'full_name'), 'Cora Customer', 'Lena sees her own customer, not her team''s');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_list_customers() -> 'customers' -> 0) k),
  array['email', 'full_name', 'id', 'location', 'owner_id', 'owner_name', 'phone'], 'each with id, full_name, phone, email, location, owner_id, owner_name');
select is((public.agent_list_customers() -> 'customers' -> 0) ->> 'owner_name', 'Lena Leader', 'owner name');
select is((public.agent_list_customers() -> 'customers' -> 0) ->> 'owner_id', 'agxl', 'owner id');
select is(pg_temp.col(public.agent_list_customers(false), 'customers', 'full_name'), 'Cora Customer',
  'mine_only = false shows the same: row-level security shows nobody else''s customers, a leader''s included');
select is((public.agent_list_customers() ->> 'total')::int, 1, 'total');
select is(public.agent_list_customers() ->> 'limit', '50', 'default limit');
select is(public.agent_list_customers(true, 'zzz') ->> 'note', 'No customer matches that search.', 'a search with no match has its note');
select is(pg_temp.col(public.agent_list_customers(true, 'CORA'), 'customers', 'full_name'), 'Cora Customer', 'search is case-insensitive');
select is(public.agent_list_customers(true, null, 5, 3) ->> 'note', 'offset is past the last customer (total 1).', 'an offset past the end has its note');
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(pg_temp.keep('list_customers', public.agent_list_customers()), 'customers', 'full_name'), 'Carl Customer', 'Alex sees his, not Bea''s');
select pg_temp.as_connector(3, 6);
select is(pg_temp.keep('list_customers', public.agent_list_customers()) -> 'customers', '[]'::jsonb, 'Ann has none');
select is(public.agent_list_customers() ->> 'note', 'No customers yet.', 'and is told so');
select pg_temp.as_connector(5, 5);
select is(pg_temp.col(pg_temp.keep('list_customers', public.agent_list_customers()), 'customers', 'full_name'), 'Chad Customer', 'Xavier sees only his own');

-- get_person --------------------------------------------------------------------------------------------------
select pg_temp.as_connector(1, 1);
select is(pg_temp.keep('get_person', public.agent_get_person('agxl')) ->> 'kind', 'self', 'Lena looks up herself: kind self');
select is(public.agent_get_person('agxl') ->> 'full_name', 'Lena Leader', 'with her name');
select is(public.agent_get_person('agxl') ->> 'notes', 'leader notes', 'and notes');
select is(public.agent_get_person('agxl') -> 'sponsor', 'null'::jsonb, 'no sponsor');
select is(public.agent_get_person('agxl') ->> 'stage', 'ibo', 'stage');
select is(public.agent_get_person('agxl') ? 'level', false, 'no level for herself');
select is(pg_temp.keep('get_person', public.agent_get_person('agxb')) ->> 'kind', 'team', 'Bea: kind team');
select is(public.agent_get_person('agxb') ->> 'level', '2', 'level 2');
select is(public.agent_get_person('agxb') -> 'sponsor', '{"id": "agxa1", "name": "Alex Apprentice"}'::jsonb, 'sponsor id and name');
select is(public.agent_get_person('agxb') ->> 'location', 'Plano, TX', 'location');
select is(public.agent_get_person('agxb') ->> 'notes', 'bea notes', 'notes');
select is(public.agent_get_person('agxb') ->> 'business_start_date', (current_date - 700)::text, 'business start date');
select is(public.agent_get_person('agxc') ->> 'stage', 'ibo', 'Abe: effective stage ibo');
select is(public.agent_get_person('agxc') ->> 'level', '3', 'level 3');
select is(pg_temp.keep('get_person', public.agent_get_person('agxp1')) ->> 'kind', 'prospect', 'a prospect: kind prospect');
select is(public.agent_get_person('agxp1') -> 'sponsor', '{"id": "agxl", "name": "Lena Leader"}'::jsonb, 'with its sponsor');
select is(public.agent_get_person('agxp1') ? 'stage', false, 'no stage or level for a prospect');
select is(public.agent_get_person('agxp1') ->> 'notes', 'first note', 'notes');
select is(pg_temp.keep('get_person', public.agent_get_person('agxc1')) ->> 'kind', 'customer', 'a customer: kind customer');
select is(public.agent_get_person('agxc1') -> 'owner', '{"id": "agxl", "name": "Lena Leader"}'::jsonb, 'with its owner');
select is(public.agent_get_person('agxc1') ? 'sponsor', false, 'and no sponsor');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_get_person('agxa1')) k),
  array['business_start_date', 'email', 'full_name', 'id', 'kind', 'level', 'location', 'notes', 'phone', 'sponsor', 'stage'],
  'a team member''s fields');
-- who cannot be fetched: the same refusal, whatever the reason
select is(public.agent_get_person('agxx') ->> 'error', 'No such person among the people you can see.', 'Xavier, outside her downline: refused');
select is(public.agent_get_person('agxm') ->> 'error', 'No such person among the people you can see.', 'and his member');
select is(public.agent_get_person('agxp5') ->> 'error', 'No such person among the people you can see.', 'and his prospect');
select is(public.agent_get_person('agxc2') ->> 'error', 'No such person among the people you can see.', 'Alex''s customer: private to Alex, Lena''s agent cannot fetch it');
select is(public.agent_get_person('agyz') ->> 'error', 'No such person among the people you can see.', 'another workspace''s person');
select is(public.agent_get_person('no-such-id') ->> 'error', 'No such person among the people you can see.', 'an id that does not exist: the very same message');
select is(pg_temp.last_result(1), 'refused: no such person among the visible ones', 'audited as a refusal');
select pg_temp.as_connector(2, 2);
select is(public.agent_get_person('agxl') ->> 'error', 'No such person among the people you can see.', 'Alex cannot fetch his sponsor, whom he cannot see');
select is(public.agent_get_person('agxa1') -> 'sponsor', 'null'::jsonb, 'and his own sponsor is null, id and all');
select is(public.agent_get_person('agxa1') ->> 'kind', 'self', 'he is self');
select is(public.agent_get_person('agxb') ->> 'level', '1', 'Bea is level 1 for Alex');
select is(public.agent_get_person('agxc1') ->> 'error', 'No such person among the people you can see.', 'Lena''s customer: not his');
select is(public.agent_get_person('agxp1') ->> 'error', 'No such person among the people you can see.', 'Lena''s prospect: not his');

-- whoami: can and team_size ---------------------------------------------------------------------------------------
select pg_temp.as_connector(1, 1);
select is(public.agent_whoami() ->> 'team_size', '4', 'Lena''s team_size is 4');
select is(jsonb_array_length(public.agent_list_team() -> 'team'), 4, 'the same as the length of list_team');
select pg_temp.as_connector(2, 2);
select is(public.agent_whoami() ->> 'team_size', '2', 'Alex''s is 2');
select pg_temp.as_connector(5, 5);
select is(public.agent_whoami() ->> 'team_size', '1', 'Xavier''s is 1');
select pg_temp.as_connector(3, 6);
select is(public.agent_whoami() ->> 'team_size', '0', 'Ann''s is 0');
select pg_temp.as_connector(1, 1);
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.agent_whoami() -> 'can') x),
  (select array_agg(substr(p.proname::text, 7) order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'agent\_%'),
  'a write connection can call every agent_ tool in the database');
select pg_temp.as_connector(1, 8);
select is((select array_agg(x order by x) from jsonb_array_elements_text(public.agent_whoami() -> 'can') x),
  (select array_agg(substr(p.proname::text, 7) order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'agent\_%' and p.prosrc like '%agent_private.ctx(false)%'),
  'a read connection can call exactly the tools that ask for read access');
select is(jsonb_array_length(public.agent_whoami() -> 'can'), 8, 'eight of them');
select is(public.agent_whoami() -> 'can' ? 'log_learning', false, 'and not log_learning');
select is(public.agent_whoami() ->> 'access', 'read', 'access is still shown');

-- Read connections read; the others are refused --------------------------------------------------------------------
select pg_temp.as_connector(2, 3);
select is(pg_temp.col(public.agent_list_team(), 'team', 'full_name'), 'Bea Ibo,Abe Veteran', 'a read connection lists the team');
select is((public.agent_get_person('agxb') ->> 'level'), '1', 'and a person');
select is(jsonb_array_length(public.agent_list_prospects() -> 'prospects'), 3, 'and prospects');
select is(jsonb_array_length(public.agent_list_customers() -> 'customers'), 1, 'and customers');
-- revoked, foreign, no person
select pg_temp.as_connector(2, 7);
select throws_ok($$select public.agent_list_team()$$, '28000', 'agent connection is not active', 'a revoked connection: list_team');
select throws_ok($$select public.agent_list_prospects()$$, '28000', null, 'list_prospects');
select throws_ok($$select public.agent_list_customers()$$, '28000', null, 'list_customers');
select throws_ok($$select public.agent_get_person('agxa1')$$, '28000', null, 'get_person');
select throws_ok($$select public.agent_whoami()$$, '28000', null, 'whoami');
select pg_temp.as_connector(4, 2);
select throws_ok($$select public.agent_list_team()$$, '28000', 'agent connection is not active', 'Alex''s connection used by Bea''s login: list_team');
select throws_ok($$select public.agent_list_prospects()$$, '28000', null, 'list_prospects');
select throws_ok($$select public.agent_list_customers()$$, '28000', null, 'list_customers');
select throws_ok($$select public.agent_get_person('agxa1')$$, '28000', null, 'get_person');
select throws_ok($$select public.agent_whoami()$$, '28000', null, 'whoami');
select pg_temp.as_connector(6, 2);
select throws_ok($$select public.agent_list_team()$$, '28000', null, 'a login with no person using someone''s connection');

-- One audit row per call; the person is recorded where the app reads it ----------------------------------------------
select pg_temp.as_connector(5, 5);
select is(pg_temp.audits(5), 4, 'Xavier made four calls (team, prospects, customers, whoami): four rows');
select is(pg_temp.q('select string_agg(tool, '','' order by id) from public.agent_audit where connection_id = ''' || pg_temp.conn(5) || ''''),
  'list_team,list_prospects,list_customers,whoami', 'one per call, in order, with the tool''s name');
select pg_temp.as_postgres();
select is((select min(new_values ->> 'name') from public.agent_audit where tool = 'get_person' and connection_id = pg_temp.conn(1) and result = 'viewed self'),
  'Lena Leader', 'get_person writes the person''s name to new_values, where add_prospect writes it');
select is((select new_values ->> 'id' from public.agent_audit where tool = 'get_person' and connection_id = pg_temp.conn(1) and result = 'viewed team' limit 1),
  'agxb', 'and the id');
select is((select count(*)::int from public.agent_audit where tool = 'get_person' and connection_id = pg_temp.conn(1)), 28,
  'Lena''s 28 get_person calls left one row each');
select is((select count(*)::int from public.agent_audit where tool = 'get_person' and connection_id = pg_temp.conn(1) and result like 'refused%'), 6,
  'six of them refusals, audited as such');
select is((select result from public.agent_audit where tool = 'list_team' and connection_id = pg_temp.conn(5)), '1 of 1 rows', 'a list''s audit row says how many of how many');

-- The numbers never leave --------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_temp.seen), 18, 'every answer above was kept to look at (18 of them)');
select is((select count(*)::int from pg_temp.seen where doc::text like '%SECRET%'), 0, 'no IBO or LTD number (nor the word) is in any answer');
select is((select count(*)::int from pg_temp.seen where doc::text ~* 'ibo_number|ltd_number'), 0, 'nor a field named for them');
select is((select count(*)::int from public.agent_audit a where a.arguments::text like '%SECRET%' or a.old_values::text like '%SECRET%'
             or a.new_values::text like '%SECRET%' or a.result like '%SECRET%'), 0, 'nor in the audit rows');

select * from finish();
rollback;
