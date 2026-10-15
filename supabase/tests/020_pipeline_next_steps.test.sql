-- Booked next steps on both boards (migration 20261014005000_pipeline_next_steps):
-- the columns, the free-text conversion (legacy_next_column), moves keeping or
-- clearing the booking, undo restoring it, and cancelled steps
-- (pipeline_step_cancellations: who reads and writes them, the activity entry).
--
-- Seed facts (src/data/pipeline/seedPeople.ts, src/data/customerPipeline/seed.ts):
-- Jamal (4) is under Anita (2) under Maria (1); David (3) is a crossline. Jamal's
-- prospects: Carlos (9) in First plan booked into F1 (s-f1), note "Bring to
-- Fall Weekend"; Rowan (204) in Opened the Door (s-door) booked into First
-- meeting today at 18:30; Gray (200) in Book (s-book) booked into MG2 (s-mg2).
-- Jamal's list: le-4-6 Fay Gordon in Sampled product (cs-sampled) booked into
-- First meeting today; le-4-7 Kofi Mensah (customer c8) on Ditto. David hides
-- Info 3 (s-info3). Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

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
create function pg_temp.booked(p_person text) returns text language sql as $$
  select coalesce(next_column, '-') || ' ' || coalesce(next_step_date::text, '-')
    from public.pipeline_cards where person_id = p_person
$$;
-- The seeded bookings (seed days follow the workspace calendar, not UTC).
create temp table seeded as
  select person_id as id, pg_temp.booked(person_id) as booked from public.pipeline_cards
  union all
  select entry_id, coalesce(next_column, '-') || ' ' || coalesce(next_step_date::text, '-')
    from public.customer_cards;
grant select on seeded to authenticated;

-- Schema ------------------------------------------------------------------------
select has_column('public', 'pipeline_cards', 'next_column', 'pipeline_cards.next_column');
select has_column('public', 'pipeline_cards', 'next_step_time', 'pipeline_cards.next_step_time');
select has_column('public', 'pipeline_cards', 'note', 'pipeline_cards.note');
select hasnt_column('public', 'pipeline_cards', 'next_step', 'the free-text next step is gone');
select has_column('public', 'customer_cards', 'next_column', 'customer_cards.next_column');
select has_column('public', 'customer_cards', 'note', 'customer_cards.note');
select hasnt_column('public', 'customer_cards', 'next_step', 'customer_cards.next_step is gone');
select has_table('public', 'pipeline_step_cancellations', 'pipeline_step_cancellations exists');
select is((select next_column || ' / ' || note from public.pipeline_cards where person_id = '9'),
  's-f1 / Bring to Fall Weekend', 'seed: Carlos is booked into F1 and keeps his note');
select is((select next_step_time::text from public.pipeline_cards where person_id = '204'), '18:30:00',
  'seed: Rowan''s first meeting has a time');

-- Free text -> a booked column ----------------------------------------------------
select is(public.legacy_next_column('recruiting', '4', 's-door', 'MG1'), 'first_meeting',
  'a milestone''s team name books it');
select is(public.legacy_next_column('recruiting', '4', 'first_meeting', ' book. '), 's-book',
  'a step''s label books it (case, spaces and a full stop don''t matter)');
select is(public.legacy_next_column('recruiting', '4', 's-mg2', 'Info'), 'first_plan',
  'a common name books the milestone');
select is(public.legacy_next_column('recruiting', '2', 's-f2', 'Info 3'), 's-info3',
  'Anita can book Info 3');
select is(public.legacy_next_column('recruiting', '3', 's-f2', 'Info 3'), null,
  'David hides Info 3, so it isn''t booked on his board');
select is(public.legacy_next_column('recruiting', '4', 'first_plan', 'Book'), null,
  'only a column after the card''s own is booked');
select is(public.legacy_next_column('recruiting', '4', 'contact', 'Bring to Fall Weekend'), null,
  'other text names nothing (it becomes the note)');
select is(public.legacy_next_column('customer', '1', 'first_sale', 'Offer Ditto'), 'on_ditto',
  'customer board: "Offer Ditto" books On Ditto');

-- Bookings on cards --------------------------------------------------------------
select pg_temp.login('4');
select throws_ok($$select public.legacy_next_column('recruiting', '4', 'contact', 'MG1')$$, '42501', null,
  'the app can''t call the conversion');
select throws_ok($$update public.pipeline_cards set next_column = null where person_id = '204'$$, '23514', null,
  'a day without a booked column is refused');
select lives_ok($$update public.pipeline_cards set next_column = 's-book', next_step_date = current_date + 1,
  next_step_time = '09:15', note = 'Coffee first' where person_id = '9'$$,
  'the card''s owner books a step and writes a note (a plain edit)');
select pg_temp.login('3');
select is(pg_temp.affected($$update public.pipeline_cards set note = 'x' where person_id = '9'$$), 0,
  'a crossline can''t touch the booking or note');

-- Moves keep or clear the booking; undo restores it --------------------------------
select pg_temp.login('4');
select lives_ok($$select public.move_pipeline_card('204', 'contact', 'nx-1')$$, 'Rowan moves back');
select is(pg_temp.booked('204'), (select booked from seeded where id = '204'),
  'moving backwards keeps the booking');
