-- Pipeline cards: tasks and notes (migration 20261108000100_card_tasks): who reads and who edits, on both boards.
-- The rule is the cards' own: whoever reads a card reads its tasks and notes, whoever edits a card adds, changes, ticks
-- and deletes its tasks, whoever reads a card adds a note, an author deletes their own. Proved here against the stored
-- cards' own policies for every login, plus: the assignee rule, the stamps, due time, the cascades, and that the
-- boards (columns, booked next step) are untouched. Self-contained (workspace ctw), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(628);


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


-- Tasks and notes, one or two on every card (inserted as the database owner: the guards skip these writes).
insert into public.card_tasks (id, workspace_id, person_id, entry_id, title, done, done_at, done_by, due_date, due_time, assignee_id, position, created_by, created_at, updated_at) values
  ('ta1',  'ctw', 'ctpa', null, 'Text Nik to confirm',  false, null, null, public.workspace_today('ctw') + 2, time '09:00', 'cta', 0, 'ctl', now() - interval '2 days', now() - interval '2 days'),
  ('ta2',  'ctw', 'ctpa', null, 'Send the deck',        true,  now() - interval '1 day', 'ctl', null, null, null, 1, 'cta', now() - interval '2 days', now() - interval '2 days'),
  ('tb1',  'ctw', 'ctpb', null, 'Invite to the session', false, null, null, null, null, 'ctb', 0, 'ctb', now() - interval '2 days', now() - interval '2 days'),
  ('tn1',  'ctw', 'ctpn', null, 'Ask about timing',     false, null, null, null, null, null, 0, 'ctn', now() - interval '2 days', now() - interval '2 days'),
  ('tl1',  'ctw', 'ctpl', null, 'Send the intro video', false, null, null, null, null, null, 0, 'ctl', now() - interval '2 days', now() - interval '2 days'),
  ('tx1',  'ctw', 'ctpx', null, 'Book coffee',          false, null, null, null, null, null, 0, 'ctx', now() - interval '2 days', now() - interval '2 days'),
  ('tea1', 'ctw', null, 'cte_a', 'Call back',           false, null, null, null, null, 'cta', 0, 'cta', now() - interval '2 days', now() - interval '2 days'),
  ('teb1', 'ctw', null, 'cte_b', 'Send the sample',     false, null, null, null, null, 'ctb', 0, 'ctb', now() - interval '2 days', now() - interval '2 days'),
  ('ten1', 'ctw', null, 'cte_n', 'Follow up',           false, null, null, null, null, null, 0, 'ctn', now() - interval '2 days', now() - interval '2 days'),
  ('tex1', 'ctw', null, 'cte_x', 'Ask for a referral',  false, null, null, null, null, null, 0, 'ctx', now() - interval '2 days', now() - interval '2 days');
insert into public.card_notes (id, workspace_id, person_id, entry_id, author_id, body, created_at) values
  ('nt-pa', 'ctw', 'ctpa', null, 'cta', 'Met at the gym', now() - interval '1 day'),
  ('nt-pb', 'ctw', 'ctpb', null, 'ctb', 'Likes the plan', now() - interval '1 day'),
  ('nt-pn', 'ctw', 'ctpn', null, 'ctn', 'Busy this week', now() - interval '1 day'),
  ('nt-pl', 'ctw', 'ctpl', null, 'ctl', 'Old friend', now() - interval '1 day'),
  ('nt-px', 'ctw', 'ctpx', null, 'ctx', 'Other line', now() - interval '1 day'),
  ('nt-ea', 'ctw', null, 'cte_a', 'cta', 'Likes samples', now() - interval '1 day'),
  ('nt-eb', 'ctw', null, 'cte_b', 'ctb', 'Asked about price', now() - interval '1 day'),
  ('nt-en', 'ctw', null, 'cte_n', 'ctn', 'Cold lead', now() - interval '1 day'),
  ('nt-ex', 'ctw', null, 'cte_x', 'ctx', 'Other line list', now() - interval '1 day');
create temp table board_before as select pg_temp.board_state() as v;
grant select on board_before to public;

create function pg_temp.parity(p_n int) returns boolean language plpgsql as $$
declare
  a text; b text; c text; d text;
begin
  perform pg_temp.as_login(p_n);
  select string_agg(x, ',' order by x collate "C") into a from public.card_upline_ids() x;
  select string_agg(p.id, ',' order by p.id collate "C") into b from public.people p where public.is_upline_of(p.id);
  select string_agg(x, ',' order by x collate "C") into c from public.card_entry_ids() x;
  select string_agg(e.id, ',' order by e.id collate "C") into d from public.list_entries e where public.list_entry_visible(e.id);
  return a is not distinct from b and c is not distinct from d;
