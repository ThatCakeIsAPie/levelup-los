-- Referral source and "Referred by" (migrations 20261016001500_referral_source
-- and 20261016001600_referred_by): the fixed outcome column on both boards
-- through the move RPCs, undo, the board order, the names steps can't take;
-- the referred_by links: one at a time, never yourself, the referrer visible
-- to the writer (checked only when the link changes), cleared when the
-- referrer goes.
--
-- Seed facts (src/data/seed.ts, src/data/pipeline/seed.ts,
-- src/data/customerPipeline/seed.ts): Carlos (9) and Andre (21) are Jamal's
-- prospects; Carlos's card is in first_plan with First plan's next step (F1)
-- booked. Jamal (4) is under Anita (2) under Maria (1); David (3) is Anita's
-- crossline. le-4-1..3 are names on Jamal's list, le-3-1 on David's; c8 is
-- Jamal's customer (private: Anita doesn't see it).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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
-- Rows a statement changed, as the current user (row-level security applies).
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- The column ------------------------------------------------------------------
select pg_temp.login('4');
select is((select c.next_column from public.pipeline_cards c where c.person_id = '9'), 's-f1',
  'Carlos has a step booked');
select is(public.move_pipeline_card('9', 'referral_source', 'mv-ref-1')->'move'->>'milestone', 'out',
  'Referral source is an outcome on the recruiting board');
select is((select c.column_id from public.pipeline_cards c where c.person_id = '9'), 'referral_source',
  'the card is in Referral source');
select is((select c.next_column from public.pipeline_cards c where c.person_id = '9'), null,
  'moving to an outcome clears the booking, like the other outcomes');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-ref-1'$$), 1,
  'the move can be undone');
select is((select c.column_id || ' ' || c.next_column from public.pipeline_cards c where c.person_id = '9'),
  'first_plan s-f1', 'the card and its booking come back');
select is(public.move_customer_card('le-4-1', 'referral_source', 'cmv-ref-1')->'move'->>'band', 'out',
  'Referral source is an outcome on the customer board too');
select is(public.move_customer_card('le-4-1', 'contact', 'cmv-ref-2')->'move'->>'from_column',
  'referral_source', 'and a card moves on from it');
select is(public.pipeline_milestone_index('out'), null, 'outcomes reach no milestone, so counts are unchanged');
select is(array(select c.id from public.board_columns('customer', '4') c where c.band = 'out' order by c.ord),
  array['referral_source', 'not_interested', 'do_not_contact'],
  'Referral source comes first in the outcomes');
select is((select c.kind from public.board_columns('recruiting', '4') c where c.id = 'referral_source'),
  'fixed', 'it is a fixed column on the recruiting board');

-- Steps can't take it ---------------------------------------------------------
select pg_temp.login('1');
select throws_ok($$insert into public.pipeline_steps (band, label) values ('contact', 'Referral source')$$,
  '23514', null, 'a recruiting step can''t take its name');
select throws_ok($$insert into public.customer_steps (band, label) values ('contact', 'referral source')$$,
  '23514', null, 'nor a customer step');
select throws_ok($$insert into public.customer_steps (id, band, label) values ('referral_source', 'contact', 'Fake')$$,
  '23514', null, 'nor its id');

-- Referred by -----------------------------------------------------------------
select pg_temp.login('4');
select is(pg_temp.affected($$update public.people set referred_by = '21' where id = '9'$$), 1,
  'Jamal records that Andre referred Carlos');
select is(pg_temp.affected($$update public.list_entries set referred_by_entry = 'le-4-1' where id = 'le-4-2'$$), 1,
  'a name can be referred by another name on the list');
select is(pg_temp.affected($$update public.list_entries set referred_by = 'c8' where id = 'le-4-3'$$), 1,
  'or by his own customer');
select is(pg_temp.affected($$insert into public.people (id, name, biz_class, sponsor_id, referred_by) values ('ref-p1', 'Nell Ivers', 'prospect', '4', '9')$$), 1,
  'a new prospect can come with who referred them');
select throws_ok($$update public.people set referred_by = '1' where id = '21'$$, '42501', null,
  'the referrer must be someone you can see (not Jamal''s upline)');
select throws_ok($$update public.people set referred_by_entry = 'le-3-1' where id = '21'$$, '42501', null,
  'nor a name on a crossline''s list');
select throws_ok($$update public.people set referred_by = '21', referred_by_entry = 'le-4-1' where id = '200'$$,
  '23514', null, 'one referrer at a time');
select throws_ok($$update public.people set referred_by = id where id = '200'$$, '23514', null,
  'nobody refers themselves');
select throws_ok($$update public.list_entries set referred_by_entry = id where id = 'le-4-1'$$, '23514', null,
  'not even a name on a list');

select pg_temp.login('2');
select is((select referred_by from public.people where id = '9'), '21', 'his upline reads the link');
select is(pg_temp.affected($$update public.list_entries set notes = 'Met at the gym' where id = 'le-4-3'$$), 1,
  'and edits the name although she can''t see the customer who referred it');
select throws_ok($$update public.list_entries set referred_by = 'c8' where id = 'le-4-2'$$, '42501', null,
  'but she can''t name that customer herself');

select pg_temp.login('3');
select is(pg_temp.affected($$update public.people set referred_by = null where id = '9'$$), 0,
  'a crossline can''t touch the link');

-- The referrer goes -----------------------------------------------------------
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.list_entries where id = 'le-4-1'$$), 1,
  'Jamal removes the name that referred another');
select is((select referred_by_entry from public.list_entries where id = 'le-4-2'), null,
  'the referred name stays, without the link');
select is((select referred_by from public.people where id = 'ref-p1'), '9',
  'other links stay');

select * from finish();
rollback;
