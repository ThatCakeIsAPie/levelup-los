-- Agent connector, part 3a: the personal tools (migration 20261106000100_agent_people_tools): update_my_profile,
-- log_learning and list_learning, run the way the Edge Function runs them. Row-level security would let a
-- person change and log for their downline; these tools touch the caller's own record and entries only, and
-- the whitelist is enforced here again, by name, whatever the Edge Function checked first.
-- (A pgTAP session is not opened by the connector role; see the note in 043 and pretend_connector_session().)
-- Self-contained (workspace agp), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(145);

-- The team: leader Lena (agpl), apprentice Alex (agpa), under him IBO Bea (agpb). Logins 1 Lena, 2 Alex, 3 Bea.
-- Connections: 1 Lena write, 2 Alex write, 3 Alex read, 4 Bea write, 5 Alex write (revoked), 6 Bea read.

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000b200' || p_n)::uuid $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000e00' || p_n)::uuid $$;
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
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;
create function pg_temp.audits(p_conn int) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || '''')::int $$;
create function pg_temp.last_result(p_conn int) returns text language sql as $$
  select pg_temp.q('select result from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || ''' order by id desc limit 1') $$;
-- A person's whole row, as text, read as the owner: to show that a call changed nothing, or only what it should.
create function pg_temp.person_row(p_id text) returns text language sql as $$
  select pg_temp.q('select concat_ws(''|'', name, coalesce(phone, ''~''), coalesce(email, ''~''), coalesce(location, ''~''), coalesce(notes, ''~''),
                          biz_class, coalesce(sponsor_id, ''~''), coalesce(owner_id, ''~''), coalesce(business_start_date::text, ''~''),
                          coalesce(pipeline_stage, ''~''), coalesce(ibo_number, ''~''), coalesce(ltd_number, ''~''),
                          stage_history::text, tags::text, coalesce(monthly_volume::text, ''~''), workspace_id)
                     from public.people where id = ''' || p_id || '''') $$;
create function pg_temp.learning_rows(p_person text) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.learning where person_id = ''' || p_person || '''')::int $$;
-- What the tool answers to a patch, as the first word of the error, or 'ok'.
create function pg_temp.try_patch(p_patch jsonb) returns text language sql as $$
  select coalesce(public.agent_update_my_profile(p_patch) ->> 'error', 'ok') $$;

insert into public.workspaces (id, name) values ('agp', 'Profile Test Team');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date, phone, email, location, notes, ibo_number, ltd_number, pipeline_stage) values
  ('agpl', 'agp', 'Lena Leader',     'ibo',        null,    current_date - 900, '555-0001', 'lena@agent.test', 'Austin, TX', 'lena notes', 'IBO-SECRET-L', 'LTD-SECRET-L', 'ibo'),
  ('agpa', 'agp', 'Alex Apprentice', 'apprentice', 'agpl',  current_date - 100, '555-0002', 'alex@agent.test', 'Dallas, TX', 'alex notes', 'IBO-SECRET-A', 'LTD-SECRET-A', 'apprentice'),
  ('agpb', 'agp', 'Bea Ibo',         'ibo',        'agpa',  current_date - 700, '555-0004', 'bea@agent.test',  'Plano, TX',  'bea notes',  'IBO-SECRET-B', 'LTD-SECRET-B', 'ibo');
update public.people set tags = array['hot'], monthly_volume = 150.50 where id = 'agpa';
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'agent-profile-' || n || '@agent.test'
  from generate_series(1, 3) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('agp', 'agpl', pg_temp.login(1), 'leader'),
  ('agp', 'agpa', pg_temp.login(2), 'member'),
  ('agp', 'agpb', pg_temp.login(3), 'member');