end $$;
create function pg_temp.read_parity(p_n int) returns boolean language plpgsql as $$
begin
  perform pg_temp.as_login(p_n);
  return (select count(*) from public.pipeline_cards where person_id = 'ctpa') = (select count(*) from public.card_tasks where id = 'ta1')
     and (select count(*) from public.pipeline_cards where person_id = 'ctpb') = (select count(*) from public.card_tasks where id = 'tb1')
     and (select count(*) from public.pipeline_cards where person_id = 'ctpx') = (select count(*) from public.card_tasks where id = 'tx1')
     and (select count(*) from public.customer_cards where entry_id = 'cte_a') = (select count(*) from public.card_tasks where id = 'tea1')
     and (select count(*) from public.customer_cards where entry_id = 'cte_b') = (select count(*) from public.card_tasks where id = 'teb1');
end $$;
create function pg_temp.ins_sql(p_card text) returns text language sql as $$
  select format('insert into public.card_tasks (id, %s, title) values (%L, %L, %L)', pg_temp.col(p_card),
                'ins-' || md5(random()::text), pg_temp.cid(p_card), 'A new task') $$;
create function pg_temp.note_sql(p_card text) returns text language sql as $$
  select format('insert into public.card_notes (id, %s, body) values (%L, %L, %L)', pg_temp.col(p_card),
                'insn-' || md5(random()::text), pg_temp.cid(p_card), 'A new note') $$;

-- The tables ---------------------------------------------------------------------------------------------------------
select has_table('public', 'card_tasks', 'card_tasks exists');
select has_table('public', 'card_notes', 'card_notes exists');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'card_tasks'),
  array['id', 'workspace_id', 'person_id', 'entry_id', 'title', 'done', 'done_at', 'done_by', 'due_date', 'due_time',
        'assignee_id', 'position', 'created_by', 'created_at', 'updated_at'], 'card_tasks has exactly these columns');
select is((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
            where table_schema = 'public' and table_name = 'card_notes'),
  array['id', 'workspace_id', 'person_id', 'entry_id', 'author_id', 'body', 'created_at'], 'card_notes has exactly these columns');
select is((select count(*)::int from information_schema.columns where table_schema = 'public'
            and table_name in ('pipeline_cards', 'customer_cards')
            and column_name in ('due_date', 'due_time', 'assignee_id', 'title', 'status', 'done')), 0,
  'the cards themselves gain no due date, assignee, title or status column');
select ok((select relrowsecurity from pg_class where oid = 'public.card_tasks'::regclass), 'card_tasks has row-level security');
select ok((select relrowsecurity from pg_class where oid = 'public.card_notes'::regclass), 'card_notes has row-level security');
select ok(not has_table_privilege('anon', 'public.card_tasks', 'select') and not has_table_privilege('anon', 'public.card_notes', 'select'),
  'anon has no privilege on either');
select ok(not has_table_privilege('authenticated', 'public.card_notes', 'truncate'), 'nobody truncates');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.card_tasks'::regclass and not tgisinternal), 1, 'one trigger on card_tasks (the guard)');
select is((select count(*)::int from pg_trigger where tgrelid in ('public.pipeline_cards'::regclass, 'public.customer_cards'::regclass) and not tgisinternal
            and tgname not in ('pipeline_cards_guard', 'customer_cards_guard', 'pipeline_cards_sync_rating')), 0, 'and none on the cards that this adds');

-- The helper sets are exactly the ones they stand in for, for every login ----------------------------------------------------
select ok(pg_temp.parity(n), 'login ' || n || ': card_upline_ids() is is_upline_of() and card_entry_ids() is list_entry_visible()')
  from generate_series(1, 8) n order by n;
select pg_temp.as_login(1);
select is((select string_agg(x, ',' order by x collate "C") from public.card_upline_ids() x where x like 'ct_' ), 'cta,ctb,ctc,ctd,ctn',
  'Lena is an upline of everyone on her line') ;
select pg_temp.as_login(6);
select is((select string_agg(x, ',' order by x) from public.card_upline_ids() x where x in ('ctl', 'ctd', 'cta', 'ctn', 'ctb')), 'cta,ctb,ctn',
  'a deputy is an upline of the leader''s team, not of the leader and not of themself');

-- Who reads what (row-level security as that login) -----------------------------------------------------------------------

select pg_temp.as_login(1);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'ta1,ta2,tb1,tea1,teb1,ten1,tl1,tn1',
  'tasks Lena (leader) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-ea,nt-eb,nt-en,nt-pa,nt-pb,nt-pl,nt-pn',
  'notes Lena (leader) reads');
select pg_temp.as_login(2);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'ta1,ta2,tb1,tea1,teb1',
  'tasks Alex (apprentice under Lena) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-ea,nt-eb,nt-pa,nt-pb',
  'notes Alex (apprentice under Lena) reads');
select pg_temp.as_login(3);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'ten1,tn1',
  'tasks Ann (apprentice under Lena) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-en,nt-pn',
  'notes Ann (apprentice under Lena) reads');
