-- Milestone history (migration 20261014010000_milestone_history): the first
-- day a count milestone was reached and the last day it was seen met, which
-- the app records for a person and the team they coach.
--
-- Seed facts (src/data/seed.ts): no history rows are seeded (the app records
-- them as people use it). Maria (1) is at the top; Anita (2) is hers; Jamal
-- (4) is Anita's; Tasha (700) is Jamal's. David (3) is a crossline of Anita's
-- team; Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

select has_table('public', 'milestone_history', 'milestone_history exists');
select has_column('public', 'milestone_history', 'last_met_on', 'it keeps the last day seen met');
-- The app records rows while people use it; start these people clean (rolled back).
delete from public.milestone_history where person_id in ('4', '700');

-- The person records their own; who and when are stamped ---------------------------
select pg_temp.login('4');
insert into public.milestone_history (person_id, code, first_reached_on, last_met_on, recorded_by, recorded_at)
  values ('4', 'first_sponsor', current_date - 12, current_date - 1, '1', '2020-01-01');
select is((select recorded_by from public.milestone_history where person_id = '4'), '4',
  'a person records their own history; who recorded it is stamped (not what the app claims)');
select ok((select recorded_at > now() - interval '1 minute' from public.milestone_history where person_id = '4'),
  'and when');

-- Upserts merge: the first day only moves earlier, the last day only later --------
insert into public.milestone_history (person_id, code, first_reached_on, last_met_on)
  values ('4', 'first_sponsor', current_date - 5, current_date)
  on conflict (person_id, code) do update
    set first_reached_on = excluded.first_reached_on, last_met_on = excluded.last_met_on;
select is((select first_reached_on from public.milestone_history where person_id = '4'), current_date - 12,
  'a later first day doesn''t replace an earlier one');
select is((select last_met_on from public.milestone_history where person_id = '4'), current_date,
  'a later last day does');
select is(pg_temp.affected($$update public.milestone_history set last_met_on = current_date - 30 where person_id = '4'$$), 1,
  'an earlier last day is accepted but kept as the later one');
select is((select last_met_on from public.milestone_history where person_id = '4'), current_date,
  'so the last day never moves back');
select is(pg_temp.affected($$update public.milestone_history set first_reached_on = current_date - 40 where person_id = '4'$$), 1,
  'an earlier first day moves it back');
select is((select first_reached_on from public.milestone_history where person_id = '4'), current_date - 40,
  'to that day');
select throws_ok($$insert into public.milestone_history (person_id, code, first_reached_on, last_met_on) values ('4', '3_10', current_date + 10, current_date + 10)$$,
  '23514', null, 'not in the future');
select throws_ok($$insert into public.milestone_history (person_id, code, first_reached_on, last_met_on) values ('4', 'diamond', current_date, current_date)$$,
  '23514', null, 'only known milestones');
select throws_ok($$update public.milestone_history set code = '3_10' where person_id = '4'$$,
  '42501', null, 'a row can''t move to another milestone');

-- Uplines record for their team; nobody else -----------------------------------------
insert into public.milestone_history (person_id, code, first_reached_on, last_met_on)
  values ('700', 'first_sponsor', current_date - 3, current_date - 3);
select is((select recorded_by from public.milestone_history where person_id = '700'), '4',
  'an upline records a downline''s history');
select throws_ok($$insert into public.milestone_history (person_id, code, first_reached_on, last_met_on) values ('2', '3_10', current_date, current_date)$$,
  '42501', null, 'but not their upline''s');
select is(pg_temp.affected($$delete from public.milestone_history where person_id = '4'$$), 0,
  'and nobody deletes history');
select pg_temp.logout();

select pg_temp.login('3');
select is((select count(*)::int from public.milestone_history where person_id in ('4', '700')), 0,
  'a crossline doesn''t read it');
select throws_ok($$insert into public.milestone_history (person_id, code, first_reached_on, last_met_on) values ('4', '3_10', current_date, current_date)$$,
  '42501', null, 'or write it');
select pg_temp.logout();

select pg_temp.login('20');
select throws_ok($$insert into public.milestone_history (person_id, code, first_reached_on, last_met_on) values ('20', 'first_sponsor', current_date, current_date)$$,
  '42501', null, 'a candidate records nothing');
select pg_temp.logout();

select * from finish();
rollback;
