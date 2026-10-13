-- CRM write rules: visibility on writes, customer privacy, candidates,
-- stage/sponsor guards, shared costs, and the delete cascade.
begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Act as a person: gives them a local auth user (and links their member row)
-- if they have none yet, then switches to the authenticated role.
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

-- Jamal Brown (apprentice, person 4) --------------------------------------
select pg_temp.login('4');

select lives_ok($$insert into public.people (id, name, biz_class, sponsor_id) values ('t-new', 'New Prospect', 'prospect', '4')$$,
  'an apprentice adds a prospect under himself');
select is((select workspace_id from public.people where id = 't-new'), 'w1',
  'workspace_id defaults to the caller''s workspace');
select throws_ok($$insert into public.people (name, biz_class, sponsor_id) values ('X', 'prospect', '1')$$,
  '42501', null, 'nobody adds people under an upline they cannot see');
select throws_ok($$insert into public.people (name, biz_class, sponsor_id) values ('X', 'prospect', '9')$$,
  '23514', 'A sponsor must be an apprentice or IBO', 'a prospect cannot sponsor anyone');
select throws_ok($$insert into public.people (name, biz_class, owner_id) values ('X', 'customer', '2')$$,
  '42501', null, 'nobody adds a customer for an owner they cannot see');

with u as (update public.people set notes = 'x' where id = '1' returning 1)
select is(count(*)::int, 0, 'nobody edits a person outside their view') from u;
with u as (update public.people set notes = 'x' where id = 'c5' returning 1)
select is(count(*)::int, 0, 'nobody edits another person''s customer') from u;
select throws_ok($$update public.people set biz_class = 'ibo' where id = '4'$$,
  '42501', 'You cannot change your own stage or sponsor', 'nobody promotes themselves');

select throws_ok($$insert into public.contacts (person_id) values ('1')$$,
  '42501', null, 'no contacts logged about people outside your view');
select lives_ok($$insert into public.contacts (person_id, note) values ('9', 'called')$$,
  'logs a contact with his own prospect');
select is((select by_id from public.contacts where note = 'called'), '4', 'by_id defaults to the caller');
select throws_ok($$insert into public.sales (customer_id, product) values ('c5', 'XS')$$,
  '42501', null, 'no sales logged for another person''s customer');

select throws_ok($$insert into public.shared_costs (event_id, name, total) values ('e1', 'Hotel', 300)$$,
  '42501', null, 'apprentices do not organize shared costs');
select is((select amount from public.pay_sandbox('sc1')), 200.00::numeric,
  'pay_sandbox charges an even share of the van (600 / 3)');
select throws_ok($$select public.pay_sandbox('sc1')$$, '22023', 'Already paid', 'nobody pays twice');
with d as (delete from public.shared_cost_members where cost_id = 'sc1' and person_id = '4' returning 1)
select is(count(*)::int, 0, 'a member who paid cannot opt out') from d;
select pg_temp.logout();

-- Beau Foster (candidate, person 20) ------------------------------------------
select pg_temp.login('20');
select throws_ok($$insert into public.people (name, biz_class, sponsor_id) values ('X', 'prospect', '20')$$,
  '42501', null, 'candidates add nobody');
select throws_ok($$insert into public.events (name, type, date) values ('X', 'team_meeting', current_date)$$,
  '42501', null, 'candidates do not create events');
select is((select count(*)::int from public.members), 1, 'a candidate sees only his own member row');
select pg_temp.logout();

-- Anita Patel (IBO, person 2) -----------------------------------------------
select pg_temp.login('2');
select lives_ok($$insert into public.shared_costs (id, event_id, name, total) values ('sc-t', 'e1', 'Hotel', 300)$$,
  'an IBO organizes a shared cost');
select ok(exists (select 1 from public.shared_cost_members where cost_id = 'sc-t' and person_id = '2'),
  'the organizer is opted in automatically');
select lives_ok($$delete from public.people where id = '4'$$, 'Anita removes Jamal from her team');
select is((select sponsor_id from public.people where id = '9'), '2',
  'his prospects move up to his sponsor (cascade.ts)');
select is((select owner_id from public.people where id = 'c8'), '2', 'his customer moves to his sponsor');
select ok(exists (select 1 from public.activity where related_person_id = '9' and summary like 'Moved under Anita Patel%'),
  'moved people get an activity entry');
select pg_temp.logout();

select * from finish();
rollback;