select pg_temp.as_login(4);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'tb1,teb1',
  'tasks Bea (IBO under Alex) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-eb,nt-pb',
  'notes Bea (IBO under Alex) reads');
select pg_temp.as_login(5);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'tex1,tx1',
  'tasks Xavier (outsider, other line) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-ex,nt-px',
  'notes Xavier (outsider, other line) reads');
select pg_temp.as_login(6);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), 'ta1,ta2,tb1,tea1,teb1,ten1,tl1,tn1',
  'tasks Dee (the deputy) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), 'nt-ea,nt-eb,nt-en,nt-pa,nt-pb,nt-pl,nt-pn',
  'notes Dee (the deputy) reads');
select pg_temp.as_login(7);
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_tasks where workspace_id = 'ctw'), '',
  'tasks Cal (candidate with a login) reads');
select is((select coalesce(string_agg(id, ',' order by id collate "C"), '') from public.card_notes where workspace_id = 'ctw'), '',
  'notes Cal (candidate with a login) reads');

select pg_temp.as_login(8);
select is((select count(*)::int from public.card_tasks) + (select count(*)::int from public.card_notes), 0, 'a login with no person reads nothing');
select pg_temp.as_postgres();
set local role anon;
select throws_ok($$select count(*) from public.card_tasks$$, '42501', null, 'anon cannot read tasks');
select throws_ok($$select count(*) from public.card_notes$$, '42501', null, 'or notes');
reset role;

-- The same people as the cards' own policies: the stored cards, read and edited as each login ---------------------------
select is((pg_temp.try_as(a.n, format('update public.pipeline_cards set hot = hot where person_id = %L', pg_temp.cid(c.card))) = 'rows=1'),
           (pg_temp.try_as(a.n, pg_temp.ins_sql(c.card)) = 'rows=1'),
           a.who || ' ' || c.k || ': may edit the card exactly when they may add a task')
  from (values
  (1, 'Lena'),
  (2, 'Alex'),
  (3, 'Ann'),
  (4, 'Bea'),
  (5, 'Xavier'),
  (6, 'Dee'),
  (7, 'Cal')
  ) a (n, who)
  cross join (values ('pa', 'r:ctpa'), ('pb', 'r:ctpb'), ('px', 'r:ctpx')) c (k, card)
  order by a.n, c.k;
select is((pg_temp.try_as(a.n, format('update public.customer_cards set note = note where entry_id = %L', pg_temp.cid(c.card))) = 'rows=1'),
           (pg_temp.try_as(a.n, pg_temp.ins_sql(c.card)) = 'rows=1'),
           a.who || ' ' || c.k || ': may edit the customer card exactly when they may add a task')
  from (values
  (1, 'Lena'),
  (2, 'Alex'),
  (3, 'Ann'),
  (4, 'Bea'),
  (5, 'Xavier'),
  (6, 'Dee'),
  (7, 'Cal')
  ) a (n, who)
  cross join (values ('ea', 'c:cte_a'), ('eb', 'c:cte_b')) c (k, card)
  order by a.n, c.k;
select ok(pg_temp.read_parity(n), 'login ' || n || ': reads a stored card exactly when they read its tasks, on both boards') from generate_series(1, 8) n order by n;
select pg_temp.as_postgres();

