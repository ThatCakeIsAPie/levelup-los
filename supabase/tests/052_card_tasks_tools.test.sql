-- Pipeline cards: the agent tools (migration 20261108000100_card_tasks): list_cards, get_card, list_card_tasks,
-- add_card_task, update_card_task, complete_card_task, add_card_note, and whoami's new fields. Run the way the Edge
-- Function runs them (the login's claims and the connection id in settings, `set local role authenticated`, then the
-- tool). Row-level security decides who sees and changes what; the tools add nothing and take nothing away.
-- (A pgTAP session is not opened by the connector role; see the note in 043 and pretend_connector_session().)
-- Self-contained (workspace ctw, whose time zone is far from UTC), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(258);

-- Team 'ctw' (its time zone is far from UTC: see the note at the workspace). Leader Lena (ctl). Under her: apprentices
-- Alex (cta) and Ann (ctn), Dee (ctd, Lena's deputy) and Cal (ctc, a prospect with a login: a candidate). Under Alex: IBO
-- Bea (ctb). Xavier (ctx) leads a second line outside everyone's downline. Prospects: Lena's ctpl, Alex's ctpa and
-- ctpa2, Ann's ctpn, Bea's ctpb, Xavier's ctpx, and ctpo whose sponsor is Cal (not a registered person). Customer
-- people: ctca (Alex's). Names on lists (customer board): cte_a (Alex's, linked to ctca), cte_b (Bea's), cte_n (Ann's),
-- cte_x (Xavier's). Stored cards: recruiting ctpa, ctpb, ctpx; customer cte_a, cte_b (with a booked next step each).
-- ctpl, ctpn, ctpa2, cte_n and cte_x have no stored card: the board shows them all the same.
-- Logins: 1 Lena, 2 Alex, 3 Ann, 4 Bea, 5 Xavier, 6 Dee, 7 Cal, 8 a login with no person.

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000c100' || p_n)::uuid $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.agent_connection_id', '', true);
end $$;
-- Act as a login the way the app does (PostgREST): claims and the authenticated role.
create function pg_temp.as_login(p_n int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_n), 'role', 'authenticated',
    'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', '', true);
  perform set_config('role', 'authenticated', true);
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
-- Run one statement as the current role and undo it: 'rows=N' when it ran (N rows changed), else its SQLSTATE.
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception 'rows=%', v_rows using errcode = 'XX999';
  exception
    when sqlstate 'XX999' then return sqlerrm;
    when others then return sqlstate;
  end;
end $$;
create function pg_temp.try_as(p_n int, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_login(p_n);
  return pg_temp.try(p_sql);
end $$;
-- The same, without undoing it.
create function pg_temp.run_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
begin
  perform pg_temp.as_login(p_n);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    return 'rows=' || v_rows;
  exception when others then return sqlstate;
  end;
end $$;
-- A card key ('r:<prospect>' or 'c:<entry>') as the column it is stored under, and its id.
create function pg_temp.col(p_card text) returns text language sql immutable as $$
  select case when p_card like 'r:%' then 'person_id' else 'entry_id' end $$;
create function pg_temp.cid(p_card text) returns text language sql immutable as $$ select substr(p_card, 3) $$;
-- Everything on the cards that is the board's, not ours: the stored cards with their column and booked next step.
create function pg_temp.board_state() returns text language sql as $$
  select md5(coalesce((select string_agg(c::text, '|' order by c.person_id) from public.pipeline_cards c where c.workspace_id = 'ctw'), '')
             || '#' ||
             coalesce((select string_agg(c::text, '|' order by c.entry_id) from public.customer_cards c where c.workspace_id = 'ctw'), ''))
$$;

insert into public.workspaces (id, name, timezone) values
  ('ctw', 'Card Test Team',
   -- never the server's day: UTC+14 from 10:00 UTC on, UTC-11 before, so the team's date differs from UTC's all day
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end),
  ('cty', 'Other Team', 'America/Chicago');
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date, phone, email, ibo_number, ltd_number) values
  ('ctl',  'ctw', 'Lena Leader',     'ibo',        null,   null, public.workspace_today('ctw') - 900, '555-0001', 'lena@card.test',  'IBO-SECRET-L', 'LTD-SECRET-L'),
  ('cta',  'ctw', 'Alex Apprentice', 'apprentice', 'ctl',  null, public.workspace_today('ctw') - 100, '555-0002', 'alex@card.test',  'IBO-SECRET-A', 'LTD-SECRET-A'),
  ('ctn',  'ctw', 'Ann Apprentice',  'apprentice', 'ctl',  null, public.workspace_today('ctw') - 50,  '555-0003', null,              'IBO-SECRET-N', null),
  ('ctb',  'ctw', 'Bea Ibo',         'ibo',        'cta',  null, public.workspace_today('ctw') - 700, '555-0004', 'bea@card.test',   'IBO-SECRET-B', 'LTD-SECRET-B'),
  ('ctx',  'ctw', 'Xavier Outsider', 'ibo',        null,   null, public.workspace_today('ctw') - 800, '555-0005', null,              'IBO-SECRET-X', null),
  ('ctd',  'ctw', 'Dee Deputy',      'apprentice', 'ctl',  null, public.workspace_today('ctw') - 80,  null,       null,              null, null),
  ('ctc',  'ctw', 'Cal Candidate',   'prospect',   'ctl',  null, null,               null,       null,              null, null),
  ('ctpl', 'ctw', 'Pat Lenas',       'prospect',   'ctl',  null, null,               '555-0101', 'pat@card.test',   null, null),
  ('ctpa', 'ctw', 'Pia Alexs',       'prospect',   'cta',  null, null,               '555-0102', null,              null, null),
  ('ctpa2','ctw', 'Quinn Alexs',     'prospect',   'cta',  null, null,               null,       null,              null, null),
  ('ctpn', 'ctw', 'Pam Anns',        'prospect',   'ctn',  null, null,               null,       null,              null, null),
  ('ctpb', 'ctw', 'Paul Beas',       'prospect',   'ctb',  null, null,               '555-0105', null,              null, null),
  ('ctpx', 'ctw', 'Pax Xavs',        'prospect',   'ctx',  null, null,               null,       null,              null, null),
  ('ctpo', 'ctw', 'Orla Cals',       'prospect',   'ctc',  null, null,               null,       null,              null, null),
  ('ctca', 'ctw', 'Cara Customer',   'customer',   null,   'cta', null,              '555-0201', null,              null, null),
  ('ctz',  'cty', 'Zed Elsewhere',   'ibo',        null,   null, public.workspace_today('ctw') - 500, null,       null,              'IBO-SECRET-Z', null);
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'card-test-' || n || '@card.test'
  from generate_series(1, 8) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('ctw', 'ctl', pg_temp.login(1), 'leader'),
  ('ctw', 'cta', pg_temp.login(2), 'member'),
  ('ctw', 'ctn', pg_temp.login(3), 'member'),
  ('ctw', 'ctb', pg_temp.login(4), 'member'),
  ('ctw', 'ctx', pg_temp.login(5), 'member'),
  ('ctw', 'ctd', pg_temp.login(6), 'member'),
  ('ctw', 'ctc', pg_temp.login(7), 'member');
insert into public.deputies (workspace_id, leader_id, deputy_id) values ('ctw', 'ctl', 'ctd');
insert into public.list_entries (id, workspace_id, owner_id, name, customer_id) values
  ('cte_a', 'ctw', 'cta', 'Entry Alpha', 'ctca'),
  ('cte_b', 'ctw', 'ctb', 'Entry Bravo', null),
  ('cte_n', 'ctw', 'ctn', 'Entry November', null),
  ('cte_x', 'ctw', 'ctx', 'Entry Xray', null);
