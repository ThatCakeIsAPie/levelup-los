-- Your list and the customer pipeline (migration 20261014000500_customer_pipeline):
-- who reads and writes lists, cards and moves (the recruiting pipeline's
-- rules), move_customer_card() making a customer at First sale and marking
-- On Ditto, undo, inherited steps and their locks.
--
-- Seed facts (src/data/customerPipeline/seed.ts): Maria (1) owns the steps
-- cs-sampled (Contact band), cs-pm2 (First meeting) and cs-sbox (First
-- sale). Lists: le-1-* Maria, le-2-* Anita, le-3-* David, le-4-* Jamal,
-- le-6-* Marcus, le-700-* Tasha (apprentice under Jamal). le-700-1 Dana Lewis
-- and le-700-2 Chris Mora are not contacted yet (no card); le-700-20 Lena
-- Duarte is at First sale, linked to Tasha's customer c11; le-1-24 Jay
-- Holloway sits in cs-pm2; le-3-1 Carmen Diaz is David's (a crossline to
-- Anita and Jamal). Jamal (4) is under Anita (2) under Maria (1); Beau (20) is
-- a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

create function pg_temp.login(p_person text) returns void language plpgsql as $$
declare
  v_uid uuid := ('00000000-0000-4000-8000-' || lpad(p_person, 12, '0'))::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'person' || p_person || '@levelup.test')
  on conflict (id) do nothing;
  update public.members set user_id = v_uid where person_id = p_person and user_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-8000-' || lpad(p_person, 12, '0'), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
-- Rows a statement changed, as the current user (row-level security applies).
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.card_column(p_entry text) returns text language sql as $$
  select column_id from public.customer_cards where entry_id = p_entry
$$;

-- Schema and seed ---------------------------------------------------------------
select has_table('public', 'list_entries', 'list_entries exists');
select has_table('public', 'customer_steps', 'customer_steps exists');
select has_table('public', 'customer_step_hides', 'customer_step_hides exists');
select has_table('public', 'customer_cards', 'customer_cards exists');
select has_table('public', 'customer_moves', 'customer_moves exists');
select has_column('public', 'people', 'ditto_since', 'people.ditto_since exists');
select is((select name from public.list_entries where id = 'le-700-1'), 'Dana Lewis', 'seed: Tasha''s first name');
select is((select customer_id from public.list_entries where id = 'le-700-20'), 'c11',
  'seed: Lena Duarte is Tasha''s customer');

-- Visibility: Jamal sees his list and Tasha's, never his upline's or a crossline's ---
select pg_temp.login('4');
select is(array(select distinct owner_id from public.list_entries where id like 'le-%' order by 1),
  array['4', '700'], 'Jamal reads his own list and his downline''s');
select is((select count(*)::int from public.customer_steps), 3,
  'Jamal inherits Maria''s three customer steps');
select is(pg_temp.card_column('le-700-20'), 'first_sale', 'Jamal sees Tasha''s cards');
select is(pg_temp.card_column('le-1-24'), null, 'not his upline''s cards');
select is((select count(*)::int from public.customer_moves where owner_id not in ('4', '700')), 0,
  'only moves of his team''s lists');
select is((select count(*)::int from public.people where id = 'c11'), 0,
  'the name is visible, the customer record stays private to Tasha');

-- Lists: the owner and their uplines write; not crosslines, not prospects' lists ---
select lives_ok($$insert into public.list_entries (id, owner_id, name, how_known)
  values ('le-test-1', '700', 'Test Friend', 'Gym')$$, 'Jamal adds a name to Tasha''s list');
select is((select added_by from public.list_entries where id = 'le-test-1'), '4',
  'the name shows who added it');
select throws_ok($$insert into public.list_entries (owner_id, name) values ('3', 'Sneaky')$$,
  '42501', null, 'not to a crossline''s list');
select throws_ok($$insert into public.list_entries (owner_id, name) values ('1', 'Sneaky')$$,
  '42501', null, 'not to his upline''s list');
select throws_ok($$insert into public.list_entries (owner_id, name) values ('9', 'Sneaky')$$,
  '42501', null, 'prospects have no list');
select throws_ok($$insert into public.list_entries (owner_id, name, customer_id) values ('4', 'Sneaky', 'c8')$$,
  '42501', null, 'a customer link is never written by the app');
select throws_ok($$insert into public.list_entries (owner_id, name) values ('4', '  ')$$,
  '23514', null, 'a name is needed');
select is(pg_temp.affected($$update public.list_entries set rating = 'hot' where id = 'le-700-1'$$), 1,
  'Jamal edits a name on Tasha''s list');
select throws_ok($$update public.list_entries set owner_id = '4' where id = 'le-700-1'$$,
  '42501', null, 'a name never moves to another list');
select throws_ok($$update public.list_entries set customer_id = 'c8' where id = 'le-700-1'$$,
  '42501', null, 'nor gets a customer by hand');

-- Cards and moves only through move_customer_card() ---------------------------------
select throws_ok($$insert into public.customer_moves (entry_id, owner_id, to_column, band)
  values ('le-700-1', '700', 'on_ditto', 'on_ditto')$$, '42501', null, 'nobody writes a move directly');
select throws_ok($$insert into public.customer_cards (entry_id, column_id) values ('le-700-1', 'contact')$$,
  '42501', null, 'a new card starts in Not contacted yet');
