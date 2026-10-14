-- Undoing a registration (migration 20261013000500_pipeline_undo_registration):
-- deleting your latest move into Registered puts the person back to prospect
-- in the database, in the same statement as the card going back, and never
-- touches anything else of theirs.
--
-- Seed facts: Carlos (9) is Jamal's (4) prospect, card in first_plan; Linh (5)
-- is Anita's (2), card in s-f2; Beau (20) is a candidate (a prospect with a
-- login) under Marcus (6) in Maria's (1) team, with attendance m7, contacts
-- t-20 and t2-20, learning l30 and two library progress rows.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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
create function pg_temp.stage(p_person text) returns text language sql as $$
  select biz_class || '/' || coalesce(pipeline_stage, '-') from public.people where id = p_person
$$;
create function pg_temp.unregistered(p_person text) returns integer language sql as $$
  select count(*)::int from public.activity
   where related_person_id = p_person and kind = 'stage_changed' and summary = 'Pipeline → prospect'
     and meta ->> 'from' = 'apprentice'
$$;
-- Beau's own rows: attendance, contacts, learning, library progress, member row.
create function pg_temp.beau_rows() returns text language sql as $$
  select (select count(*) from public.attendances where person_id = '20') || '/'
      || (select count(*) from public.contacts where person_id = '20') || '/'
      || (select count(*) from public.learning where person_id = '20') || '/'
      || (select count(*) from public.library_progress where person_id = '20') || '/'
      || (select count(*) from public.members where person_id = '20')
$$;

-- Jamal registers Carlos and takes it back -------------------------------------------
select pg_temp.login('4');
select lives_ok($$select public.move_pipeline_card('9', 'registered', 'mv-undo-1')$$,
  'Jamal registers Carlos from the board');
select pg_temp.logout();
select is(pg_temp.stage('9'), 'apprentice/apprentice', 'Carlos is an apprentice');

select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-undo-1'$$), 1,
  'Jamal undoes the registration (deletes his move)');
select pg_temp.logout();
select is(pg_temp.stage('9'), 'prospect/prospect', 'Carlos is a prospect again');
select is((select business_start_date from public.people where id = '9'), null,
  'without a business start date');
select is((select stage_history -> -1 ->> 'stage' from public.people where id = '9'), 'prospect',
  'the stage history ends with prospect');
select is(pg_temp.unregistered('9'), 1, 'the activity says so');
select is((select actor_id from public.activity
            where related_person_id = '9' and summary = 'Pipeline → prospect'
              and meta ->> 'from' = 'apprentice'), '4',
  'logged as Jamal');
select is((select column_id from public.pipeline_cards where person_id = '9'), 'first_plan',
  'and the card is back in First plan');

-- Someone promoted meanwhile stays as they are ---------------------------------------
select pg_temp.login('4');
select lives_ok($$select public.move_pipeline_card('9', 'registered', 'mv-undo-2')$$,
  'Jamal registers Carlos again');
select pg_temp.logout();
update public.people set biz_class = 'ibo' where id = '9';
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-undo-2'$$), 1,
  'and undoes it after Carlos was made an IBO');
select pg_temp.logout();
select is(pg_temp.stage('9'), 'ibo/apprentice', 'the IBO is left alone');
select is(pg_temp.unregistered('9'), 1, 'and nothing more is logged');

-- Undoing any other move leaves the person alone -------------------------------------
select pg_temp.login('2');
select lives_ok($$select public.move_pipeline_card('5', 'first_plan', 'mv-undo-3')$$,
  'Anita moves Linh back to First plan');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-undo-3'$$), 1,
  'and undoes it');
select pg_temp.logout();
select is(pg_temp.stage('5') || ' ' || pg_temp.unregistered('5'), 'prospect/prospect 0',
  'Linh is untouched');

-- Beau (a candidate with a login): registered, undone, nothing of his lost ------------
select pg_temp.login('1');
select lives_ok($$select public.move_pipeline_card('20', 'registered', 'mv-undo-beau')$$,
  'Maria registers Beau');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-undo-beau'$$), 1,
  'and undoes it');
select pg_temp.logout();
select is(pg_temp.stage('20') || ' ' || public.chat_eligible('20')::text, 'prospect/prospect false',
  'Beau is a prospect again (a candidate: no chat)');
-- Beau is on the Monthly Team Meeting and two info sessions (src/data/seed.ts).
select is(pg_temp.beau_rows(), '3/2/1/2/1',
  'his attendance, contacts, learning, library progress and login are all still there');

select * from finish();
rollback;