-- Who edits (the cards' own people, on every card of both boards) ----------------------------------------------------------
-- (card, actor): 'rows=1' / 'rows=0' / the error code
create temp table actors (n int, reads text[], who text);
insert into actors values
  (1, array['pa', 'pb', 'pn', 'pl', 'ea', 'eb', 'en'], 'Lena'),
  (2, array['pa', 'pb', 'ea', 'eb'], 'Alex'),
  (3, array['pn', 'en'], 'Ann'),
  (4, array['pb', 'eb'], 'Bea'),
  (5, array['px', 'ex'], 'Xavier'),
  (6, array['pa', 'pb', 'pn', 'pl', 'ea', 'eb', 'en'], 'Dee'),
  (7, array[]::text[], 'Cal');
create temp table cardlist (k text, card text);
insert into cardlist values
  ('pa', 'r:ctpa'),
  ('pb', 'r:ctpb'),
  ('pn', 'r:ctpn'),
  ('pl', 'r:ctpl'),
  ('px', 'r:ctpx'),
  ('ea', 'c:cte_a'),
  ('eb', 'c:cte_b'),
  ('en', 'c:cte_n'),
  ('ex', 'c:cte_x');
create temp table tasklist (k text, task text, card text);
insert into tasklist values
  ('pa', 'ta1', 'r:ctpa'),
  ('pb', 'tb1', 'r:ctpb'),
  ('pn', 'tn1', 'r:ctpn'),
  ('pl', 'tl1', 'r:ctpl'),
  ('px', 'tx1', 'r:ctpx'),
  ('ea', 'tea1', 'c:cte_a'),
  ('eb', 'teb1', 'c:cte_b'),
  ('en', 'ten1', 'c:cte_n'),
  ('ex', 'tex1', 'c:cte_x');
create temp table authors (k text, n int);
insert into authors values
  ('pa', 2),
  ('pb', 4),
  ('pn', 3),
  ('pl', 1),
  ('px', 5),
  ('ea', 2),
  ('eb', 4),
  ('en', 3),
  ('ex', 5);
grant select on actors, cardlist, tasklist, authors to public;

select is(pg_temp.try_as(a.n, pg_temp.ins_sql(c.card)), case when c.k = any (a.reads) then 'rows=1' else '42501' end,
          'add a task to ' || c.k || ': ' || a.who)
  from actors a cross join cardlist c order by a.n, c.k;
select is(pg_temp.try_as(a.n, format('update public.card_tasks set title = %L where id = %L', 'Renamed', t.task)), case when t.k = any (a.reads) then 'rows=1' else 'rows=0' end,
          'rename the task on ' || t.k || ': ' || a.who)
  from actors a cross join tasklist t order by a.n, t.k;
select is(pg_temp.try_as(a.n, format('update public.card_tasks set done = true where id = %L', t.task)), case when t.k = any (a.reads) then 'rows=1' else 'rows=0' end,
          'tick the task on ' || t.k || ': ' || a.who)
  from actors a cross join tasklist t order by a.n, t.k;
select is(pg_temp.try_as(a.n, format('delete from public.card_tasks where id = %L', t.task)), case when t.k = any (a.reads) then 'rows=1' else 'rows=0' end,
          'delete the task on ' || t.k || ': ' || a.who)
  from actors a cross join tasklist t order by a.n, t.k;
select is(pg_temp.try_as(a.n, pg_temp.note_sql(c.card)), case when c.k = any (a.reads) then 'rows=1' else '42501' end,
          'add a note to ' || c.k || ': ' || a.who)
  from actors a cross join cardlist c order by a.n, c.k;
select is(pg_temp.try_as(a.n, format('delete from public.card_notes where id = %L', 'nt-' || c.k)),
          case when c.k = any (a.reads) and a.n = u.n then 'rows=1' else 'rows=0' end,
          'delete the note on ' || c.k || ': ' || a.who || ' (only its author)')
  from actors a cross join cardlist c join authors u on u.k = c.k order by a.n, c.k;
select is(pg_temp.try_as(a.n, format('update public.card_notes set body = %L where id = %L', 'Rewritten', 'nt-' || c.k)), 'rows=0',
          'nobody edits the note on ' || c.k || ': ' || a.who)
  from actors a cross join cardlist c order by a.n, c.k;
select pg_temp.as_postgres();
select is((select count(*)::int from public.card_tasks where workspace_id = 'ctw'), 10, 'none of those left a task behind');
select is((select count(*)::int from public.card_notes where workspace_id = 'ctw'), 9, 'or a note');

-- The assignee: the card's owner or the caller, and registered --------------------------------------------------------------
-- (actor, card, assignee, expected)
select is(pg_temp.try_as(v.n, format('insert into public.card_tasks (id, %s, title, assignee_id) values (%L, %L, %L, %L)', pg_temp.col(v.card), 'asg-1', pg_temp.cid(v.card), 'T', v.assignee)),
          v.expected, v.descr)
  from (values
    (2, 'r:ctpa', 'cta', 'rows=1', 'Alex gives a task on his prospect to himself'),
    (2, 'r:ctpa', 'ctb', '42501', 'Alex cannot give it to Bea (neither the owner nor himself)'),
    (2, 'r:ctpa', 'ctl', '42501', 'or to Lena'),
    (1, 'r:ctpa', 'cta', 'rows=1', 'Lena gives a task on Alex''s prospect to Alex, the owner'),
    (1, 'r:ctpa', 'ctl', 'rows=1', 'or takes it on herself'),
    (1, 'r:ctpa', 'ctb', '42501', 'but not to Bea'),
    (1, 'r:ctpb', 'ctb', 'rows=1', 'Lena gives a task on Bea''s prospect to Bea'),
    (1, 'r:ctpb', 'cta', '42501', 'not to Alex, who is Bea''s upline but not the owner'),
    (2, 'r:ctpb', 'cta', 'rows=1', 'Alex takes a task on Bea''s prospect himself'),
    (2, 'r:ctpb', 'ctb', 'rows=1', 'or gives it to Bea, the owner'),
    (6, 'r:ctpa', 'ctd', 'rows=1', 'the deputy takes one himself'),
    (6, 'r:ctpa', 'cta', 'rows=1', 'or gives it to the owner'),
    (6, 'r:ctpa', 'ctl', '42501', 'but not to the leader he acts for'),
    (1, 'r:ctpo', 'ctc', '42501', 'the owner of ctpo is not a registered person: Lena cannot assign it to them'),
    (1, 'r:ctpo', 'ctl', 'rows=1', 'she can take it herself'),
    (1, 'c:cte_a', 'cta', 'rows=1', 'customer board: Lena gives a task on Alex''s name to Alex, the list''s owner'),
    (1, 'c:cte_a', 'ctl', 'rows=1', 'or takes it'),
    (1, 'c:cte_a', 'ctb', '42501', 'not to Bea'),
    (2, 'c:cte_b', 'ctb', 'rows=1', 'Alex gives a task on Bea''s name to Bea'),
    (2, 'c:cte_b', 'cta', 'rows=1', 'or takes it'),
    (2, 'c:cte_b', 'ctl', '42501', 'not to Lena'),
    (4, 'r:ctpb', 'ctb', 'rows=1', 'Bea on her own prospect'),
    (4, 'r:ctpb', null, 'rows=1', 'no assignee at all is fine'),
    (2, 'r:ctpa', 'ctpa', '42501', 'a prospect is nobody''s assignee')
  ) v (n, card, assignee, expected, descr);
-- an assignee set at update time follows the same rule; clearing it is always allowed
select is(pg_temp.try_as(v.n, format('update public.card_tasks set assignee_id = %s where id = %L', coalesce(quote_literal(v.assignee), 'null'), v.task)),
          v.expected, v.descr)
  from (values
    (1, 'ta1', 'ctl', 'rows=1', 'Lena takes over Alex''s task on his prospect'),
    (1, 'ta1', 'ctb', '42501', 'but cannot hand it to Bea'),
    (1, 'ta1', null, 'rows=1', 'she can clear the assignee'),
    (2, 'tb1', 'cta', 'rows=1', 'Alex takes Bea''s task'),
    (2, 'tb1', 'ctl', '42501', 'but cannot hand it to Lena'),
    (2, 'teb1', 'ctb', 'rows=1', 'on the customer board too: back to Bea, the owner'),
    (2, 'teb1', 'ctn', '42501', 'not to Ann'),
    (6, 'tea1', 'ctd', 'rows=1', 'the deputy takes a task on Alex''s name')
  ) v (n, task, assignee, expected, descr);
-- a task whose assignee was set before is not re-checked when something else changes
select pg_temp.as_postgres();
update public.card_tasks set assignee_id = 'ctn' where id = 'ta1';
select is(pg_temp.try_as(2, $$update public.card_tasks set title = 'Retitled' where id = 'ta1'$$), 'rows=1', 'changing only the title does not re-check an old assignee');
select pg_temp.as_postgres();
update public.card_tasks set assignee_id = 'cta' where id = 'ta1';

-- Which card a task may point at -------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('bad-1', 'cta', 'x')$$), '23514', 'a registered person has no card on the recruiting board');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('bad-2', 'ctca', 'x')$$), '23514', 'nor a customer record');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, entry_id, title) values ('bad-3', 'ctpa', 'cte_a', 'x')$$), '23514', 'a task is on one card, not two');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, title) values ('bad-4', 'x')$$), '42501', 'nor on none (there is no such card)');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('bad-5', 'ctpa2', 'x')$$), 'rows=1', 'a prospect with no stored card gets tasks (the board shows them in Contact made)');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, entry_id, title) values ('bad-6', 'cte_zz', 'x')$$), '42501', 'a name that does not exist has no card');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, workspace_id, person_id, title) values ('bad-7', 'cty', 'ctpa', 'x')$$), '23514', 'another team''s workspace id is refused');
select is(pg_temp.try_as(5, $$insert into public.card_tasks (id, person_id, title) values ('bad-8', 'ctpa', 'x')$$), '42501', 'the outsider has no access to Alex''s prospect');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('t-long', 'ctpa', repeat('x', 201))$$), '23514', 'a title over 200 characters is refused');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('t-empty', 'ctpa', '   ')$$), '23514', 'an empty title is refused');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title) values ('t-200', 'ctpa', repeat('x', 200))$$), 'rows=1', 'and exactly 200 is fine');
select is(pg_temp.try_as(2, $$insert into public.card_notes (id, person_id, body) values ('n-long', 'ctpa', repeat('x', 2001))$$), '23514', 'a note over 2000 characters is refused');
select is(pg_temp.try_as(2, $$insert into public.card_notes (id, person_id, body) values ('n-2000', 'ctpa', repeat('x', 2000))$$), 'rows=1', 'and exactly 2000 is fine');
select is(pg_temp.try_as(2, $$insert into public.card_notes (id, person_id, entry_id, body) values ('n-two', 'ctpa', 'cte_a', 'x')$$), '23514', 'a note is on one card, not two');

