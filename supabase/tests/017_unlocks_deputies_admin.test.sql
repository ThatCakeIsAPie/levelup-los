-- Unlocks support (migration 20261014001500_unlocks_deputies_admin): the admin
-- flag, leader deputies (visibility and who manages them) and the team's
-- feature switches.
--
-- Seed facts (src/data/team/seed.ts, src/data/seed.ts): Maria (1) is the
-- leader; Marcus (6) and Admin Tester (800) are her deputies; the admin has an
-- app_admins row. Anita (2) is a moderator with Jamal (4) under her; David (3)
-- is a crossline of Anita's and Marcus's teams; Linh (5) is a prospect; c1 is
-- Maria's customer. No feature switch rows (everything off).
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

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
create function pg_temp.sees(p_person text) returns boolean language sql as $$
  select p_person in (select public.visible_person_ids())
$$;

-- Schema -------------------------------------------------------------------------
select has_table('public', 'app_admins', 'app_admins exists');
select has_table('public', 'deputies', 'deputies exists');
select has_table('public', 'feature_switches', 'feature_switches exists');

-- The admin flag: only the database sets it -----------------------------------------
select pg_temp.login('800');
select ok(public.is_app_admin(), 'the admin login is an admin');
select is((select count(*)::int from public.app_admins), 1, 'the admin reads their own flag');
select pg_temp.login('1');
select ok(not public.is_app_admin(), 'Maria (leader) is not an admin');
select is((select count(*)::int from public.app_admins), 0, 'nobody reads someone else''s admin flag');
select throws_ok($$insert into public.app_admins (user_id) values ('00000000-0000-4000-8000-000000000001')$$,
  '42501', null, 'a leader can''t make themselves admin');
select pg_temp.login('2');
select throws_ok($$insert into public.app_admins (user_id) values ('00000000-0000-4000-8000-000000000002')$$,
  '42501', null, 'a member can''t make themselves admin');
select pg_temp.login('800');
select throws_ok($$update public.app_admins set note = 'x'$$,
  '42501', null, 'not even an admin edits the flag');
select throws_ok($$delete from public.app_admins$$,
  '42501', null, 'or removes it');

-- A deputy sees what the leader sees ------------------------------------------------
select pg_temp.login('6');
select ok(pg_temp.sees('1'), 'Marcus (Maria''s deputy) sees Maria');
select ok(pg_temp.sees('4') and pg_temp.sees('700'), 'and her whole team (Jamal and Tasha under Anita)');
select is((select count(*)::int from public.people where id = 'c1'), 0,
  'but not Maria''s customers (customers stay private)');
select ok((select count(*) from public.list_entries where owner_id = '1') > 0,
  'he reads Maria''s list, like her uplines would');
select ok(public.is_upline_of('4'), 'he coaches Maria''s team');
select ok(not public.is_upline_of('1'), 'but not Maria herself');
select pg_temp.login('3');
select ok(not pg_temp.sees('1') and not pg_temp.sees('4'), 'David (no deputy) still sees only his own team');

select pg_temp.logout();
delete from public.deputies where deputy_id = '6';
select pg_temp.login('6');
select ok(not pg_temp.sees('1') and not pg_temp.sees('4'), 'without the deputy row Marcus is back to his own team');
select pg_temp.logout();
insert into public.deputies (workspace_id, leader_id, deputy_id, added_by) values ('w1', '1', '6', '1');

-- Only someone who is still a leader widens a deputy's view.
insert into public.deputies (workspace_id, leader_id, deputy_id, added_by) values ('w1', '2', '4', '2');
select pg_temp.login('4');
select ok(not pg_temp.sees('2'), 'a "deputy" of a non-leader (Anita) sees nothing more');
select pg_temp.logout();
delete from public.deputies where leader_id = '2';

-- Who manages deputies ---------------------------------------------------------------
select pg_temp.login('2');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('2', '4')$$,
  '42501', null, 'a moderator who isn''t a leader can''t name deputies');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('1', '2')$$,
  '42501', null, 'nobody names deputies for someone else');
