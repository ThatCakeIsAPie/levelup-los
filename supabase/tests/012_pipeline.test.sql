-- Pipeline (migration 20261013000400_pipeline): steps and their inheritance,
-- hides, cards, moves through move_pipeline_card(), undo, registering, team
-- goals, sharing per-person numbers and stat requests.
--
-- Seed facts (src/data/pipeline/seed.ts): Maria (1) owns the steps s-story,
-- s-door, s-book, s-mg2, s-f1, s-info2, s-f2, s-info3, s-f3; Anita (2) adds
-- s-3way; David (3) hides s-info3. Goals: Maria 80 with targets, Anita 35,
-- Jamal 12 with his own targets, David, Marcus, Priya. Marcus (6) shares his
-- numbers with Anita. Requests: req-8-2 (Priya asks Anita, pending), req-4-1
-- (Jamal asks Maria, pending), req-7-6 (declined). Cards: Carlos (9, Jamal's)
-- in first_plan; Linh (5, Anita's) in s-f2; Finley (103, David's) in s-f1.
-- Jamal (4) is under Anita (2) under Maria (1); David (3) and Sarah (7) are a
-- crossline to them; Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(81);

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
create function pg_temp.card_column(p_person text) returns text language sql as $$
  select column_id from public.pipeline_cards where person_id = p_person
$$;

-- Schema -------------------------------------------------------------------------
select has_table('public', 'pipeline_steps', 'pipeline_steps exists');
select has_table('public', 'pipeline_step_hides', 'pipeline_step_hides exists');
select has_table('public', 'pipeline_cards', 'pipeline_cards exists');
select has_table('public', 'pipeline_moves', 'pipeline_moves exists');
select has_table('public', 'pipeline_team_settings', 'pipeline_team_settings exists');
select has_table('public', 'stat_shares', 'stat_shares exists');
select has_table('public', 'stat_requests', 'stat_requests exists');
select ok((select count(*) from public.pipeline_moves) > 3000, 'the seed has about six months of moves');

-- Visibility: Jamal ----------------------------------------------------------------
select pg_temp.login('4');
select is(array(select person_id from public.sponsor_chain('4') order by depth),
  array['1', '2', '4'], 'sponsor_chain is root first and ends with the person');
select is((select count(*)::int from public.sponsor_chain('3')), 0,
  'nobody gets the sponsor line of someone they can''t see');
select is((select count(*)::int from public.pipeline_steps), 10,
  'Jamal reads the steps of his whole sponsor line (Maria''s nine and Anita''s)');
select is((select count(*)::int from public.pipeline_step_hides), 0,
  'a crossline''s hides stay with their team');
select is((select count(*)::int from public.pipeline_team_settings), 3,
  'goals of his line: Maria, Anita and his own');
select is(pg_temp.card_column('9'), 'first_plan', 'Jamal sees his prospect''s card');
select is(pg_temp.card_column('5'), null, 'not his upline''s prospects');
select is(pg_temp.card_column('103'), null, 'not a crossline''s prospects');
select is((select count(*)::int from public.pipeline_moves where owner_id in ('1', '2', '3')), 0,
  'no moves of his upline''s or a crossline''s prospects');
select ok((select count(*) from public.pipeline_moves where owner_id = '4') > 0, 'his own moves');
select is(array(select id from public.stat_requests order by id), array['req-4-1'],
  'only his own requests');

-- Visibility: Anita, Maria, Beau ---------------------------------------------------
select pg_temp.login('2');
select is(pg_temp.card_column('5'), 's-f2', 'Anita sees her prospect''s card');
select is(pg_temp.card_column('9'), 'first_plan', 'and her downline''s');
select is((select count(*)::int from public.pipeline_moves where owner_id = '3'), 0,
  'a crossline can''t read David''s moves');
select is((select count(*)::int from public.pipeline_moves where owner_id = '6'), 0,
  'a share doesn''t open the sharer''s moves either');
select is(array(select owner_id || '>' || viewer_id from public.stat_shares), array['6>2'],
  'Anita sees the share made with her');
select is(array(select id from public.stat_requests order by id), array['req-8-2'],
  'and the request sent to her');
select is((select count(*)::int from public.pipeline_person_counts(array['3'], current_date - 90, current_date)), 0,
  'pipeline_person_counts says nothing about a crossline');
select ok((select contact from public.pipeline_person_counts(array['6'], current_date - 90, current_date)) > 0,
  'but totals of someone who shared with her');
select ok((select contact from public.pipeline_person_counts(array['2'], current_date - 90, current_date)) > 0,
  'and her own');

select pg_temp.login('1');
select is((select count(*)::int from public.pipeline_step_hides), 1, 'Maria sees David''s hide (her downline)');
select ok((select count(*) from public.pipeline_cards) >= 70, 'Maria reads every card of her team');
select is((select count(*)::int from public.pipeline_person_counts(array['3', '4'], current_date - 90, current_date)), 2,
  'an upline needs no request for her downline''s numbers');

select pg_temp.login('20');
select is((select count(*)::int from public.pipeline_cards), 0, 'a candidate reads no cards (not even his own)');
select is((select count(*)::int from public.pipeline_moves), 0, 'and no moves');
select is((select count(*)::int from public.pipeline_steps), 0, 'and no steps');
select throws_ok($$select public.move_pipeline_card('20', 'contact')$$, '42501', null,
  'a candidate moves nothing');

-- Steps: owners only, milestones locked ------------------------------------------------
select pg_temp.login('2');
select throws_ok($$insert into public.pipeline_steps (owner_id, band, label) values ('1', 'contact', 'Sneaky')$$,
  '42501', null, 'nobody adds a step for someone else');
select throws_ok($$insert into public.pipeline_steps (band, label) values ('registered', 'After')$$,
  '23514', null, 'no steps after Registered');
select throws_ok($$insert into public.pipeline_steps (id, band, label) values ('contact', 'contact', 'Fake')$$,
  '23514', null, 'a step can''t take a milestone''s code');
select throws_ok($$insert into public.pipeline_steps (band, label) values ('contact', 'First meeting')$$,
  '23514', null, 'or a milestone''s name');
select is(pg_temp.affected($$update public.pipeline_steps set label = 'Renamed' where id = 's-book'$$), 0, 'nobody renames an upline''s step');
select throws_ok($$update public.pipeline_steps set band = 'contact' where id = 's-3way'$$,
  '42501', null, 'a step stays in its band');
select lives_ok($$update public.pipeline_steps set label = '3-way chat' where id = 's-3way'$$,
  'the owner renames their own step');

select pg_temp.login('4');
select lives_ok($$insert into public.pipeline_step_hides (step_id) values ('s-book')$$,
  'Jamal hides an inherited step for his team');
select throws_ok($$insert into public.pipeline_step_hides (step_id) values ('s-3way-nope')$$,
  '42501', null, 'only steps on his own line');
select lives_ok($$insert into public.pipeline_steps (id, band, label) values ('s-jamal', 'contact', 'Coffee')$$,
  'Jamal adds his own step');
select throws_ok($$insert into public.pipeline_step_hides (step_id) values ('s-jamal')$$,
  '42501', null, 'his own step is deleted, not hidden');
select pg_temp.login('2');
select is((select count(*)::int from public.pipeline_steps where id = 's-jamal'), 1,
  'his upline sees his step (to view his team''s board)');
select pg_temp.login('3');
select is((select count(*)::int from public.pipeline_steps where id = 's-jamal'), 0,
  'a crossline doesn''t');

-- Moves -----------------------------------------------------------------------------
select pg_temp.login('4');
select throws_ok($$insert into public.pipeline_moves (person_id, owner_id, to_column, milestone) values ('9', '4', 'registered', 'registered')$$,
  '42501', null, 'moves are only written by move_pipeline_card()');
select throws_ok($$update public.pipeline_cards set column_id = 'registered' where person_id = '9'$$,
  '42501', null, 'a card''s column changes only through moves');
select lives_ok($$update public.pipeline_cards set note = 'Call first', hot = true where person_id = '9'$$,
  'the note and hot flag are plain edits');
select throws_ok($$select public.move_pipeline_card('9', 's-nowhere')$$, '22023', null,
  'unknown columns are refused');
select throws_ok($$select public.move_pipeline_card('9', 'first_plan')$$, '22023', null,
  'moving to the same column is refused');
select throws_ok($$select public.move_pipeline_card('103', 'contact')$$, 'P0002', null,
  'a crossline''s prospect is not found');
select throws_ok($$select public.move_pipeline_card('4', 'contact')$$, '22023', null,
  'only prospects move');
select lives_ok($$select public.move_pipeline_card('9', 'registered', 'mv-test-reg')$$,
  'Jamal registers Carlos from the board');
select pg_temp.logout();
select is((select biz_class || '/' || pipeline_stage from public.people where id = '9'), 'apprentice/apprentice',
  'registering makes him an apprentice');
select is((select business_start_date from public.people where id = '9'), public.workspace_today('w1'),
  'from today');
select is((select milestone || ':' || from_column from public.pipeline_moves where id = 'mv-test-reg'),
  'registered:first_plan', 'the move records where he came from');
select is((select count(*)::int from public.activity where related_person_id = '9' and kind = 'stage_changed'
           and summary = 'Pipeline → apprentice'), 1, 'and the activity is logged');

select pg_temp.login('2');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-test-reg'$$), 0, 'nobody undoes someone else''s move');
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.pipeline_moves
                      where id = (select id from public.pipeline_moves
                                  where moved_by = '4' and moved_at < now() - interval '2 hours'
                                  order by moved_at limit 1)$$), 0, 'an old move can''t be undone');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'mv-test-reg'$$), 1, 'Jamal undoes his own move within the hour');
