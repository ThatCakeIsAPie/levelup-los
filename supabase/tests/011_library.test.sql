-- Library (migration 20261013000300_library): catalog, channels, progress.
-- Visibility per role, who may share and edit, own-row progress, the
-- learning-log trigger (once per person and item), locked "IBOs and leaders"
-- teasers, the name list and the private `library` bucket.
--
-- Seed facts (src/data/library/seed.ts): lib-1 (team, Maria's audio), lib-2
-- (team document, 4 pages), lib-21 (team audio talk), lib-28 (IBOs and
-- leaders), lib-35 (Anita's downline). Channels: developing-leaders (IBOs and
-- leaders, 6 lessons), booking-the-first-meeting (Anita's downline).
-- Jamal (4) is under Anita (2) under Maria (1); Beau (20) is a candidate.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

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
create function pg_temp.sees_item(p_id text) returns boolean language sql as $$
  select exists (select 1 from public.library_items where id = p_id)
$$;
create function pg_temp.sees_channel(p_id text) returns boolean language sql as $$
  select exists (select 1 from public.library_channels where id = p_id)
$$;

-- Schema -------------------------------------------------------------------------
select columns_are('public', 'library_items', array['id', 'workspace_id', 'title', 'description',
  'kind', 'source', 'storage_path', 'mime', 'size_bytes', 'file_name', 'link_url', 'link_provider',
  'duration_sec', 'page_count', 'format', 'event_id', 'recorded_on', 'created_by',
  'permission_confirmed', 'visibility', 'created_at', 'updated_at']);
select columns_are('public', 'library_item_speakers', array['item_id', 'position', 'person_id', 'name']);
select columns_are('public', 'library_item_topics', array['item_id', 'topic_id']);
select columns_are('public', 'library_topics', array['id', 'workspace_id', 'name', 'created_by', 'created_at']);
select columns_are('public', 'library_channels', array['id', 'workspace_id', 'title', 'description',
  'icon', 'color', 'created_by', 'visibility', 'created_at', 'updated_at']);
select columns_are('public', 'library_channel_sections', array['id', 'channel_id', 'position', 'title']);
select columns_are('public', 'library_channel_items', array['section_id', 'item_id', 'channel_id', 'position']);
select columns_are('public', 'library_progress', array['person_id', 'item_id', 'workspace_id',
  'position_sec', 'completed_at', 'logged_at', 'updated_at']);
select is((select count(*)::int from public.learning where id like 'library:%'), 0,
  'the seed logs nothing again (finished seed rows carry logged_at)');

-- Visibility ------------------------------------------------------------------------
select pg_temp.login('4');
select ok(pg_temp.sees_item('lib-1'), 'Jamal sees team talks');
select ok(pg_temp.sees_item('lib-35'), 'Jamal sees his upline Anita''s downline talks');
select ok(not pg_temp.sees_item('lib-28'), 'Jamal (apprentice) does not see IBO-only talks');
select ok(pg_temp.sees_channel('booking-the-first-meeting'), 'Jamal sees Anita''s downline channel');
select ok(not pg_temp.sees_channel('developing-leaders'), 'Jamal can''t open the IBO-only channel');
select is(array(select id from public.library_channel_teasers()), array['developing-leaders'],
  'but it is listed to him locked');
select is((select lesson_count from public.library_channel_teasers()), 6, 'with its lesson count');
select is((select count(*)::int from public.library_channel_items where channel_id = 'developing-leaders'), 0,
  'and none of its lessons');
select is((select count(*)::int from public.library_item_speakers where item_id = 'lib-28'), 0,
  'speakers of hidden talks stay hidden');
select pg_temp.logout();

select pg_temp.login('20');
select ok(pg_temp.sees_item('lib-1'), 'Beau (candidate) sees team talks');
select ok(not pg_temp.sees_item('lib-35'), 'Beau does not see Anita''s downline talks');
select ok(not pg_temp.sees_item('lib-28'), 'Beau does not see IBO-only talks');
select ok(exists (select 1 from public.library_people where person_id = '1' and name = 'Maria Reyes'),
  'Beau gets the names of the speakers he can hear');
select pg_temp.logout();

select pg_temp.login('1');
select ok(pg_temp.sees_item('lib-28'), 'Maria (leader) sees IBO-only talks');
select ok(not pg_temp.sees_item('lib-35'), 'Maria is upline of Anita: Anita''s downline talks are not for her');
select is((select count(*)::int from public.library_channel_teasers()), 0, 'no locked channels for a leader');
select pg_temp.logout();

select pg_temp.login('3');
select ok(pg_temp.sees_channel('developing-leaders'), 'David (IBO) opens the IBO-only channel');
select pg_temp.logout();

-- Sharing and editing ----------------------------------------------------------------
select pg_temp.login('4');
select throws_ok($$insert into public.library_items (id, title, kind, source, link_url, created_by, permission_confirmed, visibility)
  values ('t-jt', 'Team talk', 'video', 'link', 'https://youtu.be/abcdefghijk', '4', true, 'team')$$,
  '42501', null, 'Jamal can''t share with the whole team');
select lives_ok($$insert into public.library_items (id, title, kind, source, link_url, created_by, permission_confirmed, visibility)
  values ('t-jd', 'Downline talk', 'video', 'link', 'https://youtu.be/abcdefghijk', '4', true, 'downline')$$,
  'Jamal shares with his own downline');
select throws_ok($$insert into public.library_items (id, title, kind, source, link_url, created_by, permission_confirmed, visibility)
  values ('t-jp', 'No permission', 'video', 'link', 'https://youtu.be/abcdefghijk', '4', false, 'downline')$$,
  '23514', null, 'every item needs "I have permission to share this"');
select throws_ok($$update public.library_items set visibility = 'team' where id = 't-jd'$$,
  '42501', null, 'Jamal can''t widen his talk to the whole team');
select lives_ok($$insert into public.library_channels (id, title, created_by, visibility) values ('t-jc', 'My downline', '4', 'downline')$$,
  'Jamal creates a channel for his downline');
select lives_ok($$insert into public.library_channel_sections (id, channel_id, position) values ('t-jcs', 't-jc', 0)$$,
  'and a section in it');
select lives_ok($$insert into public.library_channel_items (section_id, item_id, channel_id, position) values ('t-jcs', 't-jd', 't-jc', 0)$$,
  'and puts his talk in it');
select throws_ok($$insert into public.library_channel_items (section_id, item_id, channel_id, position) values ('t-jcs', 'lib-28', 't-jc', 1)$$,
  '42501', null, 'but not a talk he can''t see');
update public.library_items set title = 'Hacked' where id = 'lib-1';
select throws_ok($$insert into public.library_topics (name) values ('Jamal topic')$$,
  '42501', null, 'only leaders and moderators add topics');
select pg_temp.logout();
select is((select title from public.library_items where id = 'lib-1'), 'Inviting without pressure',
  'Jamal can''t edit Maria''s talk');

select pg_temp.login('20');
select throws_ok($$insert into public.library_channels (title, created_by, visibility) values ('Beau channel', '20', 'downline')$$,
  '42501', null, 'candidates don''t create channels');
select pg_temp.logout();

select pg_temp.login('2');
update public.library_items set title = 'Inviting without pressure (edited)' where id = 'lib-1';
select lives_ok($$insert into public.library_topics (name) values ('Prospecting')$$, 'moderators add topics');
select pg_temp.logout();
select is((select title from public.library_items where id = 'lib-1'), 'Inviting without pressure (edited)',
  'a moderator edits anyone''s talk');

-- Progress and the learning log ------------------------------------------------------
select pg_temp.login('4');
select is((select count(*)::int from public.library_progress where person_id <> '4'), 0,
  'Jamal reads only his own progress');
select throws_ok($$insert into public.library_progress (person_id, item_id, position_sec) values ('1', 'lib-1', 10)$$,
  '42501', null, 'nobody writes someone else''s progress');
select throws_ok($$insert into public.library_progress (person_id, item_id, position_sec) values ('4', 'lib-28', 10)$$,
  '42501', null, 'no progress on talks you can''t see');
select lives_ok($$insert into public.library_progress (person_id, item_id, position_sec) values ('4', 'lib-21', 300)$$,
  'Jamal saves where he is in a talk');
select is((select count(*)::int from public.learning where id = 'library:lib-21:4'), 0, 'starting logs nothing');
select lives_ok($$update public.library_progress set position_sec = 1100, completed_at = now() where person_id = '4' and item_id = 'lib-21'$$,
  'finishing it');
select is((select kind || ' ' || amount::int || ' ' || title from public.learning where id = 'library:lib-21:4'),
  'podcast 1 Your first five customers', 'logs a podcast to his learning');
select isnt((select logged_at from public.library_progress where person_id = '4' and item_id = 'lib-21'), null,
  'and marks the row as logged');
update public.library_progress set completed_at = null where person_id = '4' and item_id = 'lib-21';
update public.library_progress set completed_at = now() where person_id = '4' and item_id = 'lib-21';
select is((select count(*)::int from public.learning where id like 'library:lib-21:%'), 1,
  'finishing again never logs twice');
update public.library_progress set logged_at = null where person_id = '4' and item_id = 'lib-21';
select isnt((select logged_at from public.library_progress where person_id = '4' and item_id = 'lib-21'), null,
  'clients can''t clear logged_at');
select lives_ok($$insert into public.library_progress (person_id, item_id, completed_at, logged_at) values ('4', 'lib-2', now(), now())$$,
  '"Mark as done" on a document (a client-sent logged_at is ignored)');
select is((select kind || ' ' || amount::int from public.learning where id = 'library:lib-2:4'), 'pages 4',
  'documents log their pages');
select pg_temp.logout();

-- Storage ---------------------------------------------------------------------------
select is((select file_size_limit from storage.buckets where id = 'library'), 209715200::bigint,
  'library uploads up to 200 MB');
select pg_temp.login('2');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('library', 'w1/lib-35/booking.m4a', auth.uid()::text)$$,
  'Anita uploads a file for her downline talk');
select pg_temp.logout();
select pg_temp.login('4');
select is((select count(*)::int from storage.objects where bucket_id = 'library' and name = 'w1/lib-35/booking.m4a'), 1,
  'Jamal (her downline) can read it');
select pg_temp.logout();
select pg_temp.login('20');
select is((select count(*)::int from storage.objects where bucket_id = 'library'), 0,
  'Beau can''t read files of talks he can''t see');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('library', 'w1/x/beau.m4a')$$,
  '42501', null, 'candidates don''t upload to the library');
select pg_temp.logout();
select pg_temp.login('1');
select is((select count(*)::int from storage.objects where bucket_id = 'library'), 0,
  'Maria can''t read files of talks not shared with her');
select pg_temp.logout();

select * from finish();
rollback;