insert into public.feature_switches (workspace_id, feature, enabled) values ('agp', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(1), pg_temp.login(1), 'agpl', 'agp', 'Lena write', pg_temp.hash('k1'), 'write', null),
  (pg_temp.conn(2), pg_temp.login(2), 'agpa', 'agp', 'Alex write', pg_temp.hash('k2'), 'write', null),
  (pg_temp.conn(3), pg_temp.login(2), 'agpa', 'agp', 'Alex read',  pg_temp.hash('k3'), 'read', null),
  (pg_temp.conn(4), pg_temp.login(3), 'agpb', 'agp', 'Bea write',  pg_temp.hash('k4'), 'write', null),
  (pg_temp.conn(5), pg_temp.login(2), 'agpa', 'agp', 'Alex old',   pg_temp.hash('k5'), 'write', now() - interval '1 day'),
  (pg_temp.conn(6), pg_temp.login(3), 'agpb', 'agp', 'Bea read',   pg_temp.hash('k6'), 'read', null);
select pg_temp.pretend_connector_session();
create temp table rows_before as select pg_temp.person_row('agpl') as l, pg_temp.person_row('agpb') as b;
grant select on rows_before to public;

-- update_my_profile: the whitelist ------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is(public.agent_update_my_profile('{"full_name": "  Alexander Apprentice ", "phone": "555-0222"}'::jsonb),
  '{"id": "agpa", "full_name": "Alexander Apprentice", "phone": "555-0222", "email": "alex@agent.test", "location": "Dallas, TX"}'::jsonb,
  'Alex changes his name (trimmed) and phone and gets his profile back');
select is(pg_temp.person_row('agpa'),
  'Alexander Apprentice|555-0222|alex@agent.test|Dallas, TX|alex notes|apprentice|agpl|~|' || (current_date - 100) || '|apprentice|IBO-SECRET-A|LTD-SECRET-A|[]|{hot}|150.50|agp',
  'in his row, only those two fields changed (stage, sponsor, dates, numbers, tags, volume, notes all as they were)');
select is(public.agent_update_my_profile('{"email": "alexander@agent.test", "location": "Fort Worth, TX"}'::jsonb) ->> 'email', 'alexander@agent.test', 'e-mail');
select is((select location from public.people where id = 'agpa'), 'Fort Worth, TX', 'and location change');
select is(public.agent_update_my_profile('{"phone": null, "email": null, "location": "   "}'::jsonb),
  '{"id": "agpa", "full_name": "Alexander Apprentice", "phone": null, "email": null, "location": null}'::jsonb,
  'null clears phone and e-mail, and so does blank text for location');