select pg_temp.login('6');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('1', '2')$$,
  '42501', null, 'a deputy can''t name more deputies');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('6', '19')$$,
  '42501', null, 'nor become a leader of their own');
select pg_temp.login('1');
select lives_ok($$insert into public.deputies (leader_id, deputy_id, added_by) values ('1', '2', '4')$$,
  'Maria names Anita');
select is((select added_by from public.deputies where deputy_id = '2'), '1',
  'who added a deputy is stamped by the database');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('1', '5')$$,
  '42501', null, 'a prospect can''t be a deputy');
select throws_ok($$insert into public.deputies (leader_id, deputy_id) values ('1', 'c1')$$,
  '42501', null, 'nor a customer');
select throws_ok($$update public.deputies set deputy_id = '4' where deputy_id = '2'$$,
  '42501', null, 'a deputy row never changes');
select pg_temp.login('2');
select is(pg_temp.affected($$delete from public.deputies where deputy_id = '6'$$), 0,
  'Anita can''t remove Maria''s deputies');
select pg_temp.login('4');
select is((select count(*)::int from public.deputies), 0, 'Jamal reads no deputy rows');
select pg_temp.login('6');
select is((select count(*)::int from public.deputies), 1, 'a deputy reads their own row only');
select is(pg_temp.affected($$delete from public.deputies where deputy_id = '6'$$), 1,
  'a deputy may step down');
select pg_temp.login('1');
select is(pg_temp.affected($$delete from public.deputies where deputy_id = '2'$$), 1,
  'Maria removes a deputy');
select lives_ok($$insert into public.deputies (leader_id, deputy_id) values ('1', '6')$$,
  'and names Marcus again');

-- Deputies edit events on the leader's behalf -----------------------------------------
select pg_temp.login('6');
select is(pg_temp.affected($$update public.events set name = name
  where id = (select id from public.events where created_by is distinct from '6' order by id limit 1)$$), 1,
  'a deputy edits an event someone else created');
select pg_temp.login('3');
select is(pg_temp.affected($$update public.events set name = name
  where id = (select id from public.events where created_by is distinct from '3' order by id limit 1)$$), 0,
  'an IBO who isn''t a deputy, moderator or the creator doesn''t');

-- Feature switches -----------------------------------------------------------------------
-- Start from the seed's state (no rows), whatever was flipped in the app since.
select pg_temp.logout();
delete from public.feature_switches;
select pg_temp.login('4');
select is((select count(*)::int from public.feature_switches), 0, 'no switch rows: everything is off');
select throws_ok($$insert into public.feature_switches (feature, enabled) values ('chats', true)$$,
  '42501', null, 'a member can''t switch a feature on');
select pg_temp.login('2');
select throws_ok($$insert into public.feature_switches (feature, enabled) values ('chats', true)$$,
  '42501', null, 'nor can a moderator');
select pg_temp.login('1');
select lives_ok($$insert into public.feature_switches (feature, enabled, updated_by) values ('library', true, '4')$$,
  'Maria switches the library on for the team');
select is((select updated_by from public.feature_switches where feature = 'library'), '1',
  'who flipped it is stamped');
select throws_ok($$insert into public.feature_switches (feature, enabled) values ('wallet', false)$$,
  '23514', null, 'only the phase 2/3 features have switches');
select pg_temp.login('6');
select is(pg_temp.affected($$update public.feature_switches set enabled = false where feature = 'library'$$), 1,
  'her deputy switches it off again');
select pg_temp.login('4');
select is((select enabled::text || ':' || updated_by from public.feature_switches where feature = 'library'),
  'false:6', 'everyone on the team reads the switch and who flipped it');
select is(pg_temp.affected($$update public.feature_switches set enabled = true$$), 0,
  'and a member can''t flip it');

select pg_temp.logout();
select * from finish();
rollback;