-- A due time needs a due date ----------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title, due_time) values ('d-1', 'ctpa', 'x', time '09:00')$$), '23514', 'a time with no date is refused');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title, due_date, due_time) values ('d-2', 'ctpa', 'x', date '2026-11-19', time '09:00')$$), 'rows=1', 'a time with a date is fine');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, person_id, title, due_date) values ('d-3', 'ctpa', 'x', date '2026-11-19')$$), 'rows=1', 'a date alone too');
select is(pg_temp.try_as(2, $$update public.card_tasks set due_date = null where id = 'ta1'$$), '23514', 'clearing the date of a task that has a time is refused');
select is(pg_temp.try_as(2, $$update public.card_tasks set due_date = null, due_time = null where id = 'ta1'$$), 'rows=1', 'clearing both is fine');
select is(pg_temp.try_as(2, $$update public.card_tasks set due_time = time '08:15' where id = 'tb1'$$), '23514', 'setting a time on a task with no date is refused');
select is(pg_temp.try_as(2, $$update public.card_tasks set due_date = date '2026-12-01', due_time = time '08:15' where id = 'tb1'$$), 'rows=1', 'with a date it is fine');

-- Stamps: who and when, never from the client ---------------------------------------------------------------------------------
select pg_temp.as_login(2);
insert into public.card_tasks (id, person_id, title, created_by, created_at, done, done_at, done_by, updated_at)
values ('st-1', 'ctpa', '  Padded title  ', 'ctl', '2000-01-01', false, '2000-01-01', 'ctl', '2000-01-01');
select pg_temp.as_postgres();
select is((select title from public.card_tasks where id = 'st-1'), 'Padded title', 'the title is trimmed');
select is((select created_by from public.card_tasks where id = 'st-1'), 'cta', 'created_by is the caller whatever the client sent');
select is((select created_at = now() from public.card_tasks where id = 'st-1'), true, 'created_at is now, not what the client sent');
select is((select (done, done_at, done_by) is not distinct from (false, null::timestamptz, null::text) from public.card_tasks where id = 'st-1'), true, 'an open task has no done_at or done_by, whatever the client sent');
select is((select workspace_id from public.card_tasks where id = 'st-1'), 'ctw', 'workspace_id came from the caller');
select pg_temp.as_login(2);
update public.card_tasks set done = true, done_at = '2000-01-01', done_by = 'ctl' where id = 'st-1';
select pg_temp.as_postgres();
select is((select (done, done_at = now(), done_by) from public.card_tasks where id = 'st-1')::text, '(t,t,cta)', 'ticking stamps done_at now and done_by the caller, not what was sent');
update public.card_tasks set done_at = now() - interval '1 hour' where id = 'st-1';
select pg_temp.as_login(1);
update public.card_tasks set title = 'Padded title, edited', done_at = '2000-01-01', done_by = 'ctl' where id = 'st-1';
select pg_temp.as_postgres();
select is((select done_by from public.card_tasks where id = 'st-1'), 'cta', 'another edit of a done task keeps who ticked it');
select is((select done_at <> '2000-01-01' from public.card_tasks where id = 'st-1'), true, 'and when');
select pg_temp.as_login(1);
update public.card_tasks set done = false where id = 'st-1';
select pg_temp.as_postgres();
select is((select (done_at is null and done_by is null) from public.card_tasks where id = 'st-1'), true, 'unticking clears done_at and done_by');
select pg_temp.as_login(1);
update public.card_tasks set done = true where id = 'st-1';
select pg_temp.as_postgres();
select is((select done_by from public.card_tasks where id = 'st-1'), 'ctl', 'ticking again is stamped by whoever ticked it this time');
select is((select (updated_at = now()) from public.card_tasks where id = 'st-1'), true, 'updated_at moves on every change');
select is((select updated_at = now() from public.card_tasks where id = 'ta1'), true, 'including the ones above');
select is((select updated_at < now() from public.card_tasks where id = 'tn1'), true, 'and stays put on tasks nobody touched');
select pg_temp.as_login(2);
insert into public.card_tasks (id, person_id, title, done) values ('st-2', 'ctpa', 'Born done', true);
select pg_temp.as_postgres();
select is((select (done_at = now(), done_by) from public.card_tasks where id = 'st-2')::text, '(t,cta)', 'a task created done is stamped too');
select pg_temp.as_login(2);
insert into public.card_notes (id, person_id, author_id, body, created_at) values ('st-n', 'ctpa', 'ctl', '  A padded note ', '2000-01-01');
select pg_temp.as_postgres();
select is((select (author_id, created_at = now(), body)::text from public.card_notes where id = 'st-n'), '(cta,t,"A padded note")', 'a note is the caller''s, now, trimmed, whatever the client sent');