select is(pg_temp.q('select email from auth.users where id = ''' || pg_temp.login(2) || ''''),
  'agent-profile-2@agent.test', 'the sign-in address is untouched: the e-mail here is contact information');
select is(pg_temp.person_row('agpl') || '#' || pg_temp.person_row('agpb'), (select l || '#' || b from rows_before),
  'nobody else''s record changed, though row-level security lets Alex edit his downline''s');
select pg_temp.as_connector(2, 2);
select is(pg_temp.try_patch('{"full_name": ""}'::jsonb), '"full_name" must be text of at most 120 characters or null (full_name cannot be empty or null). Nothing was changed.', 'an empty full_name is refused');
select is(pg_temp.try_patch('{"full_name": null}'::jsonb) like '"full_name" must be text%', true, 'a null full_name is refused');
select is(pg_temp.try_patch('{"full_name": 5}'::jsonb) like '"full_name" must be text%', true, 'a number is refused');
select is(pg_temp.try_patch(jsonb_build_object('full_name', repeat('x', 121))) like '"full_name" must be text%', true, 'a name of 121 characters is refused');
select is(pg_temp.try_patch(jsonb_build_object('phone', repeat('1', 41))) like '"phone" must be text of at most 40%', true, 'a phone of 41 characters is refused');
select is(pg_temp.try_patch(jsonb_build_object('email', repeat('e', 201))) like '"email" must be text of at most 200%', true, 'an e-mail of 201 is refused');
select is(pg_temp.try_patch(jsonb_build_object('location', repeat('l', 201))) like '"location" must be text of at most 200%', true, 'a location of 201 is refused');
select is(pg_temp.try_patch('{}'::jsonb), 'Nothing to change: give at least one of full_name, phone, email, location.', 'an empty patch');
select is(pg_temp.try_patch('[]'::jsonb), 'Nothing to change: give at least one of full_name, phone, email, location.', 'a patch that is not an object');
select is(pg_temp.try_patch(null), 'Nothing to change: give at least one of full_name, phone, email, location.', 'a null patch');
select is(pg_temp.try_patch('{"phone": "555", "full_name": 5}'::jsonb) like '"full_name" must be%', true, 'one bad value refuses the whole patch');
select is((select phone from public.people where id = 'agpa') is null, true, 'and the good one did not apply (his phone is still cleared)');

-- every forbidden field, by name, nothing changes
select pg_temp.as_postgres();
create temp table forbidden (field text);
insert into forbidden values ('stage'), ('biz_class'), ('sponsor_id'), ('sponsor'), ('owner_id'), ('owner'), ('ibo_number'), ('ltd_number'),
  ('business_start_date'), ('pipeline_stage'), ('stage_history'), ('tags'), ('monthly_volume'), ('notes'), ('id'), ('workspace_id'),
  ('name'), ('rating'), ('last_updated_at');
grant select on forbidden to public;
create temp table row_before as select pg_temp.person_row('agpa') as r;
grant select on row_before to public;
select pg_temp.as_connector(2, 2);
select is(public.agent_update_my_profile(jsonb_build_object(f.field, 'x')) ->> 'error',
          'Only full_name, phone, email and location can be changed here; "' || f.field || '" cannot. Nothing was changed.',
          'refused by name: ' || f.field)
  from forbidden f order by f.field;
select is(pg_temp.person_row('agpa'), (select r from row_before), 'after all of those, the row is exactly as it was');
select is(public.agent_update_my_profile('{"phone": "555-9", "stage": "ibo", "ibo_number": "1"}'::jsonb) ->> 'error',
  'Only full_name, phone, email and location can be changed here; "ibo_number", "stage" cannot. Nothing was changed.',
  'a mixed patch names every forbidden field and applies nothing');
select is((select phone from public.people where id = 'agpa') is null, true, 'including the allowed one');
select is(pg_temp.last_result(2), 'refused: field "ibo_number", "stage" is not allowed', 'the refusal is audited with the fields named');
select is(pg_temp.q('select count(*) from public.agent_audit where connection_id = ''' || pg_temp.conn(2) || ''' and tool = ''update_my_profile'' and result like ''refused%'''), '31',
  'every refusal left one audit row: 11 bad values or empty patches, 19 single forbidden fields and the mixed patch');
select is((select count(*)::int from public.agent_audit where tool = 'update_my_profile' and result = 'updated own profile'), 3, 'and each change one row');
select is((select (old_values ->> 'name') || ' -> ' || (new_values ->> 'name') from public.agent_audit
            where tool = 'update_my_profile' and result = 'updated own profile' order by id limit 1),
  'Alex Apprentice -> Alexander Apprentice', 'old and new values are kept, the name where the app reads it');

-- the other tools and connections
select pg_temp.as_connector(2, 3);
select throws_ok($$select public.agent_update_my_profile('{"phone": "1"}'::jsonb)$$, '42501', 'this connection is read-only', 'a read connection cannot change the profile');
select pg_temp.as_connector(2, 5);
select throws_ok($$select public.agent_update_my_profile('{"phone": "1"}'::jsonb)$$, '28000', 'agent connection is not active', 'a revoked one cannot');
select pg_temp.as_connector(3, 2);
select throws_ok($$select public.agent_update_my_profile('{"phone": "1"}'::jsonb)$$, '28000', null, 'nor a connection used by someone else''s login');
select is((select phone from public.people where id = 'agpb'), '555-0004', 'and Bea''s phone is as it was');
select pg_temp.as_connector(3, 4);
select is(public.agent_update_my_profile('{"phone": "555-0444"}'::jsonb) ->> 'id', 'agpb', 'Bea changes her own record: the id is hers, not her sponsor''s');
select is((select phone from public.people where id = 'agpa') is null, true, 'and Alex''s is untouched');

