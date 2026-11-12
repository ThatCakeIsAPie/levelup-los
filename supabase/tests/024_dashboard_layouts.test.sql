-- Home's card layout (migration 20261016001000_dashboard_layouts): one row per
-- person, only they read or write it, and the layout's shape is checked.
--
-- Seed facts: no layouts are seeded. Jamal (4) is Anita's (2); Maria (1) is at
-- the top; Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

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

select has_table('public', 'dashboard_layouts', 'dashboard_layouts exists');
select columns_are('public', 'dashboard_layouts', array['person_id', 'workspace_id', 'layout', 'updated_at'],
  'one layout per person, with when it changed');
-- Layouts made while using the app: start these people clean (rolled back).
delete from public.dashboard_layouts where person_id in ('1', '2', '4', '20');

-- Your own layout ---------------------------------------------------------------------
select pg_temp.login('4');
insert into public.dashboard_layouts (layout)
  values ('{"order": ["today", "team", "myDay"], "side": ["team"]}');
select is((select person_id from public.dashboard_layouts), '4',
  'a person saves their own layout (it is theirs by default)');
select is((select layout from public.dashboard_layouts where person_id = '4'),
  '{"order": ["today", "team", "myDay"], "side": ["team"]}'::jsonb, 'as given');
update public.dashboard_layouts set updated_at = '2020-01-01' where person_id = '4';
select ok((select updated_at > now() - interval '1 minute' from public.dashboard_layouts where person_id = '4'),
  'an update stamps when it changed');
insert into public.dashboard_layouts (person_id, layout)
  values ('4', '{"order": ["team", "today"], "side": []}')
  on conflict (person_id) do update set layout = excluded.layout;
select is((select layout -> 'order' from public.dashboard_layouts where person_id = '4'),
  '["team", "today"]'::jsonb, 'saving again (upsert) replaces it');
select ok(pg_temp.affected($$update public.dashboard_layouts set layout = '{"order": ["aNewCard_2"]}' where person_id = '4'$$) = 1,
  'unknown card ids are fine (a newer app), and "side" may be left out');

-- The shape is checked ------------------------------------------------------------------
select throws_ok($$update public.dashboard_layouts set layout = '{"order": ["today"], "extra": 1}' where person_id = '4'$$,
  '23514', null, 'only "order" and "side"');
select throws_ok($$update public.dashboard_layouts set layout = '{"order": "today"}' where person_id = '4'$$,
  '23514', null, 'lists only');
select throws_ok($$update public.dashboard_layouts set layout = '{"order": ["today", "today"]}' where person_id = '4'$$,
  '23514', null, 'no card twice');
select throws_ok($$update public.dashboard_layouts set layout = '{"order": ["<script>"]}' where person_id = '4'$$,
  '23514', null, 'card ids are plain names');
select throws_ok($$update public.dashboard_layouts set layout = '[]' where person_id = '4'$$,
  '23514', null, 'an object');

-- Nobody else's ---------------------------------------------------------------------------
select throws_ok($$insert into public.dashboard_layouts (person_id, layout) values ('1', '{"order": []}')$$,
  '42501', null, 'not even an upline''s');
select is(pg_temp.affected($$delete from public.dashboard_layouts where person_id = '4'$$), 1,
  '"Reset layout" deletes your own row');
select pg_temp.logout();

-- An upline doesn't see or change a downline's layout.
select pg_temp.login('4');
insert into public.dashboard_layouts (layout) values ('{"order": ["today"]}');
select pg_temp.logout();
select pg_temp.login('2');
select is((select count(*)::int from public.dashboard_layouts where person_id = '4'), 0,
  'an upline doesn''t read a downline''s layout');
select is(pg_temp.affected($$update public.dashboard_layouts set layout = '{"order": []}' where person_id = '4'$$), 0,
  'or change it');
select pg_temp.logout();

-- Candidates have a Home too.
select pg_temp.login('20');
insert into public.dashboard_layouts (layout) values ('{"order": ["path", "today"]}');
select is((select count(*)::int from public.dashboard_layouts), 1, 'a candidate keeps their own layout');
select pg_temp.logout();

select * from finish();
rollback;
