-- The recruiting board's fixed columns (migration
-- 20261014002500_pipeline_fixed_columns): "Not contacted yet", "Not
-- interested" and "Do not contact" through move_pipeline_card(), undo, and
-- the names and ids steps can't take.
--
-- Seed facts (src/data/pipeline/seed.ts): Carlos (9, Jamal's prospect) has a
-- card in first_plan. Jamal (4) is under Anita (2) under Maria (1).
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

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
create function pg_temp.card_column(p_person text) returns text language sql as $$
  select column_id from public.pipeline_cards where person_id = p_person
$$;

-- Moves ---------------------------------------------------------------------------
select pg_temp.login('4');
select is(public.move_pipeline_card('9', 'not_interested', 'mv-fixed-1')->'move'->>'milestone', 'out',
  'Not interested is in the "out" band');
select is(pg_temp.card_column('9'), 'not_interested', 'the card is in Not interested');
select is(public.move_pipeline_card('9', 'do_not_contact', 'mv-fixed-2')->'move'->>'milestone', 'out',
  'so is Do not contact');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-fixed-2'$$), 1,
  'the move can be undone');
select is(pg_temp.card_column('9'), 'not_interested', 'and the card goes back');
select is(public.move_pipeline_card('9', 'not_contacted', 'mv-fixed-3')->'move'->>'milestone', 'start',
  'Not contacted yet is in the "start" band');
select is(public.move_pipeline_card('9', 'first_meeting', 'mv-fixed-4')->'move'->>'from_column', 'not_contacted',
  'a card moves on from Not contacted yet');
select throws_ok($$select public.move_pipeline_card('9', 'not_now')$$, '22023', null,
  'other names aren''t columns');

-- Counts --------------------------------------------------------------------------
select is(public.pipeline_milestone_index('start'), null, 'the start band reaches no milestone');
select is(public.pipeline_milestone_index('out'), null, 'nor do the outcomes');

-- Steps ---------------------------------------------------------------------------
select throws_ok($$insert into public.pipeline_steps (band, label) values ('contact', 'Not interested')$$,
  '23514', null, 'a step can''t take a fixed column''s name');
select throws_ok($$insert into public.pipeline_steps (band, label) values ('first_plan', 'do not contact')$$,
  '23514', null, 'in any case');
select throws_ok($$insert into public.pipeline_steps (id, band, label) values ('not_contacted', 'contact', 'Fake')$$,
  '23514', null, 'or its id');
select throws_ok($$insert into public.pipeline_moves (person_id, owner_id, to_column, milestone) values ('9', '4', 'do_not_contact', 'out')$$,
  '42501', null, 'moves are still only written by move_pipeline_card()');

select * from finish();
rollback;