-- What may not change ------------------------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$update public.card_tasks set person_id = 'ctpa2' where id = 'ta1'$$), '42501', 'a task cannot move to another card');
select is(pg_temp.try_as(2, $$update public.card_tasks set person_id = null, entry_id = 'cte_a' where id = 'ta1'$$), '42501', 'or to the other board');
select is(pg_temp.try_as(2, $$update public.card_tasks set created_by = 'cta' where id = 'tb1'$$), '42501', 'who made it cannot change');
select is(pg_temp.try_as(2, $$update public.card_tasks set created_at = now() where id = 'ta1'$$), '42501', 'nor when');
select is(pg_temp.try_as(2, $$update public.card_tasks set workspace_id = 'cty' where id = 'ta1'$$), '23514', 'nor the team');
select is(pg_temp.try_as(2, $$update public.card_tasks set id = 'other' where id = 'ta1'$$), '42501', 'nor the id');

-- Rows written with no signed-in person: what a migration running as the table owner does ---------------------------------------
select pg_temp.as_postgres();
select is((select current_user = session_user or current_user = 'postgres'), true, 'this is the table owner');
select is((select public.current_person_id()), null, 'with no signed-in person');
insert into public.card_tasks (id, workspace_id, person_id, title, due_date, due_time, assignee_id)
values ('mig-t1', 'ctw', 'ctpa', 'Book first plan', public.workspace_today('ctw') + 3, time '10:30', 'cta');
insert into public.card_tasks (id, workspace_id, entry_id, title, due_date, due_time, assignee_id, created_at, updated_at)
values ('mig-t2', 'ctw', 'cte_a', 'Book first meeting', public.workspace_today('ctw') + 2, null, 'cta', '2026-01-01 10:00+00', '2026-01-02 10:00+00');
select is((select (created_by is null, done, done_by is null, done_at is null, position, assignee_id, due_time)::text from public.card_tasks where id = 'mig-t1'),
  '(t,f,t,t,0,cta,10:30:00)', 'the owner role inserts a task on a recruiting card: created by the system (null), open, assigned to the owner');
