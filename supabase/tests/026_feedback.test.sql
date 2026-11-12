-- In-app feedback (migration 20261016002500_feedback): the `feedback` table and
-- the private `feedback` bucket. Members send reports as themselves, read only
-- their own; app admins read everything and change only the status.
--
-- Seed facts: Maria (1) is the leader; Anita (2) a moderator; Jamal (4) is
-- Anita's; Beau (20) is a candidate; Admin Tester (800) is the admin login
-- (app_admins). No feedback is seeded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

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

-- Schema -----------------------------------------------------------------------------
select has_table('public', 'feedback', 'feedback exists');
select columns_are('public', 'feedback',
  array['id', 'workspace_id', 'person_id', 'message', 'context', 'screenshot_path', 'status', 'created_at']);
select is((select public from storage.buckets where id = 'feedback'), false, 'the feedback bucket is private');

-- Sending: a member, as themselves ----------------------------------------------------
select pg_temp.login('4');
select lives_ok($$insert into public.feedback (id, message, context, screenshot_path)
  values ('00000000-0000-4000-9000-000000000004', 'Make the board columns wider',
          '{"path": "/pipeline", "theme": "light"}',
          'w1/00000000-0000-4000-9000-000000000004.jpg')$$,
  'a member sends feedback with a snapshot path');
select is((select person_id from public.feedback), '4', 'it is theirs by default (sender)');
select is((select workspace_id from public.feedback), 'w1', 'and in their workspace');
select is((select status from public.feedback), 'new', 'it starts as new');
select throws_ok($$insert into public.feedback (person_id, message) values ('2', 'as Anita')$$,
  '42501', null, 'nobody sends feedback as someone else');
select throws_ok($$insert into public.feedback (workspace_id, message) values ('w2', 'elsewhere')$$,
  '42501', null, 'nobody sends feedback into another workspace');
select throws_ok($$insert into public.feedback (message, status) values ('already done', 'done')$$,
  '42501', null, 'a sender cannot set the status');
select throws_ok($$insert into public.feedback (message) values ('   ')$$,
  '23514', null, 'an empty message is refused');
select throws_ok($$insert into public.feedback (message) values (repeat('x', 2001))$$,
  '23514', null, 'a message over 2000 characters is refused');
select lives_ok($$insert into public.feedback (message) values (repeat('x', 2000))$$,
  'exactly 2000 characters is fine (no snapshot, no context)');
select throws_ok($$insert into public.feedback (message, screenshot_path) values ('hi', 'w2/other.jpg')$$,
  '23514', null, 'the snapshot must be in the sender''s workspace folder');
select throws_ok($$insert into public.feedback (message, context) values ('hi', '[1]')$$,
  '23514', null, 'the context is a JSON object');
select pg_temp.logout();

select pg_temp.login('20');
select lives_ok($$insert into public.feedback (id, message) values ('00000000-0000-4000-9000-000000000020', 'A candidate has a request too')$$,
  'a candidate sends feedback as well');
select pg_temp.logout();

-- Reading: your own only ----------------------------------------------------------------
select pg_temp.login('4');
select is((select count(*)::int from public.feedback), 2, 'Jamal reads his own two reports');
select is((select count(*)::int from public.feedback where person_id <> '4'), 0, 'and nobody else''s');
select is(pg_temp.affected($$update public.feedback set status = 'done'$$), 0,
  'a sender cannot close their own report');
select throws_ok($$update public.feedback set message = 'edited'$$, '42501', null,
  'a sender cannot edit the text');
select throws_ok($$delete from public.feedback$$, '42501', null, 'a sender cannot delete a report');
select pg_temp.login('2');
select is((select count(*)::int from public.feedback), 0, 'his upline reads none of them');
select pg_temp.login('1');
select is((select count(*)::int from public.feedback), 0, 'neither does the leader');
select pg_temp.login('20');
select is((select count(*)::int from public.feedback), 1, 'Beau reads only his own');
select pg_temp.logout();
select ok(not has_table_privilege('anon', 'public.feedback', 'select'), 'signed-out visitors read nothing');
select ok(not has_table_privilege('anon', 'public.feedback', 'insert'), 'and send nothing');

-- App admins: read all, change the status only ---------------------------------------------
select pg_temp.login('800');
select is((select count(*)::int from public.feedback), 3, 'the admin reads every report');
select is(pg_temp.affected($$update public.feedback set status = 'done' where id = '00000000-0000-4000-9000-000000000004'$$), 1,
  'the admin marks a report done');
select is((select status from public.feedback where id = '00000000-0000-4000-9000-000000000004'), 'done', 'it stays done');
select is(pg_temp.affected($$update public.feedback set status = 'new' where id = '00000000-0000-4000-9000-000000000004'$$), 1,
  'and reopens it');
select throws_ok($$update public.feedback set status = 'later'$$, '23514', null, 'only new and done are statuses');
select throws_ok($$update public.feedback set message = 'edited'$$, '42501', null, 'the admin cannot edit text either');
select throws_ok($$delete from public.feedback$$, '42501', null, 'nobody deletes reports through the API');
select pg_temp.logout();

-- Storage: the private bucket -------------------------------------------------------------
select pg_temp.login('4');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id)
  values ('feedback', 'w1/00000000-0000-4000-9000-000000000004.jpg', auth.uid()::text)$$,
  'a member uploads a snapshot into their workspace folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id)
  values ('feedback', 'w2/elsewhere.jpg', auth.uid()::text)$$,
  '42501', null, 'but not into another workspace''s folder');
select is((select count(*)::int from storage.objects where bucket_id = 'feedback'), 1, 'the sender reads their own snapshot');
select is((select count(*)::int from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'feedback:%'
             and cmd in ('UPDATE', 'DELETE', 'ALL')), 0,
  'and nobody replaces or removes a snapshot through the API (no update or delete policy)');
select pg_temp.login('2');
select is((select count(*)::int from storage.objects where bucket_id = 'feedback'), 0, 'nobody else on the team reads it');
select pg_temp.login('800');
select is((select count(*)::int from storage.objects where bucket_id = 'feedback'), 1, 'an app admin reads every snapshot');
select pg_temp.logout();

select * from finish();
rollback;