-- log_learning ----------------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is(pg_temp.learning_rows('agpa'), 0, 'Alex has no learning entries to begin with');
select is(public.agent_log_learning('pages', 'Go-Givers Sell More', 30, 'minutes', current_date - 2) - 'id' - 'created_at',
  jsonb_build_object('kind', 'pages', 'title', 'Go-Givers Sell More', 'amount', 30, 'unit', 'minutes', 'date', current_date - 2),
  'reading in minutes is stored and returned (id and created_at aside)');
select is(pg_temp.learning_rows('agpa'), 1, 'one entry');
select is(public.agent_log_learning('pages', 'Chapter book', 3) ->> 'unit', 'pages', 'no unit for reading: pages, the way the app counts an entry with none');
select is(public.agent_log_learning('podcast', 'Leadership Hour', 2) ->> 'unit', 'episodes', 'no unit for a podcast: episodes');
select is(public.agent_log_learning('podcast', 'Leadership Hour', 45, 'minutes') ->> 'unit', 'minutes', 'podcast in minutes');
select is(public.agent_log_learning('pages', 'Chapters', 2, 'chapters') ->> 'unit', 'chapters', 'reading in chapters');
select is(public.agent_log_learning('workshop', 'Saturday workshop') - 'id' - 'created_at',
  jsonb_build_object('kind', 'workshop', 'title', 'Saturday workshop', 'amount', 1, 'unit', null, 'date', public.workspace_today('agp')),
  'a workshop: amount 1, no unit, the team''s today');
select is(public.agent_log_learning('conference', 'Summit', 1) ->> 'kind', 'conference', 'a conference (amount 1 is fine)');
select is(public.agent_log_learning('pages', null, 10) ->> 'title', 'Unnamed', 'no title is stored as Unnamed');
select is(public.agent_log_learning('podcast', '   ', 1) ->> 'title', 'Unnamed', 'so is a blank one');
select is(public.agent_log_learning('workshop', '') ->> 'title', 'Unnamed', 'and an empty one');
select is(public.agent_log_learning('pages', '  Padded  ', 5) ->> 'title', 'Padded', 'a title is trimmed');
select is(public.agent_log_learning('pages', 'Today', 5, null, public.workspace_today('agp')) ->> 'date', public.workspace_today('agp')::text, 'the team''s today is allowed');
select is(public.agent_log_learning('pages', 'Y2K', 5, null, date '2000-01-01') ->> 'date', '2000-01-01', 'so is the earliest date');
select is((select count(*)::int from public.learning where person_id = 'agpa' and workspace_id = 'agp'), 13, 'the 13 entries so far are Alex''s, in his team');
select is(public.agent_log_learning('pages', 'Fraction', 5) ->> 'amount', '5', 'amounts come back as whole numbers');
select is(pg_temp.q('select count(*) from public.learning where person_id <> ''agpa'''), '0', 'and no entry was made for anyone else');

