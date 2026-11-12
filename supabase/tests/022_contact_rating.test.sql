-- Hot / Warm / Cold (migration 20261016000100_contact_rating): list entries
-- take 'cold' too, and pipeline cards have a rating kept in step with the old
-- `hot` flag. Row-level security is unchanged.
--
-- Seed facts (src/data/pipeline/seedPeople.ts, src/data/customerPipeline/seed.ts):
-- Carlos (9, Jamal's prospect) is rated hot; Linh (5, Anita's) warm. Tasha's
-- (700) first list name is le-700-1. Jamal (4) is under Anita (2); David (3)
-- is a crossline to them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

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
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;
create function pg_temp.card(p_person text) returns text language sql as $$
  select coalesce(rating, '-') || '/' || hot::text from public.pipeline_cards where person_id = p_person
$$;

select has_column('public', 'pipeline_cards', 'rating', 'pipeline_cards has a rating');
select is(pg_temp.card('9'), 'hot/true', 'seed: Carlos is hot');
select is(pg_temp.card('5'), 'warm/false', 'seed: Linh is warm');

select pg_temp.login('4');
select is(pg_temp.affected($$update public.pipeline_cards set rating = 'warm' where person_id = '9'$$), 1,
  'Jamal rates his prospect');
select is(pg_temp.card('9'), 'warm/false', 'a warm rating turns hot off');
select lives_ok($$update public.pipeline_cards set rating = 'cold' where person_id = '9'$$, 'cold is allowed');
select is(pg_temp.card('9'), 'cold/false', 'cold is stored');
select lives_ok($$update public.pipeline_cards set hot = true where person_id = '9'$$,
  'the hot flag alone (older clients, the move RPC) still works');
select is(pg_temp.card('9'), 'hot/true', 'hot on makes the rating hot');
select lives_ok($$update public.pipeline_cards set hot = false where person_id = '9'$$, 'hot off');
select is(pg_temp.card('9'), '-/false', 'hot off clears a hot rating');
select throws_ok($$update public.pipeline_cards set rating = 'lukewarm' where person_id = '9'$$,
  '23514', null, 'only hot, warm or cold');

select pg_temp.login('3');
select is(pg_temp.affected($$update public.pipeline_cards set rating = 'hot' where person_id = '9'$$), 0,
  'a crossline can''t rate Jamal''s prospect');

select pg_temp.login('700');
select is(pg_temp.affected($$update public.list_entries set rating = 'cold' where id = 'le-700-1'$$), 1,
  'a name on a list can be cold');
select throws_ok($$update public.list_entries set rating = 'tepid' where id = 'le-700-1'$$,
  '23514', null, 'list ratings are hot, warm or cold');

select * from finish();
rollback;