select is((select (created_by is null, created_at = '2026-01-01 10:00+00', updated_at = '2026-01-02 10:00+00')::text from public.card_tasks where id = 'mig-t2'),
  '(t,t,t)', 'and on a customer card, keeping the created_at and updated_at it gave');
select is(pg_temp.try($$insert into public.card_tasks (id, workspace_id, person_id, title, done, done_at, done_by) values ('mig-t3', 'ctw', 'ctpb', 'Done already', true, '2026-01-01', null)$$), 'rows=1',
  'it can also give a task that is done (done_by null: nobody signed in)');
select is(pg_temp.try_as(4, $$insert into public.card_tasks (id, workspace_id, person_id, title, assignee_id) values ('mig-x1', 'ctw', 'ctpa', 'Not mine', 'cta')$$), '42501',
  'the same insert as a signed-in person who cannot edit the card (Bea, on Alex''s prospect) is refused');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (id, workspace_id, entry_id, title, assignee_id) values ('mig-x2', 'ctw', 'cte_x', 'Not mine', 'ctx')$$), '42501',
  'and on a customer card (Alex, on Xavier''s list)');
select pg_temp.as_postgres();
insert into public.card_notes (id, workspace_id, person_id, author_id, body, created_at) values ('mig-n1', 'ctw', 'ctpa', 'cta', 'Copied from the card''s old note', '2026-01-05 12:00+00');
insert into public.card_notes (id, workspace_id, entry_id, author_id, body, created_at) values ('mig-n2', 'ctw', 'cte_a', null, 'From the system', '2026-01-06 12:00+00');
insert into public.card_notes (id, workspace_id, entry_id, body) values ('mig-n3', 'ctw', 'cte_a', 'No author, now');
select is((select (author_id, created_at = '2026-01-05 12:00+00')::text from public.card_notes where id = 'mig-n1'), '(cta,t)', 'the owner role inserts a note under the card''s owner, with the date it gives');
select is((select (author_id is null, created_at = '2026-01-06 12:00+00')::text from public.card_notes where id = 'mig-n2'), '(t,t)', 'or with no author (from the system)');
select is((select (author_id is null, created_at = now())::text from public.card_notes where id = 'mig-n3'), '(t,t)', 'created_at defaults to now');
select is(pg_temp.try_as(2, $$insert into public.card_notes (id, workspace_id, person_id, author_id, body) values ('mig-x3', 'ctw', 'ctpa', 'ctl', 'In Lena''s name')$$), 'rows=1', 'a signed-in person''s insert under someone else''s name goes through...');
select pg_temp.as_login(2);
insert into public.card_notes (id, workspace_id, person_id, author_id, body, created_at) values ('mig-x4', 'ctw', 'ctpa', 'ctl', 'In Lena''s name', '2000-01-01');
select pg_temp.as_postgres();
select is((select (author_id, created_at = now())::text from public.card_notes where id = 'mig-x4'), '(cta,t)', '...but is stored under their own name and the real time');
select is(pg_temp.try_as(4, $$insert into public.card_notes (id, workspace_id, person_id, author_id, body) values ('mig-x5', 'ctw', 'ctpa', 'cta', 'Not readable')$$), '42501', 'and on a card they cannot read it is refused');
select is(pg_temp.try_as(2, $$insert into public.card_notes (id, workspace_id, entry_id, author_id, body) values ('mig-x6', 'ctw', 'cte_x', 'cta', 'Not readable')$$), '42501', 'on either board');
select pg_temp.as_postgres();
delete from public.card_tasks where id like 'mig-t%';
delete from public.card_notes where id like 'mig-n%' or id = 'mig-x4';