-- refusals: nothing is logged
select is(public.agent_log_learning('reading', 'x', 5) ->> 'error', 'kind must be one of pages (reading), podcast, workshop, conference. Nothing was logged.', 'an unknown kind');
select is(public.agent_log_learning(null, 'x', 5) ->> 'error', 'kind must be one of pages (reading), podcast, workshop, conference. Nothing was logged.', 'a missing kind');
select is(public.agent_log_learning('pages', 'x', null) ->> 'error', 'amount is required: a whole number of pages from 1 to 100000. Nothing was logged.', 'reading needs an amount');
select is(public.agent_log_learning('podcast', 'x', null) ->> 'error', 'amount is required: a whole number of episodes from 1 to 100000. Nothing was logged.', 'so does a podcast');
select is(public.agent_log_learning('podcast', 'x', 0, 'minutes') ->> 'error', 'amount is required: a whole number of minutes from 1 to 100000. Nothing was logged.', 'zero');
select is(public.agent_log_learning('pages', 'x', -3) ->> 'error' like 'amount is required%', true, 'a negative amount');
select is(public.agent_log_learning('pages', 'x', 100001) ->> 'error' like 'amount is required%', true, 'more than 100000');
select is(public.agent_log_learning('pages', 'x', 5, 'episodes') ->> 'error', 'for reading (pages) the unit must be minutes, pages or chapters. Nothing was logged.', 'episodes for reading');
select is(public.agent_log_learning('podcast', 'x', 5, 'chapters') ->> 'error', 'for a podcast the unit must be minutes or episodes. Nothing was logged.', 'chapters for a podcast');
select is(public.agent_log_learning('podcast', 'x', 5, 'pages') ->> 'error' like 'for a podcast%', true, 'pages for a podcast');
select is(public.agent_log_learning('workshop', 'x', 1, 'minutes') ->> 'error', 'a workshop takes no unit. Nothing was logged.', 'a unit on a workshop');
select is(public.agent_log_learning('conference', 'x', 1, 'pages') ->> 'error', 'a conference takes no unit. Nothing was logged.', 'or a conference');
select is(public.agent_log_learning('workshop', 'x', 3) ->> 'error', 'a workshop is logged as one entry: leave amount out (or 1). Nothing was logged.', 'an amount of 3 for a workshop');
select is(public.agent_log_learning('pages', 'x', 5, null, public.workspace_today('agp') + 1) ->> 'error',
  'date must not be in the future (the team''s today is ' || public.workspace_today('agp') || '). Nothing was logged.', 'tomorrow');
select is(public.agent_log_learning('pages', 'x', 5, null, date '1999-12-31') ->> 'error', 'date must be 2000-01-01 or later. Nothing was logged.', 'before 2000');
select is(public.agent_log_learning('pages', repeat('t', 201), 5) ->> 'error', 'title must be at most 200 characters. Nothing was logged.', 'a title of 201 characters');
select is(pg_temp.learning_rows('agpa'), 14, 'after all those refusals the count is 14 (13, and the Fraction one before them)');
select is(pg_temp.last_result(2) like 'refused: title must be%', true, 'the last was audited as a refusal');

-- The table and the tool agree on (kind, unit): the tool accepts exactly what the table's constraint accepts.
select pg_temp.as_postgres();
create function pg_temp.table_accepts(p_kind text, p_unit text) returns boolean language plpgsql as $$
begin
  begin
    insert into public.learning (id, workspace_id, person_id, kind, title, amount, unit, date)
    values ('probe', 'agp', 'agpb', p_kind, 't', 1, p_unit, current_date);
    raise exception 'probe done' using errcode = 'P0001';
  exception
    when check_violation then return false;
    when sqlstate 'P0001' then return true;
  end;
end $$;
create function pg_temp.tool_accepts(p_kind text, p_unit text) returns boolean language plpgsql as $$
begin
  perform pg_temp.as_connector(3, 4);
  return (select (public.agent_log_learning(p_kind, 'probe', case when p_kind in ('pages', 'podcast') then 1 end, p_unit) ? 'error') is not true);
end $$;
create temp table kind_unit (kind text, unit text);
insert into kind_unit select k, u from unnest(array['pages', 'podcast', 'workshop', 'conference']) k,
  unnest(array[null, 'minutes', 'pages', 'chapters', 'episodes']) u;
grant select on kind_unit to public;
select is(pg_temp.tool_accepts(k.kind, k.unit), pg_temp.table_accepts(k.kind, k.unit), 'tool and table agree on ' || k.kind || ' / ' || coalesce(k.unit, 'no unit'))
  from kind_unit k order by k.kind, k.unit nulls first;
select pg_temp.as_postgres();

