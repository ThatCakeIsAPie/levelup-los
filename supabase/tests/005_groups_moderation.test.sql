-- Group chats (creator is admin), message removal rights, reports -> leaders,
-- mention / reply / reaction notifications.
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

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

-- Jamal creates a group and runs it
select pg_temp.login('4');
select lives_ok($$insert into public.conversations (id, kind, title) values ('t-group', 'group', 'Prospect follow-ups')$$,
  'any eligible member creates a group');
select is((select role from public.conversation_members where conversation_id = 't-group' and person_id = '4'), 'admin',
  'the creator becomes its admin');
select throws_ok($$insert into public.conversations (kind, title, pinned) values ('group', 'Pinned?', true)$$,
  '42501', null, 'members cannot pin a chat');
select lives_ok($$insert into public.conversation_members (conversation_id, person_id) values ('t-group', '7'), ('t-group', '11')$$,
  'the admin adds people');
select throws_ok($$insert into public.conversation_members (conversation_id, person_id) values ('t-group', '9')$$,
  '42501', null, 'prospects cannot be added to a chat');
select lives_ok($$update public.conversation_members set role = 'moderator' where conversation_id = 't-group' and person_id = '7'$$,
  'the admin makes Sarah a moderator');
select lives_ok($$insert into public.messages (id, conversation_id, body) values ('t-m1', 't-group', 'Kickoff')$$,
  'the admin posts');
select pg_temp.logout();

-- Tom, a plain member of the group
select pg_temp.login('11');
select lives_ok($$insert into public.messages (id, conversation_id, body) values ('t-m2', 't-group', 'Hi from Tom')$$,
  'members post in their group');
select throws_ok($$update public.conversation_members set role = 'admin' where conversation_id = 't-group' and person_id = '11'$$,
  '42501', 'Only the chat admin changes roles', 'members cannot change roles');
with u as (update public.messages set deleted_at = now() where id = 't-m1' returning 1)
select is(count(*)::int, 0, 'a member cannot remove someone else''s message') from u;
select lives_ok($$update public.messages set body = 'Hi from Tom (edited)' where id = 't-m2'$$, 'authors edit their message');
select ok((select edited_at is not null from public.messages where id = 't-m2'), 'editing stamps edited_at');
select pg_temp.logout();

-- Sarah, the group's moderator, removes Tom's message
select pg_temp.login('7');
with u as (update public.messages set deleted_at = now() where id = 't-m2' returning 1)
select is(count(*)::int, 1, 'a group moderator removes a message') from u;
select pg_temp.logout();
select is((select body from public.messages where id = 't-m2'), '', 'a removed message keeps no text');

-- Workspace moderator in a team chat
select pg_temp.login('2');
with u as (update public.messages set deleted_at = now() where id = 'mc3' returning 1)
select is(count(*)::int, 1, 'a workspace moderator removes spam in Main chat') from u;
select throws_ok($$update public.messages set body = 'rewritten' where id = 'mc5'$$,
  '42501', null, 'moderators remove but never rewrite others'' messages');
select pg_temp.logout();

select pg_temp.login('4');
with u as (update public.messages set deleted_at = now() where id = 'mc5' returning 1)
select is(count(*)::int, 0, 'members cannot remove others'' messages in Main chat') from u;

-- Reports notify the leaders (and only leaders see them)
select lives_ok($$insert into public.reports (id, message_id, reason) values ('t-report', 'mc4', 'Off topic')$$,
  'members report a message');
select pg_temp.logout();
select is((select array_agg(recipient_id) from public.notifications where type = 'report' and ref_id = 't-report'),
  array['1'], 'a report notifies every workspace leader');
select pg_temp.login('2');
select is((select count(*)::int from public.reports where id = 't-report'), 0, 'moderators do not see reports');
select pg_temp.logout();
select pg_temp.login('1');
select is((select count(*)::int from public.reports where id = 't-report'), 1, 'leaders see reports');
select pg_temp.logout();

-- Replies, mentions and reactions notify
select pg_temp.login('4');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-reply', 'high-signal', '@Maria Reyes thanks!', 'hs4');
insert into public.mentions (message_id, person_id) values ('t-reply', '1');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-reply2', 'high-signal', 'Love this talk', 'hs5');
insert into public.reactions (message_id, emoji) values ('mc4', '👍');
select pg_temp.logout();

select is((select array_agg(type) from public.notifications where message_id = 't-reply' and recipient_id = '1' and type in ('mention', 'reply')),
  array['mention'], 'a reply that also mentions notifies once, as a mention');
select is((select type from public.notifications where message_id = 't-reply2' and recipient_id = '2'), 'reply',
  'a reply notifies the quoted author');
select is((select count(*)::int from public.notifications where type = 'reaction' and message_id = 'mc4' and recipient_id = '13'), 1,
  'a reaction notifies the message author');

select * from finish();
rollback;
