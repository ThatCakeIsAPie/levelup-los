-- Growth path (migration 20261014000100_growth_path): PV on sales and whose PV
-- it is, who reads sales, monthly PV set by uplines, milestones marked by hand.
--
-- Seed facts (src/data/seed.ts): Tasha (700) is Jamal's (4) new apprentice;
-- her customer is c11 and her sales are sg1 (to c11) and sg2 (a personal
-- order). sg8 is a personal order of 201 (Jamal's frontline). Last month's PV
-- was set for 2, 17, 301, 701, 4, 203 and 201. Maria (1) has hand marks up to
-- Ruby, Anita (2) up to Bronze builder (marked by Maria). David (3) is a
-- crossline of Anita's team; Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

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
create function pg_temp.this_month() returns text language sql as $$
  select to_char(current_date, 'YYYY-MM')
$$;

-- Schema -------------------------------------------------------------------------
select has_column('public', 'sales', 'pv', 'sales have a PV');
select has_column('public', 'sales', 'person_id', 'sales say whose PV they count toward');
select has_table('public', 'pv_overrides', 'pv_overrides exists');
select has_table('public', 'milestone_marks', 'milestone_marks exists');
select is((select count(*)::int from public.sales where person_id is null), 0,
  'every seeded sale counts toward someone');

-- Sale attribution ----------------------------------------------------------------
select pg_temp.login('1');
insert into public.sales (id, customer_id, product, pv) values ('t-sale-1', 'c1', 'Test', 10);
select is((select person_id from public.sales where id = 't-sale-1'), '1',
  'a sale counts toward the customer''s owner when the app leaves it out');
insert into public.sales (id, customer_id, product, pv) values ('t-sale-2', '1', 'Personal order', 40);
select is((select person_id from public.sales where id = 't-sale-2'), '1',
  'a personal order counts toward the buyer');
select throws_ok($$insert into public.sales (customer_id, product, pv, person_id) values ('c1', 'Test', 5, '2')$$,
  '23514', null, 'a sale can''t be credited to someone else');
select throws_ok($$update public.sales set person_id = '3' where id = 't-sale-1'$$,
  '23514', null, 'nor moved to someone else later');
select is(pg_temp.affected($$update public.sales set pv = 12 where id = 't-sale-1'$$), 1,
  'the owner edits the PV of their sale');
select pg_temp.logout();

-- Who reads sales -----------------------------------------------------------------
select pg_temp.login('2');
select ok(exists (select 1 from public.sales where id = 'sg1'),
  'Anita reads the sale that counts toward Tasha (her downline)');
select is((select count(*)::int from public.people where id = 'c11'), 0,
  'but not Tasha''s customer');
select ok(exists (select 1 from public.sales where id = 'sg8'), 'and a downline''s personal order');
select is(pg_temp.affected($$update public.sales set pv = 1 where id = 'sg1'$$), 0,
  'she can''t edit a sale of a customer she can''t see');
select is(pg_temp.affected($$delete from public.sales where id = 'sg1'$$), 0,
  'or delete it');
select is(pg_temp.affected($$insert into public.sales (id, customer_id, product, pv) values ('t-sale-3', '4', 'Jamal''s order', 30)$$), 1,
  'an upline can log a downline''s personal order');
select is((select person_id from public.sales where id = 't-sale-3'), '4', 'it counts toward them');
select pg_temp.logout();

select pg_temp.login('3');
select is((select count(*)::int from public.sales where id in ('sg1', 'sg2', 'sg8', 'sg9')), 0,
  'a crossline reads none of Anita''s team''s sales');
select pg_temp.logout();

-- Monthly PV set by uplines ----------------------------------------------------------
select pg_temp.login('4');
select is((select count(*)::int from public.pv_overrides where person_id in ('4', '201', '203')), 3,
  'Jamal reads his own and his team''s monthly PV');
select is((select count(*)::int from public.pv_overrides where person_id in ('2', '17', '301')), 0,
  'not his upline''s or a crossline''s');
select throws_ok(format($$insert into public.pv_overrides (person_id, month, pv) values ('4', %L, 500)$$, pg_temp.this_month()),
  '42501', null, 'nobody sets their own PV');
select throws_ok(format($$insert into public.pv_overrides (person_id, month, pv) values ('2', %L, 500)$$, pg_temp.this_month()),
  '42501', null, 'or their upline''s');
select throws_ok(format($$insert into public.pv_overrides (person_id, month, pv) values ('c8', %L, 500)$$, pg_temp.this_month()),
  '42501', null, 'or a customer''s');
insert into public.pv_overrides (person_id, month, pv, set_by, set_at)
  values ('700', pg_temp.this_month(), 150, '1', '2020-01-01');
select is((select set_by from public.pv_overrides where person_id = '700'), '4',
  'an upline sets a downline''s month; who set it is recorded (not what the app claims)');
select ok((select set_at > now() - interval '1 minute' from public.pv_overrides where person_id = '700'),
  'and when');
select throws_ok(format($$insert into public.pv_overrides (person_id, month, pv) values ('700', %L, -1)$$, '2026-02'),
  '23514', null, 'PV can''t be negative');
select throws_ok($$insert into public.pv_overrides (person_id, month, pv) values ('700', '2026-13', 1)$$,
  '23514', null, 'the month is a real "YYYY-MM"');
select throws_ok($$update public.pv_overrides set month = '2020-01' where person_id = '700'$$,
  '42501', null, 'a month''s PV can''t move to another month');
select pg_temp.logout();

select pg_temp.login('2');
select is(pg_temp.affected($$update public.pv_overrides set pv = 160 where person_id = '700'$$), 1,
  'any upline can change it');
select is((select set_by from public.pv_overrides where person_id = '700'), '2', 'and the change is recorded');
select pg_temp.logout();

select pg_temp.login('700');
select is((select pv::int from public.pv_overrides where person_id = '700'), 160,
  'Tasha reads the PV her upline set');
select is(pg_temp.affected($$delete from public.pv_overrides where person_id = '700'$$), 0,
  'but can''t remove it');
select pg_temp.logout();

select pg_temp.login('20');
select is((select count(*)::int from public.pv_overrides), 0, 'a candidate reads none');
select throws_ok(format($$insert into public.pv_overrides (person_id, month, pv) values ('20', %L, 1)$$, pg_temp.this_month()),
  '42501', null, 'and sets none');
select pg_temp.logout();

-- Milestones marked by hand ------------------------------------------------------------
select pg_temp.login('1');
insert into public.milestone_marks (person_id, code, reached_on) values ('2', '6_25', current_date - 3);
select is((select marked_by from public.milestone_marks where person_id = '2' and code = '6_25'), '1',
  'an upline marks a milestone; who marked it is recorded');
select throws_ok($$insert into public.milestone_marks (person_id, code, reached_on) values ('2', '6_50', current_date + 10)$$,
  '23514', null, 'not in the future');
select throws_ok($$insert into public.milestone_marks (person_id, code, reached_on) values ('2', 'diamond', current_date)$$,
  '23514', null, 'only known milestones');
select throws_ok($$insert into public.milestone_marks (person_id, code, reached_on) values ('1', 'ruby', current_date)$$,
  '42501', null, 'nobody marks their own');
select pg_temp.logout();

select pg_temp.login('2');
select is((select count(*)::int from public.milestone_marks where person_id = '2'), 7,
  'Anita reads her own marks');
select is(pg_temp.affected($$delete from public.milestone_marks where person_id = '2'$$), 0,
  'but can''t remove them');
select pg_temp.logout();

select pg_temp.login('3');
select is((select count(*)::int from public.milestone_marks where person_id in ('1', '2')), 0,
  'a crossline (and a downline) don''t read them');
select pg_temp.logout();

select * from finish();
rollback;