select is(pg_temp.card_column('9'), 'first_plan', 'and the card goes back');

-- Deleting a step sends its cards back to the milestone
select pg_temp.login('2');
select lives_ok($$insert into public.pipeline_steps (id, band, label) values ('s-anita-test', 'first_plan', 'Test step')$$,
  'Anita adds a step after First plan');
select lives_ok($$select public.move_pipeline_card('5', 's-anita-test')$$, 'and moves Linh into it');
select lives_ok($$delete from public.pipeline_steps where id = 's-anita-test'$$, 'then deletes the step');
select is(pg_temp.card_column('5'), 'first_plan', 'Linh is back at First plan');

-- Stat requests and shares ---------------------------------------------------------------
select pg_temp.login('4');
select lives_ok($$insert into public.stat_requests (id, owner_id) values ('req-test-7', '7')$$,
  'Jamal asks a crossline (Sarah) to see her numbers');
select throws_ok($$insert into public.stat_requests (owner_id) values ('7')$$, '23505', null,
  'one pending request at a time');
select throws_ok($$insert into public.stat_requests (owner_id) values ('200')$$, '42501', null,
  'no need to ask for your own downline''s numbers');
select throws_ok($$insert into public.stat_shares (viewer_id) values ('2')$$, '42501', null,
  'sharing with an upline is pointless (they already see them)');