select lives_ok($$select public.move_pipeline_card('204', 'first_meeting', 'nx-2')$$, 'Rowan reaches First meeting');
select is(pg_temp.booked('204'), '- -', 'moving into the booked column clears it');
select is((select booking_before ->> 'next_column' from public.pipeline_moves where id = 'nx-2'), 'first_meeting',
  'the move remembers the booking it cleared');
select is(pg_temp.affected($$delete from public.pipeline_moves where id = 'nx-2'$$), 1, 'Jamal undoes it');
select is((select column_id from public.pipeline_cards where person_id = '204'), 'contact',
  'the card goes back');
select is(pg_temp.booked('204') || ' ' || (select next_step_time::text from public.pipeline_cards where person_id = '204'),
  (select booked from seeded where id = '204') || ' 18:30:00', 'undo puts the booking back, time included');
select lives_ok($$select public.move_pipeline_card('200', 'first_plan', 'nx-3')$$, 'Gray skips past MG2');
select is(pg_temp.booked('200'), '- -', 'moving past the booked column clears it');
select lives_ok($$select public.move_pipeline_card('200', 's-f1', 'nx-4', 'registered', current_date + 3)$$,
  'a move can book the next step with it');
select is(pg_temp.booked('200'), 'registered ' || (current_date + 3)::text, 'the new booking is on the card');
select lives_ok($$select public.move_pipeline_card('200', 'not_interested', 'nx-5')$$, 'Gray isn''t interested');
select is(pg_temp.booked('200'), '- -', 'an outcome counts as past the booking');

-- Customer board
select lives_ok($$select public.move_customer_card('le-4-6', 'first_meeting', 'cx-1')$$,
  'Fay reaches First meeting');
select is((select coalesce(next_column, '-') from public.customer_cards where entry_id = 'le-4-6'), '-',
  'customer board: moving into the booked column clears it');
select is(pg_temp.affected($$delete from public.customer_moves where id = 'cx-1'$$), 1, 'Jamal undoes it');
select is((select next_column || ' ' || next_step_date::text from public.customer_cards where entry_id = 'le-4-6'),
  (select booked from seeded where id = 'le-4-6'), 'customer board: undo puts the booking back');

-- Cancelled steps -------------------------------------------------------------------
select lives_ok($$insert into public.pipeline_step_cancellations
  (id, board, card_id, owner_id, column_id, booked_date, reason, cancelled_by)
  values ('sc-1', 'recruiting', '9', '4', 's-f1', current_date - 1, 'no_show', '4')$$,
  'Jamal records a no-show on his prospect');
select is((select summary || ' / ' || related_person_id from public.activity where id = 'stepcancel-sc-1'),
  'F1 cancelled · No-show / 9', 'the person''s activity says so');
select throws_ok($$insert into public.pipeline_step_cancellations
  (board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('recruiting', '9', '4', 's-f1', 'no_show', '2')$$, '42501', null,
  'nobody records a cancellation as someone else');
select throws_ok($$insert into public.pipeline_step_cancellations
  (board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('recruiting', '9', '2', 's-f1', 'no_show', '4')$$, '42501', null,
  'the owner must be the card''s');
select throws_ok($$insert into public.pipeline_step_cancellations
  (board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('recruiting', '9', '4', 's-f1', 'other', '4')$$, '23514', null,
  '"Other" needs its own words');
select lives_ok($$insert into public.pipeline_step_cancellations
  (id, board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('sc-2', 'customer', 'le-4-7', '4', 'on_ditto', 'they_cancelled', '4')$$,
  'a cancellation on the customer board');
select is((select summary || ' / ' || related_person_id from public.activity where id = 'stepcancel-sc-2'),
  'On Ditto cancelled · They cancelled / c8', 'its activity entry is about the customer behind the name');
select is(pg_temp.affected($$update public.pipeline_step_cancellations set reason = 'unreachable' where id = 'sc-1'$$), 0,
  'nobody edits a cancellation');

select pg_temp.login('2');
select is((select count(*)::int from public.pipeline_step_cancellations where id in ('sc-1', 'sc-2')), 2,
  'Anita (upline) reads Jamal''s cancellations');
select is(pg_temp.affected($$delete from public.pipeline_step_cancellations where id = 'sc-1'$$), 0,
  'but only Jamal undoes his');
select pg_temp.login('3');
select is((select count(*)::int from public.pipeline_step_cancellations where id in ('sc-1', 'sc-2')), 0,
  'a crossline reads none');
select throws_ok($$insert into public.pipeline_step_cancellations
  (board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('recruiting', '9', '4', 's-f1', 'no_show', '3')$$, '42501', null,
  'nor records one on Jamal''s card');
select pg_temp.login('20');
select throws_ok($$insert into public.pipeline_step_cancellations
  (board, card_id, owner_id, column_id, reason, cancelled_by)
  values ('recruiting', '20', '6', 'first_meeting', 'no_show', '20')$$, '42501', null,
  'candidates have no pipeline');

select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.pipeline_step_cancellations where id = 'sc-1'$$), 1,
  'Jamal undoes his cancellation');
select pg_temp.logout();
select is((select count(*)::int from public.activity where id = 'stepcancel-sc-1'), 0,
  'and its activity entry goes with it');

select * from finish();
rollback;
