-- Schema contract, RLS coverage, realtime, storage policies and retention.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Act as a person: gives them a local auth user (and links their member row)
-- if they have none yet, then switches to the authenticated role.
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

-- Row-level security everywhere ---------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 0,
  'row-level security is on for every public table');

-- Chat data contract (field for field) ---------------------------------------------
select columns_are('public', 'members', array['workspace_id', 'person_id', 'role', 'user_id', 'joined_at']);
select columns_are('public', 'conversations', array['id', 'workspace_id', 'kind', 'title', 'description', 'icon', 'pinned', 'retention_days', 'created_by', 'created_at', 'pinned_message_id']);
select columns_are('public', 'conversation_members', array['conversation_id', 'person_id', 'role', 'last_read_at', 'muted', 'joined_at']);
select columns_are('public', 'messages', array['id', 'conversation_id', 'author_id', 'body', 'reply_to_id', 'card', 'created_at', 'edited_at', 'deleted_at']);
select columns_are('public', 'attachments', array['id', 'message_id', 'kind', 'storage_path', 'mime', 'size', 'duration_ms', 'width', 'height']);
select columns_are('public', 'reactions', array['message_id', 'person_id', 'emoji', 'created_at']);
select columns_are('public', 'mentions', array['message_id', 'person_id']);
select columns_are('public', 'announcement_drafts', array['id', 'conversation_id', 'author_id', 'body', 'card', 'status', 'reviewer_id', 'reviewed_at', 'created_at']);
select columns_are('public', 'notifications', array['id', 'recipient_id', 'type', 'actor_id', 'conversation_id', 'message_id', 'ref_id', 'created_at', 'read_at']);
select columns_are('public', 'reports', array['id', 'message_id', 'reporter_id', 'reason', 'created_at', 'resolved_at', 'resolved_by']);
select columns_are('public', 'blocks', array['blocker_id', 'blocked_id', 'created_at']);
select columns_are('public', 'library_items', array['id', 'workspace_id', 'kind', 'title', 'duration_sec', 'url', 'created_by', 'created_at']);
select has_column('public', 'contacts', 'source', 'contacts gained source');

-- Realtime ---------------------------------------------------------------------------
select set_eq(
  $$select tablename::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'$$,
  array['messages', 'reactions', 'notifications', 'conversation_members', 'announcement_drafts',
        'conversations', 'attachments', 'mentions', 'reports'],
  'realtime publishes the chat tables the app follows live');

-- Functions not meant for clients ------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.purge_expired_messages()', 'execute'),
  'clients cannot run the retention purge');
select ok(not has_function_privilege('anon', 'public.create_dm(text)', 'execute'), 'anon cannot call create_dm');
select ok(has_function_privilege('anon', 'public.get_invite(text)', 'execute'), 'anon can preview an invite');
select ok(exists (select 1 from cron.job where jobname = 'purge-expired-messages'), 'the retention purge runs nightly (pg_cron)');

-- Storage ----------------------------------------------------------------------------
select is((select public from storage.buckets where id = 'chat-media'), false, 'chat-media is private');
select is((select public from storage.buckets where id = 'library'), false, 'library is private');

select pg_temp.login('4');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('chat-media', 'main/t-msg/photo.jpg', auth.uid()::text)$$,
  'members upload media into their conversation''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('chat-media', 'dm-1-2/t-msg/photo.jpg')$$,
  '42501', null, 'nobody uploads into a conversation they are not in');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('library', 'w1/talk.m4a')$$,
  '42501', null, 'members do not upload to the library');
select pg_temp.logout();

select pg_temp.login('20');
select is((select count(*)::int from storage.objects where bucket_id = 'chat-media'), 0, 'Beau reads no chat media');
select pg_temp.logout();

select pg_temp.login('2');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('library', 'w1/new-talk.m4a')$$,
  'moderators upload to the library');
select pg_temp.logout();

select pg_temp.login('1');
select is((select count(*)::int from storage.objects where bucket_id = 'library'), 1, 'members read the library');
select pg_temp.logout();

-- Retention ----------------------------------------------------------------------------
update public.conversations set retention_days = 7 where id = 'dm-1-7';
insert into public.messages (id, conversation_id, author_id, body, created_at)
values ('t-old', 'dm-1-7', '1', 'old news', now() - interval '8 days');
select ok(public.purge_expired_messages() >= 1, 'the purge deletes expired messages');
select is((select count(*)::int from public.messages where id = 't-old'), 0, 'messages past retention are gone');

select * from finish();
rollback;
