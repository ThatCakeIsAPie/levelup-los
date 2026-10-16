-- Event types and missed-event notes (migration 20261014001000_event_types).
-- The types are event categories since 20261016002000_event_categories (more
-- in 025_event_categories); the six became the starting categories 'w1-<type>'.
--
-- Seed facts (src/data/seed.ts): Tasha (700) is Jamal's (4) apprentice, Jamal
-- is Anita's (2), Anita is Maria's (1). David (3) is Maria's too, a crossline
-- of Anita's team. Beau (20) is a candidate. Night Owls no5 was two days ago;
-- Layla (14, Priya's) has a note on it by Priya (8): mn1. a6 is Marcus's
-- virtual ticket for e1 (it was a "stream" ticket).
begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

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

-- Schema and migrated data ---------------------------------------------------------
select has_column('public', 'events', 'format', 'events say how people join');
select has_column('public', 'attendances', 'mode', 'attendance says in person or virtual');
select hasnt_column('public', 'attendances', 'ticket_type', 'ticket_type was renamed to mode');
select has_table('public', 'missed_event_notes', 'missed_event_notes exists');
select is((select count(*)::int from public.events where category_id not in
  (select id from public.event_categories where id like 'w1-%')), 0,
  'every event has one of the six starting categories');
select is((select category_id from public.events where id = 'e4'), 'w1-monthly_meeting',
  'team meetings are monthly team meetings');
select is((select mode from public.attendances where id = 'a6'), 'virtual',
  'stream tickets are virtual tickets');
select is((select count(*)::int from public.events where category_id = 'w1-night_owls'), 7,
  'the recurring Night Owls are seeded');

-- Types and formats ------------------------------------------------------------------
select pg_temp.login('1');
select throws_ok($$insert into public.events (name, category_id, date) values ('X', 'w1-team_meeting', current_date)$$,
  '23514', null, 'the old team_meeting type is gone');
select lives_ok($$insert into public.events (id, name, category_id, date, format) values
  ('t-no', 'X', 'w1-night_owls', current_date, 'virtual'),
  ('t-ws', 'X', 'w1-work_session', current_date, 'both')$$,
  'an online format on an in-person-only category is accepted…');
select is((select string_agg(format, ',' order by id) from public.events where id in ('t-no', 't-ws')),
  'in_person,in_person', '…and kept in person (Night Owls and work sessions)');
select lives_ok($$insert into public.events (id, name, category_id, date, format) values ('t-tr', 'Training', 'w1-training', current_date, 'both')$$,
  'a training can be in person and virtual');
select is((select format from public.events where id = 'no1'), 'in_person',
  'format defaults to in person');
select throws_ok($$update public.attendances set mode = 'stream' where id = 'a6'$$,
  '23514', null, 'stream is no longer a mode');

-- Uplines log attendance for their downline, crosslines can't ----------------------
select pg_temp.login('4');
select lives_ok($$insert into public.attendances (id, event_id, person_id, attended, mode)
  values ('t-att-1', 'no5', '700', true, 'in_person')$$,
  'Jamal logs that Tasha came');
select pg_temp.login('3');
select throws_ok($$insert into public.attendances (id, event_id, person_id, attended, mode)
  values ('t-att-2', 'no4', '4', true, 'in_person')$$,
  '42501', null, 'David can''t log attendance for Anita''s team');

-- Missed-event notes: written by uplines only ---------------------------------------
select pg_temp.login('4');
insert into public.missed_event_notes (id, person_id, event_id, note, by_id, created_at)
values ('t-note-1', '700', 'no5', 'Talked at the gym, she was sick', '1', now() - interval '9 days');
select is((select by_id from public.missed_event_notes where id = 't-note-1'), '4',
  'the author is stamped by the database');
select ok((select created_at > now() - interval '1 minute' from public.missed_event_notes where id = 't-note-1'),
  'so is the time');

select pg_temp.login('2');
select lives_ok($$insert into public.missed_event_notes (id, person_id, event_id, note) values ('t-note-2', '700', 'no5', 'Called her too')$$,
  'Anita, further up, writes one too');
select throws_ok($$insert into public.missed_event_notes (person_id, event_id, note) values ('2', 'no5', 'Me')$$,
  '42501', null, 'nobody writes one about themselves');

select pg_temp.login('700');
select throws_ok($$insert into public.missed_event_notes (person_id, event_id, note) values ('4', 'ws2', 'Jamal was busy')$$,
  '42501', null, 'a downline doesn''t write one about their upline');

select pg_temp.login('3');
select throws_ok($$insert into public.missed_event_notes (person_id, event_id, note) values ('700', 'no5', 'Crossline')$$,
  '42501', null, 'a crossline doesn''t write one');

select pg_temp.login('4');
select throws_ok($$insert into public.missed_event_notes (person_id, event_id, note) values ('700', 'no5', '   ')$$,
  '23514', null, 'a note has text');

-- Reading: anyone who can see the person ------------------------------------------------
select pg_temp.login('1');
select is((select count(*)::int from public.missed_event_notes where person_id in ('700', '14')), 3,
  'Maria reads the notes about Tasha and Layla');
select pg_temp.login('700');
select is((select count(*)::int from public.missed_event_notes where person_id = '700'), 2,
  'Tasha reads the notes about herself');
select pg_temp.login('3');
select is((select count(*)::int from public.missed_event_notes), 0,
  'David (crossline) reads none of them');
select pg_temp.login('20');
select is((select count(*)::int from public.missed_event_notes), 0, 'Beau reads none');

-- Removing: the author only ------------------------------------------------------------
select pg_temp.login('2');
select is(pg_temp.affected($$delete from public.missed_event_notes where id = 't-note-1'$$), 0,
  'Anita can''t remove Jamal''s note');
select pg_temp.login('4');
select is(pg_temp.affected($$delete from public.missed_event_notes where id = 't-note-1'$$), 1,
  'Jamal removes his own note');
select is(pg_temp.affected($$update public.missed_event_notes set note = 'Edited' where id = 't-note-2'$$), 0,
  'notes aren''t edited');

select pg_temp.logout();
select * from finish();
rollback;