-- The stored cards, each with a booked next step, a note and a column of its own: none of it may ever change here.
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at, next_column, next_step_date, next_step_time, note) values
  ('ctpa', 'ctw', 'first_meeting', now() - interval '10 days', 'first_plan', public.workspace_today('ctw') + 3, time '10:30', 'card note A'),
  ('ctpb', 'ctw', 'contact', now() - interval '3 days', 'first_meeting', public.workspace_today('ctw') + 1, null, null),
  ('ctpx', 'ctw', 'first_plan', now() - interval '20 days', null, null, null, 'card note X');
insert into public.customer_cards (entry_id, workspace_id, column_id, entered_at, next_column, next_step_date, next_step_time, note) values
  ('cte_a', 'ctw', 'contact', now() - interval '5 days', 'first_meeting', public.workspace_today('ctw') + 2, time '14:00', 'entry note A'),
  ('cte_b', 'ctw', 'first_meeting', now() - interval '8 days', 'first_sale', public.workspace_today('ctw') + 5, null, null);

create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-00000000d0' || lpad(p_n::text, 2, '0'))::uuid $$;
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
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;
-- Every answer of the write tools in this file lands here, so assertions at the end can look at them.
create temp table seen (tool text, doc jsonb);
grant select, insert on seen to public;
create function pg_temp.keep(p_tool text, p_doc jsonb) returns jsonb language plpgsql as $$
begin
  insert into pg_temp.seen values (p_tool, p_doc);
  return p_doc;
