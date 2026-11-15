-- Conversion of booked next steps and card notes into card tasks and notes (migration
-- 20261109000100_card_followups_conversion): the counts (bookings before = tasks made; notes before = notes made),
-- the field mapping on both boards (title from the booked column, a step the owner hides, a step that no longer
-- exists, a booking without a day, a time), the owner as assignee and author, no duplicates when the same task or
-- note is already on the card, the old columns byte-identical before and after, a second run that creates
-- nothing, a run that finds nothing to convert, and what the move functions do with a booking that is still stored.
-- Self-contained (workspace cvw, whose clock is never UTC's), all rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- Team 'cvw': Lena (cvl) leads; Alex (cva) is her apprentice; Sam (cvs, not registered, a prospect) sponsors
-- nobody. Prospects: p1..p8 (sponsor Alex), pn (no sponsor). Names on lists: e1..e4 (Alex's).
insert into public.workspaces (id, name, timezone) values
  ('cvw', 'Conversion Team', case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date) values
  ('cvl', 'cvw', 'Lena Leader',     'ibo',        null,  public.workspace_today('cvw') - 900),
  ('cva', 'cvw', 'Alex Apprentice', 'apprentice', 'cvl', public.workspace_today('cvw') - 100),
  ('cvp1', 'cvw', 'P One',   'prospect', 'cva', null),
  ('cvp2', 'cvw', 'P Two',   'prospect', 'cva', null),
  ('cvp3', 'cvw', 'P Three', 'prospect', 'cva', null),
  ('cvp4', 'cvw', 'P Four',  'prospect', 'cva', null),
  ('cvp5', 'cvw', 'P Five',  'prospect', 'cva', null),
  ('cvp6', 'cvw', 'P Six',   'prospect', 'cva', null),
  ('cvp7', 'cvw', 'P Seven', 'prospect', 'cva', null),
  ('cvp8', 'cvw', 'P Eight', 'prospect', 'cva', null),
  ('cvpn', 'cvw', 'P Nobody','prospect', null,  null);
insert into public.list_entries (id, workspace_id, owner_id, name) values
  ('cve1', 'cvw', 'cva', 'Entry One'),
  ('cve2', 'cvw', 'cva', 'Entry Two'),
  ('cve3', 'cvw', 'cva', 'Entry Three'),
  ('cve4', 'cvw', 'cva', 'Entry Four');
-- Leader steps: Lena's "Coffee chat" (after contact: First meeting band), "Gone step" (deleted below), "Hidden step"
-- (hidden for Alex); and a customer step "Sampler".
insert into public.pipeline_steps (id, workspace_id, owner_id, band, label, position) values
  ('cvst1', 'cvw', 'cvl', 'first_meeting', 'Coffee chat', 0),
  ('cvst2', 'cvw', 'cvl', 'first_meeting', 'Gone step', 1),
  ('cvst3', 'cvw', 'cvl', 'first_meeting', 'Hidden step', 2);
insert into public.pipeline_step_hides (person_id, step_id, workspace_id) values ('cva', 'cvst3', 'cvw');
insert into public.customer_steps (id, workspace_id, owner_id, band, label, position) values
  ('cvcs1', 'cvw', 'cvl', 'first_meeting', 'Sampler', 0);

-- The stored bookings and notes (the way the old app left them).
-- (updated_at is set to a day of its own, so the notes' created_at can be told from now())
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at, next_column, next_step_date, next_step_time, note, updated_at) values
  ('cvp1', 'cvw', 'contact', now() - interval '9 days', 'first_meeting', public.workspace_today('cvw') + 2, time '09:15', null, now() - interval '3 days'),
  ('cvp2', 'cvw', 'contact', now() - interval '8 days', 'cvst1',         public.workspace_today('cvw') + 3, null,         '  Met at the gym  ', now() - interval '3 days'),
  ('cvp3', 'cvw', 'contact', now() - interval '7 days', 'cvst2',         public.workspace_today('cvw') - 1, time '18:00', null, now() - interval '3 days'),
  ('cvp4', 'cvw', 'contact', now() - interval '6 days', 'cvst3',         public.workspace_today('cvw') + 4, null,         null, now() - interval '3 days'),
  ('cvp5', 'cvw', 'contact', now() - interval '5 days', 'first_plan',    null,                              null,         null, now() - interval '3 days'),
  ('cvp6', 'cvw', 'contact', now() - interval '4 days', null,            null,                              null,         '   ', now() - interval '3 days'),
  ('cvp7', 'cvw', 'contact', now() - interval '3 days', null,            null,                              null,         'Likes coffee', now() - interval '3 days'),
  ('cvp8', 'cvw', 'contact', now() - interval '2 days', 'first_meeting', public.workspace_today('cvw') + 6, time '07:30', 'Already a note', now() - interval '3 days'),
  ('cvpn', 'cvw', 'contact', now() - interval '1 days', 'first_meeting', public.workspace_today('cvw') + 7, null,         'Nobody''s note', now() - interval '3 days');
insert into public.customer_cards (entry_id, workspace_id, column_id, entered_at, next_column, next_step_date, next_step_time, note, updated_at) values
  ('cve1', 'cvw', 'contact',       now() - interval '5 days', 'first_meeting', public.workspace_today('cvw') + 2, time '14:00', 'Wants the sampler', now() - interval '4 days'),
  ('cve2', 'cvw', 'contact',       now() - interval '5 days', 'cvcs1',         public.workspace_today('cvw') + 1, null,         null, now() - interval '4 days'),
  ('cve3', 'cvw', 'not_contacted', now() - interval '5 days', null,            null,                              null,         null, now() - interval '4 days'),
  ('cve4', 'cvw', 'contact',       now() - interval '5 days', 'on_ditto',      null,                              null,         null, now() - interval '4 days');
-- A cancelled step, which stays exactly as it is.
insert into public.pipeline_step_cancellations (id, workspace_id, board, card_id, owner_id, column_id, booked_date, reason, cancelled_by)
  values ('cvx1', 'cvw', 'recruiting', 'cvp3', 'cva', 'cvst2', public.workspace_today('cvw') - 1, 'no_show', 'cva');
-- One step stops existing (the booked column of cvp3 is gone); one task and one note already exist.
delete from public.pipeline_steps where id = 'cvst2';
insert into public.card_tasks (id, workspace_id, person_id, title, due_date, due_time, assignee_id, position)
  values ('cvt-old', 'cvw', 'cvp8', 'First meeting (MG1)', public.workspace_today('cvw') + 6, time '07:30', 'cva', 0);
insert into public.card_notes (id, workspace_id, person_id, author_id, body)
  values ('cvn-old', 'cvw', 'cvp8', 'cvl', 'Already a note');

create function pg_temp.old_state() returns text language sql as $$
  select md5(coalesce((select string_agg(c::text, '|' order by c.person_id) from public.pipeline_cards c where c.workspace_id = 'cvw'), '')
    || '#' || coalesce((select string_agg(c::text, '|' order by c.entry_id) from public.customer_cards c where c.workspace_id = 'cvw'), '')
    || '#' || coalesce((select string_agg(c::text, '|' order by c.id) from public.pipeline_step_cancellations c where c.workspace_id = 'cvw'), ''))
$$;
create temp table before as select
  (select count(*) from public.pipeline_cards where workspace_id = 'cvw' and nullif(btrim(next_column), '') is not null)
    as r_bookings,
  (select count(*) from public.customer_cards where workspace_id = 'cvw' and nullif(btrim(next_column), '') is not null)
    as c_bookings,
  (select count(*) from public.pipeline_cards where workspace_id = 'cvw' and nullif(btrim(note), '') is not null)
    as r_notes,
  (select count(*) from public.customer_cards where workspace_id = 'cvw' and nullif(btrim(note), '') is not null)
    as c_notes,
  (select count(*) from public.card_tasks where workspace_id = 'cvw') as tasks,
  (select count(*) from public.card_notes where workspace_id = 'cvw') as notes,
  pg_temp.old_state() as old_state;

select is((select r_bookings from before), 7::bigint, 'fixture: seven recruiting cards are booked');
select is((select c_bookings from before), 3::bigint, 'fixture: three customer cards are booked');
select is((select r_notes + c_notes from before), 5::bigint, 'fixture: five cards have a non-empty note (a blank one does not count)');
select is((select tasks from before), 1::bigint, 'fixture: one task already exists');
select is((select notes from before), 1::bigint, 'fixture: one note already exists');

-- The run ---------------------------------------------------------------------
select is(public.convert_card_followups(), jsonb_build_object('tasks', 9, 'notes', 4),
  'it reports what it made: tasks = bookings (10) minus the one that was already a task; notes = 5 minus the one already there');

select is((select count(*) from public.card_tasks where workspace_id = 'cvw'),
  (select tasks + r_bookings + c_bookings - 1 from before), 'tasks after = tasks before + bookings, less the duplicate');
select is((select count(*) from public.card_notes where workspace_id = 'cvw'),
  (select notes + r_notes + c_notes - 1 from before), 'notes after = notes before + notes with text, less the duplicate');

-- Recruiting mapping -----------------------------------------------------------
select is((select title || ' | ' || due_date::text || ' | ' || due_time::text || ' | ' || assignee_id || ' | ' || done::text
             from public.card_tasks where person_id = 'cvp1'),
  'First meeting (MG1) | ' || (public.workspace_today('cvw') + 2)::text || ' | 09:15:00 | cva | false',
  'a booked milestone: its name on the board, the day, the time, the owner as assignee, not done');
select is((select title || ' | ' || due_date::text || ' | ' || coalesce(due_time::text, '-') from public.card_tasks where person_id = 'cvp2'),
  'Coffee chat | ' || (public.workspace_today('cvw') + 3)::text || ' | -', 'a booked leader step: the step''s name, no time');
select is((select title || ' | ' || due_date::text || ' | ' || due_time::text from public.card_tasks where person_id = 'cvp3'),
  'Next step | ' || (public.workspace_today('cvw') - 1)::text || ' | 18:00:00',
  'a booked column that no longer exists: Next step, with its (overdue) day and time');
select is((select title from public.card_tasks where person_id = 'cvp4'), 'Hidden step',
  'a step hidden for the owner is still named by its step');
select is((select title || ' | ' || coalesce(due_date::text, '-') || ' | ' || coalesce(due_time::text, '-')
             from public.card_tasks where person_id = 'cvp5'),
  'First plan (Info 1) | - | -', 'a booking without a day: a task with no due date');
select is((select count(*) from public.card_tasks where person_id = 'cvp6'), 0::bigint, 'a card with no booking makes no task');
select is((select count(*) from public.card_tasks where person_id = 'cvp7'), 0::bigint, 'a card with only a note makes no task');
select is((select count(*) from public.card_tasks where person_id = 'cvp8'), 1::bigint,
  'a task already on the card with the same title, day and time is not made again');
select is((select assignee_id from public.card_tasks where person_id = 'cvp8'), 'cva', 'and the one that was there is untouched');
select is((select title || ' | ' || coalesce(assignee_id, '-') from public.card_tasks where person_id = 'cvpn'),
  'First meeting (MG1) | -', 'a prospect with no sponsor: a task with no assignee');
select is((select count(*) from public.card_tasks where person_id like 'cvp%' and done), 0::bigint, 'every made task is open');
select is((select count(*) from public.card_tasks where person_id like 'cvp%' and created_by is not null), 0::bigint,
  'and none names a creator (the migration made them)');
select is((select position from public.card_tasks where person_id = 'cvp1'), 0, 'a task made on an empty card is at position 0');

-- Customer mapping -----------------------------------------------------------
select is((select title || ' | ' || due_date::text || ' | ' || due_time::text || ' | ' || assignee_id
             from public.card_tasks where entry_id = 'cve1'),
  'First meeting | ' || (public.workspace_today('cvw') + 2)::text || ' | 14:00:00 | cva',
  'customer board: the column''s name there, the day, the time, the list owner as assignee');
select is((select title || ' | ' || due_date::text || ' | ' || coalesce(due_time::text, '-') from public.card_tasks where entry_id = 'cve2'),
  'Sampler | ' || (public.workspace_today('cvw') + 1)::text || ' | -', 'customer board: a leader step');
select is((select count(*) from public.card_tasks where entry_id = 'cve3'), 0::bigint, 'customer board: no booking, no task');
select is((select title || ' | ' || coalesce(due_date::text, '-') from public.card_tasks where entry_id = 'cve4'), 'On Ditto | -',
  'customer board: a booking without a day');
select is((select count(*) from public.card_tasks where workspace_id = 'cvw' and person_id is null and entry_id is null), 0::bigint,
  'every task is on one card');

-- Notes ------------------------------------------------------------------------
select is((select body || ' | ' || author_id from public.card_notes where person_id = 'cvp2'), 'Met at the gym | cva',
  'a note: its text trimmed, the owner as author');
select is((select n.created_at from public.card_notes n where n.person_id = 'cvp2'), now() - interval '3 days',
  'created when the card last changed (its updated_at), not when the conversion ran');
select is((select count(*) from public.card_notes where person_id = 'cvp6'), 0::bigint, 'a blank note makes nothing');
select is((select body from public.card_notes where person_id = 'cvp7'), 'Likes coffee', 'a card with only a note');
select is((select count(*) from public.card_notes where person_id = 'cvp8'), 1::bigint, 'the same note already on the card is not made again');
select is((select author_id from public.card_notes where person_id = 'cvp8'), 'cvl', 'and the one that was there is untouched');
select is((select coalesce(author_id, '-') from public.card_notes where person_id = 'cvpn'), '-', 'a prospect with no sponsor: a note with no author');
select is((select body || ' | ' || author_id from public.card_notes where entry_id = 'cve1'), 'Wants the sampler | cva',
  'customer board: its note, the list owner as author');
select is((select n.created_at from public.card_notes n where n.entry_id = 'cve1'), now() - interval '4 days',
  'customer board: created when the card last changed');
select is((select t.created_at || ' ' || t.updated_at from public.card_tasks t where t.entry_id = 'cve1'),
  (now() - interval '4 days') || ' ' || (now() - interval '4 days'), 'a made task is dated by its card''s updated_at too');

-- The old columns --------------------------------------------------------------
select is(pg_temp.old_state(), (select old_state from before),
  'pipeline_cards, customer_cards and pipeline_step_cancellations are byte-identical before and after');
select is((select count(*) from public.pipeline_cards where workspace_id = 'cvw' and next_column is not null), 7::bigint,
  'every booking is still stored');

-- A second run ------------------------------------------------------------------
select is(public.convert_card_followups(), jsonb_build_object('tasks', 0, 'notes', 0), 'a second run makes nothing');
select is((select count(*) from public.card_tasks where workspace_id = 'cvw'), (select tasks + r_bookings + c_bookings - 1 from before),
  'tasks are unchanged by the second run');
select is((select count(*) from public.card_notes where workspace_id = 'cvw'), (select notes + r_notes + c_notes - 1 from before),
  'notes are unchanged by the second run');
select is(pg_temp.old_state(), (select old_state from before), 'and the old columns are still identical');

-- A task you finish or delete does not come back: edit the made task, run again.
update public.card_tasks set done = true where person_id = 'cvp1';
select is(public.convert_card_followups(), jsonb_build_object('tasks', 0, 'notes', 0),
  'a made task that was ticked is not made again (same title and day)');
select is((select count(*) from public.card_tasks where person_id = 'cvp1'), 1::bigint, 'still one task on the card');

-- Nothing to convert -----------------------------------------------------------
update public.pipeline_cards set next_column = null, next_step_date = null, next_step_time = null, note = null where workspace_id = 'cvw';
update public.customer_cards set next_column = null, next_step_date = null, next_step_time = null, note = null where workspace_id = 'cvw';
delete from public.card_tasks where workspace_id = 'cvw';
delete from public.card_notes where workspace_id = 'cvw';
select is(public.convert_card_followups(), jsonb_build_object('tasks', 0, 'notes', 0),
  'a database with no bookings and no notes: nothing is made, nothing fails');

-- Access ------------------------------------------------------------------------
select is(has_function_privilege('authenticated', 'public.convert_card_followups()', 'execute'), false,
  'a signed-in person cannot run the conversion');
select is(has_function_privilege('anon', 'public.convert_card_followups()', 'execute'), false, 'nor can anon');

-- A booking that is still stored, on the next move ---------------------------------
-- The app no longer passes a booking to the move functions. A stored one is kept when the card moves to a column
-- before the booked one (or when the booked column is gone), and cleared when it moves to the booked column or
-- past it; the app never reads it either way.
update public.pipeline_cards set next_column = 'first_plan', next_step_date = public.workspace_today('cvw') + 2,
  next_step_time = time '10:00' where person_id = 'cvp1';
update public.pipeline_cards set next_column = 'first_plan', next_step_date = public.workspace_today('cvw') + 2
  where person_id = 'cvp2';
select set_config('role', 'postgres', true);
select set_config('request.jwt.claims', '', true);
insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-0000000cd001', 'authenticated', 'authenticated', 'cv-a@card.test');
insert into public.members (workspace_id, person_id, user_id, role) values ('cvw', 'cva', '00000000-0000-4000-8000-0000000cd001', 'member');
select set_config('role', 'authenticated', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-0000000cd001', 'role', 'authenticated',
  'aud', 'authenticated')::text, true);
select lives_ok($$select public.move_pipeline_card('cvp1', 'first_meeting', 'cv-mv-1')$$, 'a card with a stored booking moves with no booking passed');
select is((select next_column || ' ' || next_step_time::text from public.pipeline_cards where person_id = 'cvp1'), 'first_plan 10:00:00',
  'moving to a column before the booked one keeps the stored booking');
select lives_ok($$select public.move_pipeline_card('cvp1', 'first_plan', 'cv-mv-2')$$, 'it moves on into the booked column');
select is((select coalesce(next_column, '-') || ' ' || coalesce(next_step_date::text, '-') from public.pipeline_cards where person_id = 'cvp1'), '- -',
  'moving into the booked column clears the stored booking');
select lives_ok($$select public.move_pipeline_card('cvp2', 'registered', 'cv-mv-3')$$, 'a card moves past its booked column');
select is((select coalesce(next_column, '-') from public.pipeline_cards where person_id = 'cvp2'), '-', 'moving past it clears the stored booking too');
select is((select count(*) from public.card_tasks where workspace_id = 'cvw'), 0::bigint, 'and a move never makes a task');

select * from finish();
rollback;