-- A candidate (a prospect with a login) has no access to cards, not even to the tasks of their own prospect ----------------
select pg_temp.as_postgres();
insert into public.card_tasks (id, workspace_id, person_id, title) values ('cand-t', 'ctw', 'ctpo', 'On the candidate''s prospect');
insert into public.card_notes (id, workspace_id, person_id, body) values ('cand-n', 'ctw', 'ctpo', 'A note there');
select pg_temp.as_login(7);
select is((select count(*)::int from public.card_tasks where id = 'cand-t') + (select count(*)::int from public.card_notes where id = 'cand-n'), 0,
  'Cal, a candidate, reads neither the task nor the note on his own prospect');
select is(pg_temp.try($$insert into public.card_tasks (id, person_id, title) values ('cand-x', 'ctpo', 'x')$$), '42501', 'and adds no task there');
select is(pg_temp.try($$insert into public.card_notes (id, person_id, body) values ('cand-y', 'ctpo', 'x')$$), '42501', 'and no note');
select pg_temp.as_login(1);
select is((select count(*)::int from public.card_tasks where id = 'cand-t') + (select count(*)::int from public.card_notes where id = 'cand-n'), 2, 'Lena reads both');
select pg_temp.as_postgres();
delete from public.card_tasks where id = 'cand-t';
delete from public.card_notes where id = 'cand-n';

-- The boards are untouched --------------------------------------------------------------------------------------------------------
select pg_temp.as_postgres();
select is(pg_temp.board_state(), (select v from board_before), 'the stored cards, their columns and booked next steps are byte-identical after all of it');
select is((select (next_column, next_step_date = public.workspace_today('ctw') + 3, next_step_time, note)::text from public.pipeline_cards where person_id = 'ctpa'),
          '(first_plan,t,10:30:00,"card note A")', 'a card''s booked next step reads as it was');

-- Cascades --------------------------------------------------------------------------------------------------------------------------
-- deleting a stored card row is not deleting the card: the prospect is still on the board, so the tasks stay
select pg_temp.as_postgres();
delete from public.pipeline_cards where person_id = 'ctpa';
select is((select count(*)::int from public.card_tasks where person_id = 'ctpa') > 0 and (select count(*)::int from public.card_notes where person_id = 'ctpa') > 0, true,
  'deleting the stored card row (an undo of the move that made it) leaves the prospect''s tasks and notes');
select is((select count(*)::int from public.card_tasks where person_id = 'ctpb'), 1, 'Bea''s prospect has a task');
delete from public.people where id = 'ctpb';
select is((select count(*)::int from public.card_tasks where person_id = 'ctpb') + (select count(*)::int from public.card_notes where person_id = 'ctpb'), 0,
  'deleting the prospect deletes their tasks and notes');
select is((select count(*)::int from public.card_tasks where entry_id = 'cte_b'), 1, 'Bea''s list name has a task');
delete from public.list_entries where id = 'cte_b';
select is((select count(*)::int from public.card_tasks where entry_id = 'cte_b') + (select count(*)::int from public.card_notes where entry_id = 'cte_b')
          + (select count(*)::int from public.customer_cards where entry_id = 'cte_b'), 0,
  'removing a name from a list deletes its tasks, notes and stored card');
select is((select assignee_id from public.card_tasks where id = 'tea1'), 'cta', 'Alex is the assignee of a task on his list');
delete from public.people where id = 'ctc';
select is((select count(*)::int from public.people where id = 'ctpo'), 1, 'removing Cal leaves Orla (the prospect moves under Cal''s sponsor)');
update public.card_tasks set assignee_id = 'ctn', created_by = 'ctn' where id = 'tn1';
insert into public.card_notes (id, workspace_id, person_id, author_id, body) values ('nt-ann', 'ctw', 'ctpn', 'ctn', 'Ann''s note');
delete from public.people where id = 'ctn';
select is((select (assignee_id is null, created_by is null)::text from public.card_tasks where id = 'tn1'), '(t,t)', 'removing a person unassigns their tasks and keeps them');
select is((select author_id is null from public.card_notes where id = 'nt-ann'), true, 'and keeps their notes, authorless');

select * from finish();
rollback;