-- read-only, revoked and foreign connections
select pg_temp.as_connector(2, 3);
select throws_ok($$select public.agent_log_learning('pages', 'x', 5)$$, '42501', 'this connection is read-only', 'a read connection cannot log learning');
select pg_temp.as_connector(2, 5);
select throws_ok($$select public.agent_log_learning('pages', 'x', 5)$$, '28000', 'agent connection is not active', 'a revoked one cannot');
select throws_ok($$select public.agent_list_learning()$$, '28000', null, 'or list it');
select pg_temp.as_connector(1, 2);
select throws_ok($$select public.agent_log_learning('pages', 'x', 5)$$, '28000', null, 'a connection used by another login cannot');
select throws_ok($$select public.agent_list_learning()$$, '28000', null, 'nor list');
select is(pg_temp.learning_rows('agpl'), 0, 'and Lena has nothing logged');

-- list_learning ------------------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
delete from public.learning;
insert into public.learning (id, workspace_id, person_id, kind, title, amount, unit, date, created_at) values
  ('l1', 'agp', 'agpa', 'pages',      'Book A', 30, 'minutes',  current_date,       now() - interval '1 hour'),
  ('l2', 'agp', 'agpa', 'pages',      'Book A', 15, 'minutes',  current_date - 1,   now() - interval '2 hours'),
  ('l3', 'agp', 'agpa', 'pages',      'Book B', 20, 'pages',    current_date - 5,   now() - interval '3 hours'),
  ('l4', 'agp', 'agpa', 'podcast',    'Show C',  2, 'episodes', current_date - 10,  now() - interval '4 hours'),
  ('l5', 'agp', 'agpa', 'podcast',    'Show C', 45, 'minutes',  current_date - 20,  now() - interval '5 hours'),
  ('l6', 'agp', 'agpa', 'workshop',   'Old workshop', 1, null,  current_date - 40,  now() - interval '6 hours'),
  ('l7', 'agp', 'agpa', 'conference', 'Edge day', 1, null,      current_date - 30,  now() - interval '7 hours'),
  ('library:x:agpa', 'agp', 'agpa', 'pages', 'From the library', 12, null, current_date - 3, now() - interval '8 hours'),
  ('l9', 'agp', 'agpb', 'pages',      'Bea''s book', 99, 'pages', current_date,     now() - interval '9 hours');
select pg_temp.as_connector(2, 2);
select is((select count(*)::int from public.learning), 9, 'row-level security lets Alex see his downline''s entries too (9 in all)');
select is((select string_agg(x ->> 'id', ',' order by n) from jsonb_array_elements(public.agent_list_learning() -> 'entries') with ordinality t (x, n)),
  'l1,l2,library:x:agpa,l3,l4,l5', 'the default window is the last 30 days: his own, newest first, none of Bea''s');
select is(public.agent_list_learning() ->> 'from', (public.workspace_today('agp') - 29)::text, 'it starts 29 days before the team''s today');
select is(public.agent_list_learning() ->> 'until', public.workspace_today('agp')::text, 'and ends on it: 30 days');
select is(public.agent_list_learning() -> 'totals',
  '[{"kind": "pages", "unit": "minutes", "entries": 2, "amount": 45},
    {"kind": "pages", "unit": "pages", "entries": 2, "amount": 32},
    {"kind": "podcast", "unit": "episodes", "entries": 1, "amount": 2},
    {"kind": "podcast", "unit": "minutes", "entries": 1, "amount": 45}]'::jsonb,
  'totals per kind and unit (never adding minutes to pages); an entry with no unit counts in pages');
select is(public.agent_list_learning() -> 'entries' -> 2, ('{"id": "library:x:agpa", "kind": "pages", "title": "From the library", "amount": 12, "unit": "pages", "date": "' || (current_date - 3) || '"}')::jsonb,
  'an entry with no unit shows the unit the app counts it in; fields are id, kind, title, amount, unit, date');
