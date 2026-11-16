-- Hiding Home's cards (migration 20261111000100_dashboard_layout_hidden): the
-- layout may carry a third list, "hidden"; layouts saved before it stay valid;
-- anything else is still refused; and only the person reads or writes their
-- own row.
--
-- Seed facts: no layouts are seeded. Jamal (4) is Anita's (2); Maria (1) is at
-- the top.
begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

create function pg_temp.login(p_person text) returns void language plpgsql as $$
declare
  v_uid uuid := ('00000000-0000-4000-8000-' || lpad(p_person, 12, '0'))::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'person' || p_person || '@demo.test')
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
-- A list of n distinct card ids as jsonb.
create function pg_temp.ids(n integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg('card' || i), '[]'::jsonb) from generate_series(1, n) i
$$;

delete from public.dashboard_layouts where person_id in ('1', '2', '4');

-- The validator: what was valid stays valid ----------------------------------------------
select ok(public.dashboard_layout_valid('{"order": ["today", "team"], "side": ["team"]}'),
  'a layout saved before hiding (order and side) is valid');
select ok(public.dashboard_layout_valid('{"order": ["today"]}'), 'side may be left out');
select ok(public.dashboard_layout_valid('{}'), 'so may everything (nothing arranged)');

-- "hidden" is accepted under the same rules as the other lists ----------------------------
select ok(public.dashboard_layout_valid('{"order": ["today", "team"], "side": ["team"], "hidden": ["today"]}'),
  'a layout with hidden cards is valid');
select ok(public.dashboard_layout_valid('{"hidden": ["today", "aNewCard_2"]}'),
  'hidden alone is valid, and unknown card ids are fine (a newer app)');
select ok(public.dashboard_layout_valid('{"order": [], "side": [], "hidden": []}'), 'nothing hidden is valid');
select ok(public.dashboard_layout_valid(jsonb_build_object('hidden', pg_temp.ids(50))), 'fifty hidden cards are valid');
select ok(not public.dashboard_layout_valid(jsonb_build_object('hidden', pg_temp.ids(51))), 'fifty-one are not');
select ok(not public.dashboard_layout_valid('{"hidden": "today"}'), 'hidden is a list, not a string');
select ok(not public.dashboard_layout_valid('{"hidden": {"today": true}}'), 'hidden is a list, not an object');
select ok(not public.dashboard_layout_valid('{"hidden": null}'), 'hidden is not null');
select ok(not public.dashboard_layout_valid('{"hidden": ["today", "today"]}'), 'no card hidden twice');
select ok(not public.dashboard_layout_valid('{"hidden": ["<script>"]}'), 'hidden ids are plain names');
select ok(not public.dashboard_layout_valid('{"hidden": [3]}'), 'hidden ids are strings');
select ok(not public.dashboard_layout_valid('{"hidden": ["1today"]}'), 'an id starts with a letter');
select ok(not public.dashboard_layout_valid(jsonb_build_object('hidden', jsonb_build_array(repeat('a', 41)))),
  'an id is at most 40 characters');
select ok(public.dashboard_layout_valid(jsonb_build_object('hidden', jsonb_build_array(repeat('a', 40)))),
  'forty is fine');

-- Anything else is still refused -----------------------------------------------------------
select ok(not public.dashboard_layout_valid('{"order": [], "side": [], "hidden": [], "extra": []}'),
  'an unknown fourth key is refused');
select ok(not public.dashboard_layout_valid('{"hide": ["today"]}'), 'so is a near miss of the key name');
select ok(not public.dashboard_layout_valid('{"order": ["today"], "extra": 1}'), 'and an unknown key beside order');
select ok(not public.dashboard_layout_valid('[]'), 'an object only');
select ok(not public.dashboard_layout_valid(null), 'not null');

-- The function is as it was: immutable, invoker's rights, fixed search_path, callable -------
select ok((select provolatile = 'i' and not prosecdef from pg_proc where oid = 'public.dashboard_layout_valid(jsonb)'::regprocedure),
  'still immutable, not security definer');
select is((select proconfig from pg_proc where oid = 'public.dashboard_layout_valid(jsonb)'::regprocedure),
  array['search_path=""'], 'still runs with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.dashboard_layout_valid(jsonb)', 'execute'),
  'signed-in people can still run it (the table check calls it as them)');

-- Your own layout, with hidden cards -------------------------------------------------------
select pg_temp.login('4');
insert into public.dashboard_layouts (layout)
  values ('{"order": ["today", "team", "myDay"], "side": ["team"], "hidden": ["myDay"]}');
select is((select layout from public.dashboard_layouts where person_id = '4'),
  '{"order": ["today", "team", "myDay"], "side": ["team"], "hidden": ["myDay"]}'::jsonb,
  'a person saves their hidden cards and reads them back as given');
select ok(pg_temp.affected($$update public.dashboard_layouts set layout = '{"order": ["today", "team"], "side": []}' where person_id = '4'$$) = 1,
  'a two-key layout can still be saved over it (nothing hidden)');
select is((select layout from public.dashboard_layouts where person_id = '4'),
  '{"order": ["today", "team"], "side": []}'::jsonb, 'and reads back unchanged');
insert into public.dashboard_layouts (person_id, layout)
  values ('4', '{"order": ["team", "today"], "side": [], "hidden": ["team", "today"]}')
  on conflict (person_id) do update set layout = excluded.layout;
select is((select layout -> 'hidden' from public.dashboard_layouts where person_id = '4'),
  '["team", "today"]'::jsonb, 'saving again (upsert) replaces the hidden list');
select throws_ok($$update public.dashboard_layouts set layout = '{"order": [], "hidden": ["today", "today"]}' where person_id = '4'$$,
  '23514', null, 'the table refuses a bad hidden list');
select throws_ok($$update public.dashboard_layouts set layout = '{"order": [], "hidden": [], "extra": 1}' where person_id = '4'$$,
  '23514', null, 'and an unknown key beside it');
select pg_temp.logout();

-- Nobody else's ----------------------------------------------------------------------------
select pg_temp.login('2');
select is((select count(*)::int from public.dashboard_layouts where person_id = '4'), 0,
  'an upline does not read a downline''s hidden cards');
select is(pg_temp.affected($$update public.dashboard_layouts set layout = '{"hidden": []}' where person_id = '4'$$), 0,
  'or change them');
select pg_temp.logout();
select pg_temp.login('4');
select throws_ok($$insert into public.dashboard_layouts (person_id, layout) values ('1', '{"hidden": ["today"]}')$$,
  '42501', null, 'nobody saves a layout for someone else');
select pg_temp.logout();
select pg_temp.login('1');
insert into public.dashboard_layouts (layout) values ('{"order": ["today"], "hidden": ["inbox"]}');
select pg_temp.logout();
select pg_temp.login('4');
select is((select count(*)::int from public.dashboard_layouts), 1,
  'a person sees only their own row, whoever else hid cards');

select * from finish();
rollback;