select throws_ok($$update public.customer_cards set column_id = 'on_ditto' where entry_id = 'le-700-20'$$,
  '42501', null, 'a card''s column changes only through a move');
select lives_ok($$update public.customer_cards set note = 'Offer Ditto' where entry_id = 'le-700-20'$$,
  'the note is edited directly');
select throws_ok($$select public.move_customer_card('le-700-1', 'not_contacted')$$, '22023', null,
  'already there (a name without a card is in Not contacted yet)');
select throws_ok($$select public.move_customer_card('le-700-1', 'cs-nowhere')$$, '22023', null,
  'unknown columns are refused');
select throws_ok($$select public.move_customer_card('le-3-1', 'contact')$$, 'P0002', null,
  'a crossline''s names can''t be moved');

select lives_ok($$select public.move_customer_card('le-700-1', 'cs-sampled', 'cm-test-1')$$,
  'Jamal moves Tasha''s name to an inherited step');
select is(pg_temp.card_column('le-700-1'), 'cs-sampled', 'the card is in the step');
select is((select row(from_column, band, owner_id, moved_by)::text from public.customer_moves where id = 'cm-test-1'),
  row(null::text, 'contact', '700', '4')::text, 'the move is recorded under Tasha''s list, by Jamal');

-- First sale makes a customer of the list's owner -------------------------------------
select lives_ok($$select public.move_customer_card('le-700-2', 'first_sale', 'cm-test-2', 'cust-test')$$,
  'straight to First sale');
select is((select customer_id from public.list_entries where id = 'le-700-2'), 'cust-test',
  'the name is linked to its new customer');
select is((select count(*)::int from public.people where id = 'cust-test'), 0,
  'the customer is Tasha''s (private), so Jamal doesn''t read it');
select is((select created_customer_id from public.customer_moves where id = 'cm-test-2'), 'cust-test',
  'the move remembers the customer it made');
select pg_temp.logout();
select is((select row(biz_class, owner_id, name)::text from public.people where id = 'cust-test'),
  row('customer', '700', 'Chris Mora')::text, 'a customer owned by Tasha, with the name''s details');
select is((select count(*)::int from public.activity where related_person_id = 'cust-test' and kind = 'created'), 1,
  'the new customer is in the activity timeline');

select pg_temp.login('4');
select lives_ok($$select public.move_customer_card('le-700-2', 'on_ditto', 'cm-test-3')$$, 'then On Ditto');
select pg_temp.logout();
select ok((select ditto_since is not null from public.people where id = 'cust-test'), 'marked on Ditto');
select ok((select set_ditto from public.customer_moves where id = 'cm-test-3'), 'the move remembers it');

-- Undo: only your own latest move, within the hour ---------------------------------------
select pg_temp.login('2');
select is(pg_temp.affected($$delete from public.customer_moves where id = 'cm-test-3'$$), 0,
  'Anita can''t undo Jamal''s move');
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.customer_moves where id = 'cm-test-2'$$), 0,
  'only the latest move of a name can be undone');
select is(pg_temp.affected($$delete from public.customer_moves where id = 'cm-test-3'$$), 1,
  'Jamal undoes his On Ditto move');
select is(pg_temp.card_column('le-700-2'), 'first_sale', 'the card goes back');
select pg_temp.logout();
select is((select ditto_since from public.people where id = 'cust-test'), null, 'and Ditto is cleared');
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.customer_moves where id = 'cm-test-2'$$), 1,
  'then the first sale');
select is(pg_temp.card_column('le-700-2'), null, 'the name is back on the list (no card)');
select is((select customer_id from public.list_entries where id = 'le-700-2'), null, 'with no customer link');
select pg_temp.logout();
select is((select count(*)::int from public.people where id = 'cust-test'), 0, 'the customer it made is gone');

-- Steps: inherited and hidden like recruiting steps; milestones are locked -----------------
select pg_temp.login('4');
select lives_ok($$insert into public.customer_step_hides (step_id) values ('cs-sampled')$$,
  'Jamal hides an upline''s step for his team');
select throws_ok($$insert into public.customer_steps (band, label) values ('first_sale', 'On Ditto')$$,
  '23514', null, 'a step can''t take a milestone''s name');
select throws_ok($$insert into public.customer_steps (band, label) values ('on_ditto', 'After')$$,
  '23514', null, 'nothing comes after On Ditto');
select is(pg_temp.affected($$update public.customer_steps set label = 'Renamed' where id = 'cs-pm2'$$), 0,
  'nobody renames an upline''s step');
select pg_temp.login('1');
select lives_ok($$delete from public.customer_steps where id = 'cs-pm2'$$, 'Maria deletes her step');
select is(pg_temp.card_column('le-1-24'), 'first_meeting', 'its cards go back to the milestone');

-- Candidates have no list -------------------------------------------------------------
select pg_temp.login('20');
select is((select count(*)::int from public.list_entries) + (select count(*)::int from public.customer_cards)
  + (select count(*)::int from public.customer_moves) + (select count(*)::int from public.customer_steps), 0,
  'Beau reads no lists, cards, moves or steps');
select throws_ok($$select public.move_customer_card('le-700-1', 'contact')$$, '42501', null,
  'and can''t move anything');
select pg_temp.logout();

select * from finish();
rollback;
