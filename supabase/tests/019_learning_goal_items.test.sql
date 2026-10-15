-- The weekly goal as a list (migration 20261014004000_learning_goal_items):
-- learning_goals.items is null (the old columns) or an array of
-- {kind, target, unit?}, kinds unique, whole targets of at least 1, units only
-- for reading and podcasts. Row-level security is unchanged.
--
-- Seed facts (src/data/seed.ts seedLearningGoals): Maria (1) has Reading 120
-- minutes, Contacts 15, First meetings 5; Anita (2) Reading 70 pages, Podcasts
-- 5, Workshops 1. Jamal (4) is under Anita (2) under Maria (1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
-- Set Anita's items (as the current user).
create function pg_temp.set_items(p_items text) returns void language plpgsql as $$
begin
  execute format('update public.learning_goals set items = %L::jsonb where person_id = %L', p_items, '2');
end $$;

-- The column and the seed ------------------------------------------------------
select has_column('public', 'learning_goals', 'items', 'learning_goals has items');
select col_type_is('public', 'learning_goals', 'items', 'jsonb', 'items is jsonb');
select col_is_null('public', 'learning_goals', 'items', 'items may be null (goals from before lists)');
select is(
  (select jsonb_agg(i ->> 'kind') from public.learning_goals g, jsonb_array_elements(g.items) i
    where g.person_id = '1'),
  '["reading", "contacts", "first_meetings"]'::jsonb,
  'Maria''s seeded goal keeps its order');
select is(
  (select array[pages, podcasts, workshops] from public.learning_goals where person_id = '1'),
  array[120, 0, 0],
  'and the old columns are in step (0 for what her goal doesn''t have)');

-- Shapes the owner may save ----------------------------------------------------
select pg_temp.login('2');
select lives_ok($$select pg_temp.set_items(
  '[{"kind":"reading","target":30,"unit":"minutes"},{"kind":"contacts","target":10},{"kind":"pv","target":150}]')$$,
  'a list with a unit on reading and none elsewhere');
select lives_ok($$select pg_temp.set_items('[{"kind":"podcasts","target":2,"unit":"episodes"},{"kind":"workshops","target":1,"unit":null}]')$$,
  'a null unit is the same as none');
select lives_ok($$select pg_temp.set_items('[]')$$, 'an empty goal');
select lives_ok($$update public.learning_goals set items = null where person_id = '2'$$,
  'no list (the old columns count)');
select lives_ok($$select pg_temp.set_items('[{"kind":"future_kind","target":5}]')$$,
  'a kind the app adds later needs no migration');

-- Shapes that are refused ------------------------------------------------------
select throws_ok($$select pg_temp.set_items('{"kind":"reading","target":60}')$$, '23514', null,
  'not an array');
select throws_ok($$select pg_temp.set_items('["reading"]')$$, '23514', null,
  'items are objects');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts","target":5},{"kind":"contacts","target":8}]')$$,
  '23514', null, 'a kind at most once');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts","target":0}]')$$, '23514', null,
  'targets are at least 1');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts","target":2.5}]')$$, '23514', null,
  'targets are whole numbers');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts","target":"10"}]')$$, '23514', null,
  'targets are numbers');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts"}]')$$, '23514', null,
  'a target is required');
select throws_ok($$select pg_temp.set_items('[{"kind":"Reading!","target":3}]')$$, '23514', null,
  'kinds are lower_snake_case names');
select throws_ok($$select pg_temp.set_items('[{"kind":"reading","target":3,"unit":"episodes"}]')$$,
  '23514', null, 'reading isn''t counted in episodes');
select throws_ok($$select pg_temp.set_items('[{"kind":"contacts","target":3,"unit":"minutes"}]')$$,
  '23514', null, 'other kinds have no unit');
select throws_ok($$select pg_temp.set_items('[{"kind":"pv","target":150,"note":"hi"}]')$$, '23514', null,
  'no other keys');

-- Row-level security is unchanged ----------------------------------------------
select pg_temp.login('4');
select is(pg_temp.affected($$update public.learning_goals set items = '[]' where person_id = '1'$$), 0,
  'Jamal can''t change Maria''s goal (she isn''t in his view)');

select * from finish();
rollback;