end $$;
-- The values of one field of a list, in the list's order: 'a,b,c' (a path like 'person.id' or 'assignees.0.full_name').
create function pg_temp.col(p_doc jsonb, p_key text, p_field text) returns text language sql as $$
  select coalesce(string_agg(coalesce(x #>> string_to_array(p_field, '.'), '~'), ',' order by n), '')
    from jsonb_array_elements(p_doc -> p_key) with ordinality t (x, n) $$;
-- The same, sorted (for lists whose order depends on the time of day the test runs).
create function pg_temp.colset(p_doc jsonb, p_key text, p_field text) returns text language sql as $$
  select coalesce(string_agg(coalesce(x #>> string_to_array(p_field, '.'), '~'), ',' order by coalesce(x #>> string_to_array(p_field, '.'), '~') collate "C"), '')
    from jsonb_array_elements(p_doc -> p_key) t (x) $$;
create function pg_temp.audits(p_conn int) returns int language sql as $$
  select pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || '''')::int $$;
create function pg_temp.last_audit(p_conn int, p_col text) returns text language sql as $$
  select pg_temp.q('select ' || p_col || '::text from public.agent_audit where connection_id = ''' || pg_temp.conn(p_conn) || ''' order by id desc limit 1') $$;
create function pg_temp.task_row(p_id text) returns text language sql as $$
  select pg_temp.q('select md5(t::text) from public.card_tasks t where id = ''' || p_id || '''') $$;

-- More fixture: a prospect with no tasks, and tasks that are due at known moments of the TEAM's clock.
insert into public.people (id, workspace_id, name, biz_class, sponsor_id) values ('ctpa3', 'ctw', 'Rae Alexs', 'prospect', 'cta');
create temp table tnow as select (now() at time zone w.timezone) as local_now, w.timezone as tz, public.workspace_today('ctw') as today
  from public.workspaces w where w.id = 'ctw';
grant select on tnow to public;
insert into public.card_tasks (id, workspace_id, person_id, entry_id, title, done, done_at, done_by, due_date, due_time, assignee_id, position, created_by, created_at, updated_at)
select v.id, 'ctw', v.person_id, v.entry_id, v.title, v.done, case when v.done then now() - interval '1 day' end, case when v.done then 'ctl' end,
       v.due_date, v.due_time, v.assignee, v.position, v.created_by, now() - interval '2 days', now() - interval '2 days'
  from tnow, lateral (values
    ('ta1',  'ctpa',  null::text, 'Text Nik to confirm',  false, tnow.today + 2, time '09:00', 'cta', 0, 'ctl'),
    ('ta2',  'ctpa',  null, 'Send the deck',        true,  null::date, null::time, null::text, 1, 'cta'),
    ('ta3',  'ctpa',  null, 'Overdue for days',     false, tnow.today - 3, null, null, 2, 'cta'),
    ('ta4',  'ctpa',  null, 'Due an hour ago',      false, date_trunc('minute', tnow.local_now - interval '1 hour')::date, date_trunc('minute', tnow.local_now - interval '1 hour')::time, 'cta', 3, 'cta'),
    ('ta5',  'ctpa2', null, 'Due in an hour',       false, date_trunc('minute', tnow.local_now + interval '1 hour')::date, date_trunc('minute', tnow.local_now + interval '1 hour')::time, 'cta', 0, 'cta'),
    ('ta6',  'ctpa2', null, 'Due tomorrow',         false, tnow.today + 1, null, 'cta', 1, 'cta'),
    ('tb1',  'ctpb',  null, 'Invite to the session', false, null, null, 'ctb', 0, 'ctb'),
    ('tn1',  'ctpn',  null, 'Ask about timing',     false, null, null, null, 0, 'ctn'),
    ('ta7',  'ctpn',  null, 'Due today, no time',   false, tnow.today, null, 'ctn', 1, 'ctn'),
    ('tl1',  'ctpl',  null, 'Send the intro video', false, null, null, null, 0, 'ctl'),
    ('tx1',  'ctpx',  null, 'Book coffee',          false, null, null, null, 0, 'ctx'),
    ('tea1', null, 'cte_a', 'Call back',            false, null, null, 'cta', 0, 'cta'),
    ('teb1', null, 'cte_b', 'Send the sample',      false, null, null, 'ctb', 0, 'ctb'),
    ('ten1', null, 'cte_n', 'Follow up',            false, null, null, null, 0, 'ctn'),
    ('tex1', null, 'cte_x', 'Ask for a referral',   false, null, null, null, 0, 'ctx')
  ) v (id, person_id, entry_id, title, done, due_date, due_time, assignee, position, created_by);
insert into public.card_notes (id, workspace_id, person_id, entry_id, author_id, body, created_at) values
  ('nt-pa', 'ctw', 'ctpa', null, 'cta', 'Met at the gym', now() - interval '1 day'),
  ('nt-pb', 'ctw', 'ctpb', null, 'ctb', 'Likes the plan', now() - interval '1 day'),
  ('nt-ea', 'ctw', null, 'cte_a', 'cta', 'Likes samples', now() - interval '1 day'),
  ('nt-px', 'ctw', 'ctpx', null, 'ctx', 'Other line', now() - interval '1 day');
insert into public.feature_switches (workspace_id, feature, enabled) values ('ctw', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(1),  pg_temp.login(1), 'ctl', 'ctw', 'Lena write',  pg_temp.hash('k1'),  'write', null),
  (pg_temp.conn(2),  pg_temp.login(2), 'cta', 'ctw', 'Alex write',  pg_temp.hash('k2'),  'write', null),
  (pg_temp.conn(3),  pg_temp.login(2), 'cta', 'ctw', 'Alex read',   pg_temp.hash('k3'),  'read', null),
  (pg_temp.conn(4),  pg_temp.login(4), 'ctb', 'ctw', 'Bea write',   pg_temp.hash('k4'),  'write', null),
  (pg_temp.conn(5),  pg_temp.login(5), 'ctx', 'ctw', 'Xavier write', pg_temp.hash('k5'), 'write', null),
  (pg_temp.conn(6),  pg_temp.login(3), 'ctn', 'ctw', 'Ann write',   pg_temp.hash('k6'),  'write', null),
  (pg_temp.conn(7),  pg_temp.login(2), 'cta', 'ctw', 'Alex old',    pg_temp.hash('k7'),  'write', now() - interval '1 day'),
  (pg_temp.conn(8),  pg_temp.login(1), 'ctl', 'ctw', 'Lena read',   pg_temp.hash('k8'),  'read', null),
  (pg_temp.conn(9),  pg_temp.login(6), 'ctd', 'ctw', 'Dee write',   pg_temp.hash('k9'),  'write', null),
  (pg_temp.conn(10), pg_temp.login(7), 'ctc', 'ctw', 'Cal write',   pg_temp.hash('k10'), 'write', null);
select pg_temp.pretend_connector_session();
create temp table board_before as select pg_temp.board_state() as v;
grant select on board_before to public;
-- the trap: a tool may never write a card
create function pg_temp.no_card_writes() returns trigger language plpgsql as $$ begin raise exception 'a tool wrote a card' using errcode = 'XX888'; end $$;
create trigger card_trap_a before insert or update or delete on public.pipeline_cards for each statement execute function pg_temp.no_card_writes();
create trigger card_trap_b before insert or update or delete on public.customer_cards for each statement execute function pg_temp.no_card_writes();

-- Catalog: no tool function reads or writes the booking ----------------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'agent_private') and (p.proname like 'agent\_%card%' or p.proname like 'card\_%')
              and (p.prosrc ilike '%next_column%' or p.prosrc ilike '%next_step%' or p.prosrc ilike '%update public.pipeline_cards%'
                   or p.prosrc ilike '%update public.customer_cards%')), 0,
  'no card function or tool mentions the booked next step columns or writes a card');
select is((select array_agg(p.proname::text order by p.proname::text collate "C") from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'agent\_%card%'),
  array['agent_add_card_note', 'agent_add_card_task', 'agent_complete_card_task', 'agent_get_card', 'agent_list_card_tasks',
        'agent_list_cards', 'agent_update_card_task'], 'seven card tools');

-- whoami: the tools, and open_tasks -----------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is((select array_agg(x order by x collate "C") from jsonb_array_elements_text(public.agent_whoami() -> 'can') x),
  (select array_agg(substr(p.proname::text, 7) order by p.proname::text collate "C") from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'agent\_%'), 'a write connection can call every agent_ tool, the card tools included');
select is((public.agent_whoami() ->> 'open_tasks')::int, 6, 'Alex: 5 assigned to him and 1 unassigned on his own cards (the done one is not counted)');
select pg_temp.as_connector(1, 1);
select is((public.agent_whoami() ->> 'open_tasks')::int, 1, 'Lena: the unassigned task on her own prospect');
select pg_temp.as_connector(4, 4);
select is((public.agent_whoami() ->> 'open_tasks')::int, 2, 'Bea: her two');
select pg_temp.as_connector(3, 6);
select is((public.agent_whoami() ->> 'open_tasks')::int, 3, 'Ann: one assigned to her and unassigned ones on her prospect and her list');
select pg_temp.as_connector(1, 8);
select is((select array_agg(x order by x collate "C") from jsonb_array_elements_text(public.agent_whoami() -> 'can') x),
  (select array_agg(substr(p.proname::text, 7) order by p.proname::text collate "C") from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'agent\_%' and p.prosrc like '%agent_private.ctx(false)%'),
  'a read connection can call exactly the tools that ask for read access');
select is((select array_agg(x order by x collate "C") filter (where x like '%card%') from jsonb_array_elements_text(public.agent_whoami() -> 'can') x),
  array['get_card', 'list_card_tasks', 'list_cards'], 'which among the card tools are the three that read');

-- list_cards ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'person.id'), 'ctpa,ctpa2,cte_a,ctpa3',
  'Alex''s cards: the ones he owns, on both boards; with a next due first, in its order, then by name');
select is((public.agent_list_cards() ->> 'total')::int, 4, 'total');
select is(public.agent_list_cards() ->> 'timezone', (select tz from tnow), 'and the team''s time zone');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_list_cards() -> 'cards' -> 0) k),
  array['assignees', 'board', 'column', 'next_due', 'notes_count', 'owner', 'person', 'tasks_done', 'tasks_total'],
  'a card has exactly these fields: no booked next step, no note column');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_list_cards() -> 'cards' -> 2) k),
  array['assignees', 'board', 'column', 'customer_id', 'notes_count', 'owner', 'person', 'tasks_done', 'tasks_total'],
  'a name on the customer board also shows its linked customer');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'tasks_done') || '/' || pg_temp.col(public.agent_list_cards(), 'cards', 'tasks_total'), '1,0,0,0/4,2,1,0',
  'tasks done and total per card: ctpa 1 of 4, ctpa2 0 of 2, the list name 0 of 1, ctpa3 0 of 0');
select is((public.agent_list_cards() -> 'cards' -> 0 ->> 'next_due'), (select (today - 3)::text from tnow),
  'next_due is the earliest due among the open tasks: a date when that task has no time');
select is((public.agent_list_cards() -> 'cards' -> 1 ->> 'next_due'), (select to_char(date_trunc('minute', local_now + interval '1 hour'), 'YYYY-MM-DD"T"HH24:MI:SS') from tnow),
  'and the local date-time when it has one');
select is((public.agent_list_cards() -> 'cards' -> 1 ->> 'timezone'), (select tz from tnow), 'with the timezone beside it');
select is((public.agent_list_cards() -> 'cards' -> 0) ? 'timezone', false, 'and none when the next due is a date');
select is((public.agent_list_cards() -> 'cards' -> 3) ? 'next_due', false, 'a card with no open dated task has no next_due');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'assignees.0.full_name'), 'Alex Apprentice,Alex Apprentice,Alex Apprentice,~', 'the assignees of open tasks');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'owner.id'), 'cta,cta,cta,cta', 'every card shows its owner');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'notes_count'), '1,0,1,0', 'and its notes count');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'column.name'), 'First meeting (MG1),Contact made,Contact,Contact made',
  'the column names: a stored card''s column; Contact made for a prospect that never moved; Contact on the customer board');
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'board'), 'recruiting,recruiting,customer,recruiting', 'the board of each');
select is(pg_temp.col(public.agent_list_cards('recruiting'), 'cards', 'person.id'), 'ctpa,ctpa2,ctpa3', 'board recruiting');
select is(pg_temp.col(public.agent_list_cards('customer'), 'cards', 'person.id'), 'cte_a', 'board customer: the id is the name on the list');
select is(pg_temp.col(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'ctpa,ctpa2,cte_a,cte_b,ctpb,ctpa3',
  'mine_only false adds his team''s (Bea''s prospect and list name), nothing from other lines');
select is(pg_temp.col(public.agent_list_cards(p_person_id => 'ctpa2'), 'cards', 'person.id'), 'ctpa2', 'person_id: one prospect');
select is(pg_temp.col(public.agent_list_cards(p_person_id => 'cte_a'), 'cards', 'person.id'), 'cte_a', 'one name on a list');
select is(pg_temp.col(public.agent_list_cards(p_person_id => 'ctca'), 'cards', 'person.id'), 'cte_a', 'or the customer linked to it');
select is(pg_temp.col(public.agent_list_cards(p_has_open_tasks => true), 'cards', 'person.id'), 'ctpa,ctpa2,cte_a', 'has_open_tasks true');
select is(pg_temp.col(public.agent_list_cards(p_has_open_tasks => false), 'cards', 'person.id'), 'ctpa3', 'has_open_tasks false');
select is(pg_temp.col(public.agent_list_cards(p_due_from => (select today from tnow), p_due_until => (select today + 1 from tnow)), 'cards', 'person.id'), 'ctpa2',
  'due_from / due_until on the next due date (ctpa2''s is an hour from now: today or tomorrow, the team''s)');
select is(pg_temp.col(public.agent_list_cards(p_due_from => (select today - 3 from tnow), p_due_until => (select today - 3 from tnow)), 'cards', 'person.id'), 'ctpa',
  'a window of one day, both ends inclusive');
select is(pg_temp.col(public.agent_list_cards(p_due_from => (select today + 100 from tnow)), 'cards', 'person.id'), '', 'a window with nothing in it');
select is(pg_temp.col(public.agent_list_cards(p_overdue => true), 'cards', 'person.id'), 'ctpa', 'overdue: the card with an open task due before the team''s now');
select is(pg_temp.col(public.agent_list_cards(p_search => 'ENTRY'), 'cards', 'person.id'), 'cte_a', 'search matches the name, any case');
select is(pg_temp.col(public.agent_list_cards(p_search => '%'), 'cards', 'person.id'), '', 'and takes % as plain text');
select is((public.agent_list_cards(p_limit => 2, p_offset => 1) ->> 'total')::int, 4, 'limit and offset leave the total alone');
select is(pg_temp.col(public.agent_list_cards(p_limit => 2, p_offset => 1), 'cards', 'person.id'), 'ctpa2,cte_a', 'and page the list');
select is(public.agent_list_cards(p_limit => 2, p_offset => 10) ->> 'note', 'offset is past the last card (total 4).', 'an offset past the end says so');
select is(public.agent_list_cards() ? 'note', false, 'a list with cards has no note');
select is(public.agent_list_cards(p_board => 'both') ->> 'error', 'board must be recruiting, customer or all.', 'a bad board is refused');
select is(public.agent_list_cards(p_due_from => date '2026-12-01', p_due_until => date '2026-11-01') ->> 'error', 'due_until must not be before due_from.', 'a backwards window is refused');
select is(public.agent_list_cards(p_search => repeat('x', 101)) ->> 'error', 'search must be at most 100 characters.', 'a long search is refused');
select is(public.agent_list_cards(p_limit => 1000, p_offset => -5) ->> 'limit', '200', 'limit is cut to 200');
select is(public.agent_list_cards(p_search => 'zzz') ->> 'note', 'No card matches those filters among the cards you own; mine_only false looks at your team''s too.', 'no match: a note that says why and what to use');

-- who sees which cards through the tool ----------------------------------------------------------------------------------------------------
select pg_temp.as_connector(1, 1);
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'person.id'), 'ctc,ctpl', 'Lena owns two prospects (Cal is one: a prospect with a login)');
select is(pg_temp.colset(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'ctc,cte_a,cte_b,cte_n,ctpa,ctpa2,ctpa3,ctpb,ctpl,ctpn,ctpo',
  'with mine_only false she sees her whole line on both boards (not Xavier''s)');
select pg_temp.as_connector(4, 4);
select is(pg_temp.col(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'cte_b,ctpb', 'Bea sees only her own cards');
select pg_temp.as_connector(5, 5);
select is(pg_temp.colset(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'cte_x,ctpx', 'Xavier sees only his');
select pg_temp.as_connector(3, 6);
select is(pg_temp.colset(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'cte_n,ctpn', 'Ann sees only hers');
select pg_temp.as_connector(6, 9);
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'person.id'), '', 'the deputy owns no card');
select is(public.agent_list_cards() ->> 'note', 'You own no cards yet: a card is a prospect on the recruiting board or a name on the customer board, and a prospect has one as soon as add_prospect adds them. Use mine_only false to see your team''s cards.', 'and is told why and what to use');
select is(pg_temp.colset(public.agent_list_cards(p_mine_only => false), 'cards', 'person.id'), 'ctc,cte_a,cte_b,cte_n,ctpa,ctpa2,ctpa3,ctpb,ctpl,ctpn,ctpo', 'with mine_only false he sees what the leader''s line shows');

-- column names: the caller's own stage names, as the app resolves them ---------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.stage_names (person_id, workspace_id, pipeline, stage_key, name) values ('cta', 'ctw', 'recruiting', 'first_meeting', 'Coffee chat'), ('cta', 'ctw', 'recruiting', 'contact', 'Met');
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_cards('recruiting'), 'cards', 'column.name'), 'Coffee chat,Met,Met', 'Alex sees his own renamed stages');
select pg_temp.as_connector(4, 4);
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'column.name'), 'First meeting,Met', 'Bea inherits Alex''s names (the nearest upline) on the recruiting board only');
select pg_temp.as_connector(1, 1);
select is((select string_agg(distinct c #>> '{column,name}', ',') from jsonb_array_elements(public.agent_list_cards(p_mine_only => false, p_board => 'recruiting') -> 'cards') c), 'Contact made,First meeting (MG1)',
  'Lena, above Alex, does not (names come from the caller upwards)');
select pg_temp.as_postgres();
delete from public.stage_names where workspace_id = 'ctw';

-- get_card ------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_get_card('ctpa'), 'tasks', 'id'), 'ta1,ta2,ta3,ta4', 'a card with all its tasks, in position order');
select is(pg_temp.col(public.agent_get_card('ctpa'), 'notes', 'body'), 'Met at the gym', 'and its notes');
select is((select array_agg(k order by k) from jsonb_object_keys(public.agent_get_card('ctpa')) k),
  array['assignees', 'board', 'column', 'next_due', 'notes', 'notes_count', 'notes_truncated', 'owner', 'person', 'tasks', 'tasks_done', 'tasks_total'],
  'the card as list_cards shows it, plus tasks, notes and notes_truncated');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'uid', 'ta1@card-tasks.invalid', 'a task has a stable uid');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'summary', 'Text Nik to confirm', 'summary is the title');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'status', 'NEEDS-ACTION', 'status NEEDS-ACTION while open');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 1 ->> 'status', 'COMPLETED', 'COMPLETED when done');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 1 ? 'completed', true, 'with `completed`');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'due', (select (today + 2)::text || 'T09:00:00' from tnow), 'a task with a time: due is the local date-time');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'timezone', (select tz from tnow), 'with the team''s timezone');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'due_utc', (select to_char(((today + 2)::timestamp + time '09:00') at time zone tz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from tnow), 'and the UTC instant');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 2 ->> 'due', (select (today - 3)::text from tnow), 'a task with no time: due is a date');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 2 ? 'timezone', false, 'and has no timezone');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 #>> '{card,person,full_name}', 'Pia Alexs', 'the card''s person on every task');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 #>> '{assignee,full_name}', 'Alex Apprentice', 'the assignee');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 2 -> 'assignee', 'null'::jsonb, 'null when there is none');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 1 #>> '{completed_by,full_name}', 'Lena Leader', 'who completed it, by name even though Alex cannot read Lena as a person');
select is(public.agent_get_card('ctpa') -> 'tasks' -> 0 ->> 'created', agent_private.fmt_utc(now() - interval '2 days'), 'created is a UTC time');
select is(public.agent_get_card('cte_a', 'customer') ->> 'board', 'customer', 'the customer board''s card, by the name''s id');
select is(public.agent_get_card('cte_a', 'customer') #>> '{person,full_name}', 'Entry Alpha', 'with the name on the list as its person');
select is(public.agent_get_card('cte_a', 'customer') ->> 'customer_id', 'ctca', 'and the customer it became');
select is(public.agent_get_card('ctpa', 'customer') ->> 'error', 'No such card among the cards you can see on the customer board.', 'a prospect''s id on the customer board is no card');
select is(public.agent_get_card('cte_a') ->> 'error', 'No such card among the cards you can see on the recruiting board.', 'and a name''s id on the recruiting board');
select is(public.agent_get_card('ctca', 'customer') ->> 'error', 'No such card among the cards you can see on the customer board.', 'a customer''s own id is not how a customer card is addressed');
select is(public.agent_get_card('cta') ->> 'error', 'No such card among the cards you can see on the recruiting board.', 'a registered person has no card');
select is(public.agent_get_card('ctpa', 'both') ->> 'error', 'board must be recruiting or customer.', 'a bad board');
select pg_temp.as_connector(4, 4);
select is(public.agent_get_card('ctpa') ->> 'error', 'No such card among the cards you can see on the recruiting board.', 'Bea cannot see Alex''s card...');
select is(public.agent_get_card('no-such-id') ->> 'error', public.agent_get_card('ctpa') ->> 'error', '...and gets the very refusal an id that does not exist gets');
select is(public.agent_get_card('cte_a', 'customer') ->> 'error', 'No such card among the cards you can see on the customer board.', 'on the customer board too');
select pg_temp.as_connector(5, 5);
select is(public.agent_get_card('ctpa') ->> 'error', 'No such card among the cards you can see on the recruiting board.', 'the outsider neither');
select pg_temp.as_connector(1, 1);
select is(public.agent_get_card('ctpa') #>> '{owner,full_name}', 'Alex Apprentice', 'Lena reads Alex''s card, with its owner');
select is(public.agent_get_card('cte_a', 'customer') ->> 'board', 'customer', 'and Alex''s list name: the customer board is visible to uplines (only the customer record is private)');
select pg_temp.as_connector(6, 9);
select is(public.agent_get_card('ctpa') ->> 'tasks_total', '4', 'the deputy reads what the leader reads');

-- list_card_tasks --------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_card_tasks(), 'tasks', 'id'), 'ta3,ta4,ta5,ta6,ta1,tea1',
  'Alex''s open tasks: assigned to him, or unassigned on his own cards; dated first by due date and time (no time: end of day), then the undated');
select is((public.agent_list_card_tasks() ->> 'total')::int, 6, 'total');
select is(public.agent_list_card_tasks() ->> 'timezone', (select tz from tnow), 'with the team''s time zone');
select is(pg_temp.col(public.agent_list_card_tasks(p_status => 'done'), 'tasks', 'id'), 'ta2', 'status done');
select is(pg_temp.col(public.agent_list_card_tasks(p_status => 'all'), 'tasks', 'id'), 'ta3,ta4,ta5,ta6,ta1,tea1,ta2', 'status all');
select is(pg_temp.col(public.agent_list_card_tasks(p_overdue => true), 'tasks', 'id'), 'ta3,ta4', 'overdue: before the team''s now (a date-only task after its day, a timed one after its time)');
select is(pg_temp.col(public.agent_list_card_tasks(p_due_from => (select today + 2 from tnow)), 'tasks', 'id'), 'ta1', 'due_from');
select is(pg_temp.col(public.agent_list_card_tasks(p_due_until => (select today - 3 from tnow)), 'tasks', 'id'), 'ta3', 'due_until, inclusive');
select is(pg_temp.col(public.agent_list_card_tasks(p_due_from => (select today + 1 from tnow), p_due_until => (select today + 2 from tnow)), 'tasks', 'id'), 'ta6,ta1', 'a window');
select is(pg_temp.col(public.agent_list_card_tasks(p_person_id => 'ctpa2'), 'tasks', 'id'), 'ta5,ta6', 'person_id: one card');
select is(pg_temp.col(public.agent_list_card_tasks(p_person_id => 'ctca'), 'tasks', 'id'), 'tea1', 'or the customer linked to a name');
select is(pg_temp.col(public.agent_list_card_tasks(p_assigned => 'all'), 'tasks', 'id'), 'ta3,ta4,ta5,ta6,ta1,tb1,tea1,teb1', 'assigned all: every open task he can see');
select is(pg_temp.col(public.agent_list_card_tasks(p_assigned => 'team'), 'tasks', 'id'), 'tb1,teb1', 'assigned team: Bea''s (he is her upline)');
select is(pg_temp.col(public.agent_list_card_tasks(p_changed_since => now() - interval '1 hour'), 'tasks', 'id'), '', 'changed_since: nothing changed in the last hour yet');
select is(pg_temp.col(public.agent_list_card_tasks(p_limit => 2, p_offset => 1), 'tasks', 'id'), 'ta4,ta5', 'limit and offset');
select is((public.agent_list_card_tasks(p_limit => 2, p_offset => 1) ->> 'total')::int, 6, 'the total does not move');
select is(public.agent_list_card_tasks(p_offset => 50) ->> 'note', 'offset is past the last task (total 6).', 'past the end');
select is(public.agent_list_card_tasks(p_status => 'later') ->> 'error', 'status must be open, done or all.', 'a bad status');
select is(public.agent_list_card_tasks(p_assigned => 'x') ->> 'error', 'assigned must be me, team or all.', 'a bad assigned');
select is(public.agent_list_card_tasks(p_status => 'done', p_overdue => true) ->> 'error', 'overdue means open and past due: use status open (the default) or all, or leave overdue out.', 'overdue is for open tasks');
select is(public.agent_list_card_tasks(p_due_from => date '2026-12-01', p_due_until => date '2026-11-01') ->> 'error', 'due_until must not be before due_from.', 'a backwards window');
select is(public.agent_list_card_tasks(p_due_from => (select today + 100 from tnow)) ->> 'note',
  'No open tasks for you match those filters. Try status all, assigned all or fewer filters. Use add_card_task to add one to a card (list_cards shows the cards).', 'an empty answer says why and what to use');
select is(public.agent_list_card_tasks(p_assigned => 'team', p_status => 'done') ->> 'note',
  'No done tasks for your team. Try status all, assigned all or fewer filters. Use add_card_task to add one to a card (list_cards shows the cards).', 'for the team too');
select pg_temp.as_connector(1, 1);
select is(pg_temp.col(public.agent_list_card_tasks(), 'tasks', 'id'), 'tl1', 'Lena: only the unassigned task on her own prospect');
select is(pg_temp.colset(public.agent_list_card_tasks(p_assigned => 'team'), 'tasks', 'id'), 'ta1,ta3,ta4,ta5,ta6,ta7,tb1,tea1,teb1,ten1,tn1',
  'her team: assigned to people under her, or unassigned on their cards');
select is(pg_temp.col(public.agent_list_card_tasks(p_assigned => 'all', p_overdue => true), 'tasks', 'id'), 'ta3,ta4', 'overdue across the line (ta7 is due today with no time: not yet)');
select is((select count(*)::int from jsonb_array_elements(public.agent_list_card_tasks(p_assigned => 'all', p_status => 'all') -> 'tasks') t where t #>> '{card,person,id}' in ('ctpx', 'cte_x')), 0, 'nothing of the other line');
select pg_temp.as_connector(4, 4);
select is(pg_temp.colset(public.agent_list_card_tasks(p_assigned => 'all', p_status => 'all'), 'tasks', 'id'), 'tb1,teb1', 'Bea sees none of Alex''s');
select pg_temp.as_connector(5, 5);
select is(pg_temp.colset(public.agent_list_card_tasks(p_assigned => 'all', p_status => 'all'), 'tasks', 'id'), 'tex1,tx1', 'Xavier only his line');
select pg_temp.as_connector(6, 9);
select is(pg_temp.colset(public.agent_list_card_tasks(p_assigned => 'team'), 'tasks', 'id'), 'ta1,ta3,ta4,ta5,ta6,ta7,tb1,tea1,teb1,ten1,tn1', 'the deputy''s team view is the leader''s line');
select is(public.agent_list_card_tasks() ->> 'note', 'No open tasks for you. Use add_card_task to add one to a card (list_cards shows the cards).', 'and an empty list of his own says so');

-- add_card_task: the owner's example on a card with no tasks ----------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select pg_temp.as_connector(2, 2);
select pg_temp.keep('add_card_task', public.agent_add_card_task('ctpa3', 'Text Nik to confirm', 'recruiting', date '2026-11-19', time '09:00'));
select is(pg_temp.q('select count(*)::text from public.card_tasks where person_id = ''ctpa3'''), '1', 'one task was added');
select is((select doc #>> '{task,summary}' from pg_temp.seen where tool = 'add_card_task' limit 1), 'Text Nik to confirm', 'its summary is the title');
select is((select doc #>> '{task,due}' from pg_temp.seen where tool = 'add_card_task' limit 1), '2026-11-19T09:00:00', 'due is a local date-time...');
select is((select doc #>> '{task,timezone}' from pg_temp.seen where tool = 'add_card_task' limit 1), (select tz from tnow), '...with the team''s timezone');
select is((select doc #>> '{task,due_utc}' from pg_temp.seen where tool = 'add_card_task' limit 1),
  (select to_char(timestamp '2026-11-19 09:00' at time zone tz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') from tnow), 'and the UTC instant');
select is((select doc #>> '{task,status}' from pg_temp.seen where tool = 'add_card_task' limit 1), 'NEEDS-ACTION', 'open');
select is((select doc ->> 'tasks_done' || '/' || (doc ->> 'tasks_total') from pg_temp.seen where tool = 'add_card_task' limit 1), '0/1', 'the card''s summary in the answer reads 0/1');
select is((select doc ->> 'next_due' from pg_temp.seen where tool = 'add_card_task' limit 1), '2026-11-19T09:00:00', 'with that next_due');
select is(pg_temp.q('select created_by from public.card_tasks where person_id = ''ctpa3'''), 'cta', 'made by the caller');
select is(pg_temp.q('select assignee_id is null from public.card_tasks where person_id = ''ctpa3'''), 'true', 'unassigned: it is Alex''s as the card''s owner');
select is(pg_temp.last_audit(2, 'new_values ->> ''name'''), 'Rae Alexs', 'the audit row records the card''s person name where add_prospect records its prospect');
select is(pg_temp.last_audit(2, 'new_values ->> ''id'''), 'ctpa3', 'and id');
select is(pg_temp.last_audit(2, 'new_values ->> ''board'''), 'recruiting', 'and the board');
select is((public.agent_list_cards(p_person_id => 'ctpa3') -> 'cards' -> 0 ->> 'tasks_done') || '/' || (public.agent_list_cards(p_person_id => 'ctpa3') -> 'cards' -> 0 ->> 'tasks_total'), '0/1', 'list_cards agrees: 0/1');
select is(public.agent_list_cards(p_person_id => 'ctpa3') -> 'cards' -> 0 ->> 'next_due', '2026-11-19T09:00:00', 'and the card''s next due');
select is(pg_temp.col(public.agent_list_card_tasks(p_person_id => 'ctpa3'), 'tasks', 'summary'), 'Text Nik to confirm', 'and list_card_tasks lists it for Alex');
-- tick it, untick it, change it
select pg_temp.keep('complete_card_task', public.agent_complete_card_task((select doc #>> '{task,id}' from pg_temp.seen where tool = 'add_card_task' limit 1)));
select is((select doc ->> 'tasks_done' || '/' || (doc ->> 'tasks_total') from pg_temp.seen where tool = 'complete_card_task' limit 1), '1/1', 'ticked: 1/1');
select is((select doc #>> '{task,status}' from pg_temp.seen where tool = 'complete_card_task' limit 1), 'COMPLETED', 'COMPLETED');
select is((select doc #>> '{task,completed_by,full_name}' from pg_temp.seen where tool = 'complete_card_task' limit 1), 'Alex Apprentice', 'by the caller');
select is((select doc ? 'next_due' from pg_temp.seen where tool = 'complete_card_task' limit 1), false, 'a card with only done tasks has no next due');
select is(pg_temp.q('select (done_at = now())::text from public.card_tasks where person_id = ''ctpa3'''), 'true', 'done_at is stamped');
select is(public.agent_complete_card_task((select doc #>> '{task,id}' from pg_temp.seen where tool = 'add_card_task' limit 1)) ->> 'note', 'That task was already done.', 'ticking a done task says so');
select is(public.agent_complete_card_task((select doc #>> '{task,id}' from pg_temp.seen where tool = 'add_card_task' limit 1), false) #>> '{task,status}', 'NEEDS-ACTION', 'unticking reopens it');
select is(pg_temp.q('select (done_at is null and done_by is null)::text from public.card_tasks where person_id = ''ctpa3'''), 'true', 'and clears done_at and done_by');
select is((public.agent_list_cards(p_person_id => 'ctpa3') -> 'cards' -> 0 ->> 'tasks_done'), '0', 'back to 0/1');
select is(public.agent_complete_card_task('no-such-task') ->> 'error', 'No such task among the cards you can see. Nothing was changed.', 'an unknown task is refused');
create temp table tid as select doc #>> '{task,id}' as id from pg_temp.seen where tool = 'add_card_task' limit 1;
grant select on tid to public;
select is(public.agent_update_card_task((select id from tid), '{"due_date": "2026-11-20"}'::jsonb) ->> 'next_due', '2026-11-20T09:00:00', 'update_card_task: a new due date keeps the time, and the card''s next_due follows');
select is(public.agent_update_card_task((select id from tid), '{"title": "  Text Nik again "}'::jsonb) #>> '{tasks,0,summary}', 'Text Nik again', 'a new title, trimmed');
select is(public.agent_update_card_task((select id from tid), '{"due_time": null}'::jsonb) ->> 'next_due', '2026-11-20', 'clearing the time leaves the date');
select is(public.agent_update_card_task((select id from tid), '{"due_date": null, "due_time": "10:00"}'::jsonb) ->> 'error', 'due_time needs a due_date. To remove the due date, send due_date and due_time both as null. Nothing was changed.', 'a time with no date is refused');
select is(public.agent_update_card_task((select id from tid), '{"due_time": "10:00"}'::jsonb) ->> 'next_due', '2026-11-20T10:00:00', 'a time with the date is fine');
select is(public.agent_update_card_task((select id from tid), '{"due_date": null}'::jsonb) ->> 'error', 'due_time needs a due_date. To remove the due date, send due_date and due_time both as null. Nothing was changed.', 'clearing only the date of a timed task is refused');
select is(public.agent_update_card_task((select id from tid), '{"due_date": null, "due_time": null}'::jsonb) ? 'next_due', false, 'clearing both removes the due date');
select is(public.agent_update_card_task((select id from tid), '{"assignee_id": "cta"}'::jsonb) #>> '{tasks,0,assignee,full_name}', 'Alex Apprentice', 'assignee_id: the owner');
select is(public.agent_update_card_task((select id from tid), '{"assignee_id": null}'::jsonb) #>> '{tasks,0,assignee}', null, 'null clears the assignee');
select is(public.agent_update_card_task((select id from tid), '{"assignee_id": "ctb"}'::jsonb) ->> 'error', 'assignee_id must be the card''s owner (Alex Apprentice) or you. Nothing was changed.', 'someone who is neither the owner nor the caller is refused');
select is(public.agent_update_card_task((select id from tid), '{"title": "Same"}'::jsonb) ->> 'note', null, 'a real change has no note');
select is(public.agent_update_card_task((select id from tid), '{"title": "Same"}'::jsonb) ->> 'note', 'Nothing changed: the task already has those values.', 'and repeating it says nothing changed');
select is(public.agent_update_card_task((select id from tid), '{"due_date": "2026-02-30"}'::jsonb) ->> 'error', 'due_date must be a real date, YYYY-MM-DD, or null. Nothing was changed.', 'an impossible date');
select is(public.agent_update_card_task((select id from tid), '{"due_time": "25:00"}'::jsonb) ->> 'error', 'due_time must be a time of day, HH:MM (24 hours), or null. Nothing was changed.', 'an impossible time');
select is(public.agent_update_card_task((select id from tid), '{"title": ""}'::jsonb) ->> 'error', 'title must be text of 1 to 200 characters. Nothing was changed.', 'an empty title');
select is(public.agent_update_card_task((select id from tid), '{}'::jsonb) ->> 'error', 'Nothing to change: give at least one of title, due_date, due_time, assignee_id.', 'an empty patch');
-- every other key is refused by name, and nothing changes
select is(public.agent_update_card_task((select id from tid), jsonb_build_object(k, 'x')) ->> 'error',
          'Only title, due_date, due_time and assignee_id can be changed here; "' || k || '" cannot (complete_card_task ticks a task). Nothing was changed.',
          'update_card_task refuses ' || k || ' by name')
  from unnest(array['done', 'done_at', 'done_by', 'person_id', 'entry_id', 'card_id', 'board', 'position', 'created_by', 'created_at', 'updated_at', 'id', 'workspace_id', 'note', 'next_column', 'status']) k;
select is(public.agent_update_card_task((select id from tid), '{"title": "Fine", "person_id": "ctpa"}'::jsonb) ->> 'error',
  'Only title, due_date, due_time and assignee_id can be changed here; "person_id" cannot (complete_card_task ticks a task). Nothing was changed.', 'one bad key refuses the whole patch');
select is(pg_temp.q('select title from public.card_tasks where id = ''' || (select id from tid) || ''''), 'Same', 'and none of it changed anything');
-- add_card_task refusals
select is(public.agent_add_card_task('ctpa3', '') ->> 'error', 'title must be 1 to 200 characters. Nothing was added.', 'an empty title');
select is(public.agent_add_card_task('ctpa3', repeat('x', 201)) ->> 'error', 'title must be 1 to 200 characters. Nothing was added.', 'a title over 200 characters');
select is(public.agent_add_card_task('ctpa3', 'x', p_due_time => time '09:00') ->> 'error', 'due_time needs a due_date: a time of day belongs to a day. Nothing was added.', 'a time with no date');
select is(public.agent_add_card_task('ctpa3', 'x', p_board => 'both') ->> 'error', 'board must be recruiting or customer. Nothing was added.', 'a bad board');
select is(public.agent_add_card_task('ctpa3', 'x', p_assignee_id => 'ctb') ->> 'error', 'assignee_id must be the card''s owner (Alex Apprentice) or you. Nothing was added.', 'an assignee who is neither the owner nor the caller');
select is(public.agent_add_card_task('ctpa3', 'x', p_assignee_id => 'ctpa') ->> 'error', 'assignee_id must be the card''s owner (Alex Apprentice) or you. Nothing was added.', 'a prospect cannot be an assignee');
select is(public.agent_add_card_task('cta', 'x') ->> 'error', 'No such card among the cards you can see on the recruiting board. Nothing was added.', 'a registered person has no card');
select is(public.agent_add_card_task('ctpa3', 'On the list', 'customer') ->> 'error', 'No such card among the cards you can see on the customer board. Nothing was added.', 'nor does a prospect id name a customer card');
-- a customer card
select is(public.agent_add_card_task('cte_a', 'Send samples', 'customer', (select today + 30 from tnow), null, 'cta') #>> '{task,card,board}', 'customer', 'a task on a name on the customer board');
select is(public.agent_get_card('cte_a', 'customer') ->> 'tasks_total', '2', 'it shows on that card');
select pg_temp.as_connector(4, 4);
select is(public.agent_add_card_task('ctpa3', 'Sneaky') ->> 'error', 'No such card among the cards you can see on the recruiting board. Nothing was added.', 'Bea cannot add a task to Alex''s card');
select is(public.agent_complete_card_task((select id from tid)) ->> 'error', 'No such task among the cards you can see. Nothing was changed.', 'or tick its task');
select is(public.agent_update_card_task((select id from tid), '{"title": "Sneaky"}'::jsonb) ->> 'error', 'No such task among the cards you can see. Nothing was changed.', 'or change it');
select is(public.agent_add_card_note('ctpa3', 'Sneaky') ->> 'error', 'No such card among the cards you can see on the recruiting board. Nothing was added.', 'or add a note');
select pg_temp.as_connector(5, 5);
select is(public.agent_add_card_task('cte_a', 'Sneaky', 'customer') ->> 'error', 'No such card among the cards you can see on the customer board. Nothing was added.', 'the outsider cannot add one to a list name of Alex''s');

-- an upline assigns a task to the team member whose card it is, or takes one on --------------------------------------------------------------------
select pg_temp.as_connector(1, 1);
select pg_temp.keep('add_card_task', public.agent_add_card_task('ctpa3', 'Lena asks Alex to invite', 'recruiting', (select today + 10 from tnow), null, 'cta'));
select is(pg_temp.q('select (assignee_id, created_by)::text from public.card_tasks where title = ''Lena asks Alex to invite'''), '(cta,ctl)', 'Lena adds a task on Alex''s prospect assigned to Alex, made by Lena');
select is(public.agent_add_card_task('ctpa3', 'Lena takes this', 'recruiting', null, null, 'ctl') #>> '{task,assignee,id}', 'ctl', 'and one she takes herself');
select is(public.agent_add_card_task('ctpa3', 'For Bea?', 'recruiting', null, null, 'ctb') ->> 'error', 'assignee_id must be the card''s owner (Alex Apprentice) or you. Nothing was added.', 'but not one for someone who is neither');
select is(public.agent_add_card_task('cte_a', 'Lena on a list', 'customer', null, null, 'cta') #>> '{task,assignee,id}', 'cta', 'on the customer board as well');
select is(pg_temp.col(public.agent_list_card_tasks(p_assigned => 'team', p_person_id => 'ctpa3'), 'tasks', 'summary'), 'Lena asks Alex to invite,Same', 'Lena sees her task to Alex under team (and the one Alex left unassigned on his own card)');
select is(pg_temp.col(public.agent_list_card_tasks(p_person_id => 'ctpa3'), 'tasks', 'summary'), 'Lena takes this', 'and her own under me');
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_card_tasks(p_person_id => 'ctpa3'), 'tasks', 'summary'), 'Lena asks Alex to invite,Same', 'Alex sees the task Lena gave him under me, with his own (the one Lena took is not his)');
select is(pg_temp.q('select new_values ->> ''name'' from public.agent_audit where connection_id = ''' || pg_temp.conn(1) || ''' and tool = ''add_card_task'' order by id desc limit 1'), 'Entry Alpha', 'Lena''s last add_card_task audit row names the card');
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_card_tasks(p_assigned => 'team', p_person_id => 'ctpa3'), 'tasks', 'summary'), '', 'team means people below the caller: a task Lena took on Alex''s card is not his team''s');
select is(pg_temp.colset(public.agent_list_card_tasks(p_assigned => 'all', p_person_id => 'ctpa3'), 'tasks', 'summary'), 'Lena asks Alex to invite,Lena takes this,Same', 'but is in all');
-- overdue is judged on the TEAM's clock, whatever the server's
select pg_temp.as_postgres();
update public.card_tasks set due_date = (select today + 9 from tnow) where id = 'ta3';
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_list_cards(p_overdue => true), 'cards', 'person.id'), 'ctpa', 'list_cards overdue: only the hour-ago task is overdue (the one an hour ahead is not), in the team''s time');
select is(pg_temp.col(public.agent_list_card_tasks(p_overdue => true), 'tasks', 'id'), 'ta4', 'and so in list_card_tasks');
select pg_temp.as_postgres();
update public.card_tasks set due_date = (select today - 3 from tnow) where id = 'ta3';
select pg_temp.as_connector(6, 9);
select is(public.agent_add_card_task('ctpa3', 'The deputy', 'recruiting', null, null, 'ctd') #>> '{task,assignee,id}', 'ctd', 'the deputy edits like the leader: a task of his own');
select is(public.agent_add_card_task('ctpa3', 'For the leader', 'recruiting', null, null, 'ctl') ->> 'error', 'assignee_id must be the card''s owner (Alex Apprentice) or you. Nothing was added.', 'but not one for the leader he acts for (neither the owner nor himself)');

-- the size of a checklist
select pg_temp.as_postgres();
insert into public.card_tasks (id, workspace_id, person_id, title, position)
select 'bulk-' || n, 'ctw', 'ctpa2', 'Bulk ' || n, 10 + n from generate_series(1, 97) n;
select pg_temp.as_connector(2, 2);
select is(public.agent_add_card_task('ctpa2', 'The hundredth') #>> '{task,summary}', 'The hundredth', 'a card takes a hundredth task');
select is(public.agent_add_card_task('ctpa2', 'One too many') ->> 'error', 'A card holds at most 100 tasks. Nothing was added.', 'and refuses the next');
select pg_temp.as_postgres();
delete from public.card_tasks where id like 'bulk-%' or title = 'The hundredth';

-- notes ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
select pg_temp.keep('add_card_note', public.agent_add_card_note('ctpa3', 'First call went well'));
select is((select doc ->> 'notes_count' from pg_temp.seen where tool = 'add_card_note' limit 1), '1', 'a note and the card''s notes_count');
select is((select doc #>> '{note,author,full_name}' from pg_temp.seen where tool = 'add_card_note' limit 1), 'Alex Apprentice', 'by the caller');
select is((select doc #>> '{card,person,id}' from pg_temp.seen where tool = 'add_card_note' limit 1), 'ctpa3', 'on the card');
select is(public.agent_add_card_note('ctpa3', '  Second note  ') ->> 'notes_count', '2', 'a second');
select pg_temp.as_postgres();
update public.card_notes set created_at = now() - interval '1 minute' where body = 'First call went well';
select pg_temp.as_connector(2, 2);
select is(pg_temp.col(public.agent_get_card('ctpa3'), 'notes', 'body'), 'Second note,First call went well', 'get_card lists them newest first');
select is(public.agent_get_card('ctpa3') ->> 'notes_count', '2', 'with the count');
select is(public.agent_get_card('ctpa3') ->> 'notes_truncated', 'false', 'not truncated');
select is(pg_temp.last_audit(2, 'new_values ->> ''name'''), 'Rae Alexs', 'the audit row names the card''s person');
select is(public.agent_add_card_note('cte_a', 'On a list name', 'customer') ->> 'notes_count', '2', 'a note on the customer board');
select is(public.agent_add_card_note('ctpa3', '') ->> 'error', 'body must be 1 to 2000 characters. Nothing was added.', 'an empty note');
select is(public.agent_add_card_note('ctpa3', repeat('x', 2001)) ->> 'error', 'body must be 1 to 2000 characters. Nothing was added.', 'a note over 2000 characters');
select is(public.agent_add_card_note('ctpa3', 'x', 'both') ->> 'error', 'board must be recruiting or customer. Nothing was added.', 'a bad board');
select pg_temp.as_postgres();
insert into public.card_notes (id, workspace_id, person_id, author_id, body, created_at)
select 'many-' || n, 'ctw', 'ctpb', 'ctb', 'Note ' || n, now() + make_interval(secs => n) from generate_series(1, 101) n;
select pg_temp.as_connector(2, 2);
select is(jsonb_array_length(public.agent_get_card('ctpb') -> 'notes'), 100, 'get_card returns the 100 newest notes');
select is(public.agent_get_card('ctpb') ->> 'notes_truncated', 'true', 'and says it cut');
select is(public.agent_get_card('ctpb') -> 'notes' -> 0 ->> 'body', 'Note 101', 'newest first');
select is(public.agent_get_card('ctpb') ->> 'notes_count', '102', 'notes_count counts them all');
select pg_temp.as_postgres();
delete from public.card_notes where id like 'many-%';

-- the connection: read-only, revoked, foreign, the wrong person ---------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 3);
select is(pg_temp.col(public.agent_list_cards(), 'cards', 'person.id'), 'ctpa,ctpa2,ctpa3,cte_a', 'a read connection lists cards');
select is(public.agent_get_card('ctpa') ->> 'tasks_total', '4', 'gets one');
select is(jsonb_array_length(public.agent_list_card_tasks() -> 'tasks') > 0, true, 'and lists tasks');
select throws_ok($$select public.agent_add_card_task('ctpa3', 'Nope')$$, '42501', 'this connection is read-only', 'but add_card_task is refused');
select throws_ok($$select public.agent_update_card_task('ta1', '{"title": "Nope"}'::jsonb)$$, '42501', 'this connection is read-only', 'update_card_task');
select throws_ok($$select public.agent_complete_card_task('ta1')$$, '42501', 'this connection is read-only', 'complete_card_task');
select throws_ok($$select public.agent_add_card_note('ctpa3', 'Nope')$$, '42501', 'this connection is read-only', 'add_card_note');
select pg_temp.as_connector(2, 7);
select throws_ok($$select public.agent_list_cards()$$, '28000', 'agent connection is not active', 'a revoked connection: list_cards');
select throws_ok($$select public.agent_get_card('ctpa')$$, '28000', null, 'get_card');
select throws_ok($$select public.agent_list_card_tasks()$$, '28000', null, 'list_card_tasks');
select throws_ok($$select public.agent_add_card_task('ctpa3', 'Nope')$$, '28000', null, 'add_card_task');
select throws_ok($$select public.agent_update_card_task('ta1', '{"title": "Nope"}'::jsonb)$$, '28000', null, 'update_card_task');
select throws_ok($$select public.agent_complete_card_task('ta1')$$, '28000', null, 'complete_card_task');
select throws_ok($$select public.agent_add_card_note('ctpa3', 'Nope')$$, '28000', null, 'add_card_note');
select pg_temp.as_connector(2, 1);
select throws_ok($$select public.agent_list_cards()$$, '28000', 'agent connection is not active', 'another person''s connection used with Alex''s login: list_cards');
select throws_ok($$select public.agent_add_card_task('ctpa3', 'Nope')$$, '28000', null, 'add_card_task');
select throws_ok($$select public.agent_list_card_tasks()$$, '28000', null, 'list_card_tasks');
select throws_ok($$select public.agent_get_card('ctpa')$$, '28000', null, 'get_card');
select throws_ok($$select public.agent_complete_card_task('ta1')$$, '28000', null, 'complete_card_task');
select pg_temp.as_connector(7, 10);
select throws_ok($$select public.agent_list_cards()$$, '42501', null, 'a candidate with a login is refused: list_cards');
select throws_ok($$select public.agent_add_card_task('ctpa3', 'Nope')$$, '42501', null, 'add_card_task');
select pg_temp.as_postgres();
select is(pg_temp.q('select count(*)::text from public.card_tasks where title in (''Nope'', ''Sneaky'')'), '0', 'none of the refusals changed anything');

-- exactly one audit row per call, refusals included -----------------------------------------------------------------------------------------------------
select pg_temp.as_connector(2, 2);
create temp table acount (n int);
grant all on acount to public;
insert into acount select pg_temp.audits(2);
select public.agent_list_cards(); select public.agent_list_cards(p_board => 'both'); select public.agent_get_card('ctpa'); select public.agent_get_card('nope');
select public.agent_list_card_tasks(); select public.agent_list_card_tasks(p_status => 'x');
select public.agent_add_card_task('ctpa3', 'Audit me'); select public.agent_add_card_task('ctpa3', '');
select public.agent_update_card_task((select id from tid), '{"note": "x"}'::jsonb); select public.agent_update_card_task('nope', '{"title": "x"}'::jsonb);
select public.agent_complete_card_task((select id from tid)); select public.agent_complete_card_task('nope');
select public.agent_add_card_note('ctpa3', 'Audit me'); select public.agent_add_card_note('nope', 'x');
select is(pg_temp.audits(2) - (select n from acount), 14, 'fourteen calls, fourteen audit rows (seven tools, each once answered and once refused)');
select is(pg_temp.last_audit(2, 'result'), 'refused: No such card among the cards you can see on the recruiting board.', 'a refusal is recorded in words');
select is(pg_temp.q('select count(*)::text from public.agent_audit where connection_id = ''' || pg_temp.conn(2) || ''' and tool in (''add_card_task'', ''add_card_note'', ''update_card_task'', ''complete_card_task'') and new_values ->> ''name'' is null and result not like ''refused%'''), '0',
  'every answered write records the card''s person and name');
select pg_temp.as_postgres();

-- no IBO or LTD number anywhere, and the boards are untouched -------------------------------------------------------------------------------------------
select is((select count(*)::int from pg_temp.seen where doc::text ~ '(IBO|LTD)-SECRET'), 0, 'no IBO or LTD number in any answer');
select is((select count(*)::int from public.agent_audit where (coalesce(arguments::text, '') || coalesce(result, '') || coalesce(old_values::text, '') || coalesce(new_values::text, '')) ~ '(IBO|LTD)-SECRET'), 0, 'or any audit row');
select is(pg_temp.board_state(), (select v from board_before), 'the cards, their columns and booking columns are byte-identical after every call in this file');

select * from finish();
rollback;