select pg_temp.logout();
select is((select count(*)::int from public.notifications where type = 'stat_request' and ref_id = 'req-test-7' and recipient_id = '7'),
  1, 'the owner gets an inbox request');

select pg_temp.login('4');
select throws_ok($$select public.answer_stat_request('req-8-2', true)$$, 'P0002', null,
  'only the owner answers a request');
select pg_temp.login('2');
select lives_ok($$select public.answer_stat_request('req-8-2', true)$$, 'Anita approves Priya''s request');
select pg_temp.logout();
select is((select count(*)::int from public.stat_shares where owner_id = '2' and viewer_id = '8'), 1,
  'approving shares her numbers with Priya');
select is((select count(*)::int from public.notifications where type = 'stat_request_answered'
           and ref_id = 'req-8-2' and recipient_id = '8'), 1, 'Priya is told');
select is((select count(*)::int from public.notifications where type = 'stat_request'
           and ref_id = 'req-8-2' and read_at is null), 0, 'and Anita''s request notification is done');

select pg_temp.login('8');
select ok((select contact from public.pipeline_person_counts(array['2'], current_date - 90, current_date)) > 0,
  'Priya now gets Anita''s totals');

select pg_temp.login('4');
select lives_ok($$delete from public.stat_requests where id = 'req-test-7'$$, 'Jamal withdraws his request');
select pg_temp.logout();
select is((select count(*)::int from public.notifications where ref_id = 'req-test-7'), 0,
  'withdrawing removes the owner''s notification');

select * from finish();
rollback;