select is(public.agent_list_learning() ->> 'truncated', 'false', 'not truncated');
select is(jsonb_array_length(public.agent_list_learning(current_date - 45, current_date) -> 'entries'), 8, 'a wider window takes in the older ones: all 8 of his');
select is(public.agent_list_learning(current_date - 45, current_date) -> 'entries' -> 7 ->> 'id', 'l6', 'oldest last');
select is(jsonb_array_length(public.agent_list_learning(current_date - 45, current_date) -> 'totals'), 6, 'six kind and unit totals');
select is(jsonb_array_length(public.agent_list_learning(current_date - 1, current_date - 1) -> 'entries'), 1, 'one day: from and until are inclusive');
select is(jsonb_array_length(public.agent_list_learning(current_date - 5) -> 'entries'), 4, 'only from: until is today (l1, l2, library, l3)');
select is(public.agent_list_learning(null, current_date - 10) ->> 'from', (current_date - 39)::text, 'only until: from is 29 days before it');
select is(public.agent_list_learning(null, current_date - 10) -> 'entries' -> 0 ->> 'id', 'l4', 'and newest first within it');
select is(public.agent_list_learning(current_date + 5) ->> 'until', (current_date + 5)::text, 'a window in the future is allowed, and empty');
select is(public.agent_list_learning(current_date + 5) -> 'entries', '[]'::jsonb, 'no entries');
select is(public.agent_list_learning(current_date + 5) -> 'totals', '[]'::jsonb, 'no totals');
select is(public.agent_list_learning(current_date, current_date - 1) ->> 'error', 'until must not be before from.', 'until before from is refused');
select is(public.agent_list_learning(current_date - 400, current_date) ->> 'error', 'the window can be at most 367 days.', 'a window over 367 days is refused');
select is(public.agent_list_learning(date '1999-01-01', date '1999-02-01') ->> 'error', 'from and until must be dates between 2000-01-01 and 2100-01-01.', 'a date before 2000');
select is(pg_temp.last_result(2), 'refused: from and until must be dates between 2000-01-01 and 2100-01-01.', 'refusals are audited');
select pg_temp.as_connector(3, 4);
select is((select string_agg(x ->> 'id', ',') from jsonb_array_elements(public.agent_list_learning() -> 'entries') x), 'l9', 'Bea sees only hers, though her sponsor''s are in the same table');
select pg_temp.as_connector(1, 1);
select is(public.agent_list_learning() -> 'entries', '[]'::jsonb, 'Lena has none: an empty list, whatever her downline logged');
select is(public.agent_list_learning() -> 'totals', '[]'::jsonb, 'and no totals');
select pg_temp.as_connector(2, 2);
select is(public.agent_log_learning('podcast', 'Fresh', 20, 'minutes') ->> 'date', public.workspace_today('agp')::text, 'a new entry...');
select is(public.agent_list_learning() -> 'entries' -> 0 ->> 'title', 'Fresh', '...is the first in the list');
select is((select x ->> 'amount' from jsonb_array_elements(public.agent_list_learning() -> 'totals') x where x ->> 'kind' = 'podcast' and x ->> 'unit' = 'minutes'), '65', 'and in the totals (45 + 20 minutes)');
select pg_temp.as_connector(2, 3);
select is(jsonb_array_length(public.agent_list_learning() -> 'entries'), 7, 'a read connection lists');

-- one audit row per call -----------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select is((select string_agg(tool || ':' || (result like 'refused%')::text, ',' order by id) from (select * from public.agent_audit
            where connection_id = pg_temp.conn(2) and tool in ('log_learning', 'list_learning') order by id desc limit 4) x),
  'list_learning:true,log_learning:false,list_learning:false,list_learning:false', 'the last four calls: one row each, the refused one marked');
select is((select count(*)::int from public.agent_audit where tool = 'log_learning' and result like 'logged %'), 24,
  'each logged entry has one row (24 over the file: 15 by hand, 9 from the kind and unit grid)');
select is((select new_values ->> 'title' from public.agent_audit where tool = 'log_learning' and result like 'logged %' order by id limit 1),
  'Go-Givers Sell More', 'whose new_values hold the stored entry');
select is((select count(*)::int from public.agent_audit a where a.arguments::text like '%SECRET%' or a.old_values::text like '%SECRET%'
             or a.new_values::text like '%SECRET%' or a.result like '%SECRET%'), 0, 'no IBO or LTD number in the audit rows');

select * from finish();
rollback;
