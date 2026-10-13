-- What the app's supabase mode relies on (migration 20261013000100_client_sync):
-- pinned messages, message removal, announcement / event-post notifications,
-- mute, group admin hand-over, client-chosen ids, event card totals.
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

-- Pinned messages -------------------------------------------------------------------
select is((select pinned_message_id from public.conversations where id = 'high-signal'), 'hs0',
  'the seed pins the home-meeting guide in High signal');

-- David (3) is the carpool admin; Steve (7) becomes a moderator there.
select pg_temp.login('3');
update public.conversation_members set role = 'moderator' where conversation_id = 'carpool' and person_id = '7';
select pg_temp.logout();

select pg_temp.login('4');
update public.conversations set pinned_message_id = 'cp1' where id = 'carpool';
select pg_temp.logout();
select is((select pinned_message_id from public.conversations where id = 'carpool'), null,
  'plain group members cannot pin');

select pg_temp.login('7');
select lives_ok($$update public.conversations set pinned_message_id = 'cp2' where id = 'carpool'$$,
  'group moderators pin');
select throws_ok($$update public.conversations set title = 'Renamed' where id = 'carpool'$$,
  '42501', 'Only the chat admin edits this chat', 'group moderators cannot rename the group');
select pg_temp.logout();
select is((select pinned_message_id from public.conversations where id = 'carpool'), 'cp2',
  'the moderator''s pin is saved');

select pg_temp.login('4');
select lives_ok($$update public.conversations set pinned_message_id = 'd24a' where id = 'dm-2-4'$$,
  'either DM member pins');
select pg_temp.logout();
select is((select pinned_message_id from public.conversations where id = 'dm-2-4'), 'd24a', 'the DM pin is saved');

select pg_temp.login('2');
select throws_ok($$update public.conversations set pinned_message_id = 'mc1' where id = 'high-signal'$$,
  '23514', 'Pin a message from this chat', 'only a message of the same chat can be pinned');
select pg_temp.logout();

-- Removing a message removes its content, reactions, mentions and pin ---------------------
select pg_temp.login('4');
insert into public.messages (id, conversation_id, body) values ('t-m1', 'main', 'Hi @Anita Patel');
insert into public.mentions (message_id, person_id) values ('t-m1', '2');
select pg_temp.logout();
select pg_temp.login('2');
insert into public.reactions (message_id, emoji) values ('t-m1', '🔥');
select pg_temp.logout();
select pg_temp.login('4');
update public.messages set deleted_at = now() where id = 't-m1';
select pg_temp.logout();
select is((select count(*)::int from public.reactions where message_id = 't-m1')
          + (select count(*)::int from public.mentions where message_id = 't-m1'), 0,
  'a removed message loses its reactions and mentions');

select pg_temp.login('1');
update public.messages set deleted_at = now() where id = 'hs0';
select pg_temp.logout();
select is((select pinned_message_id from public.conversations where id = 'high-signal'), null,
  'removing the pinned message unpins it');

-- Announcements notify the whole chat ------------------------------------------------------
select pg_temp.login('2');
insert into public.messages (id, conversation_id, body) values ('t-ann', 'announcements', 'Meeting moved to 8pm');
select pg_temp.logout();
select is((select count(*)::int from public.notifications where message_id = 't-ann' and type = 'announcement_posted'),
          (select count(*)::int - 1 from public.conversation_members where conversation_id = 'announcements'),
  'an announcement notifies everyone else in Announcements');
select is((select count(*)::int from public.notifications where message_id = 't-ann' and recipient_id = '2'), 0,
  'the author is not notified of their own announcement');

select pg_temp.login('2');
insert into public.messages (id, conversation_id, body) values ('t-ann2', 'announcements', '@Jamal Brown great work');
insert into public.mentions (message_id, person_id) values ('t-ann2', '4');
select pg_temp.logout();
select is((select array_agg(type) from public.notifications where message_id = 't-ann2' and recipient_id = '4'),
  array['mention'], 'a mentioned member gets one notification, as a mention');

-- Muted chats don't notify replies ----------------------------------------------------------
select is((select muted from public.conversation_members where conversation_id = 'high-signal' and person_id = '1'), true,
  'Maria has High signal on mentions only');
select pg_temp.login('4');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-hsr', 'high-signal', 'Will do', 'hs1');
select pg_temp.logout();
select is((select count(*)::int from public.notifications where message_id = 't-hsr' and recipient_id = '1' and type = 'reply'), 0,
  'a reply in a muted chat does not notify');
select pg_temp.login('2');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-mcr', 'main', 'Same here', 'mc2');
select pg_temp.logout();
select is((select type from public.notifications where message_id = 't-mcr' and recipient_id = '3'), 'reply',
  'a reply in an unmuted chat still notifies');

-- Answering an event card tells its author --------------------------------------------------
select pg_temp.login('4');
select isnt(public.answer_event_post('hs2'), null, 'answering an event card notifies its author');
select lives_ok($$select public.answer_event_post('hs2')$$, 'answering again is fine');
select throws_ok($$select public.answer_event_post('hs1')$$, '22023', null, 'only event cards can be answered');
select pg_temp.logout();
select is((select count(*)::int from public.notifications
           where type = 'event_post' and message_id = 'hs2' and actor_id = '4'), 1,
  'one event_post per person per post (a new answer replaces the old one)');
select is((select ref_id || ':' || recipient_id from public.notifications
           where type = 'event_post' and message_id = 'hs2' and actor_id = '4'), 'e1:1',
  'the notification points at the event and goes to the author');

select pg_temp.login('20');
select throws_ok($$select public.answer_event_post('hs2')$$, 'P0002', null, 'non-members cannot answer');
select pg_temp.logout();

-- A group keeps an admin -----------------------------------------------------------------------
select pg_temp.login('3');
delete from public.conversation_members where conversation_id = 'carpool' and person_id = '3';
select pg_temp.logout();
select is((select role from public.conversation_members where conversation_id = 'carpool' and person_id = '7'), 'admin',
  'when the admin leaves, the moderator becomes admin');

-- Client-chosen ids ------------------------------------------------------------------------------
select pg_temp.login('4');
select is(public.create_dm('13', 't-dm'), 't-dm', 'a new DM takes the id the app chose');
select is(public.create_dm('13'), 't-dm', 'the one-argument create_dm finds it');
select is(public.create_dm('2', 'dm-x'), 'dm-2-4', 'an existing DM keeps its id');
insert into public.announcement_drafts (id, conversation_id, body) values ('t-d', 'announcements', 'Bowling Friday');
select pg_temp.logout();

select pg_temp.login('1');
select is(public.approve_announcement('t-d', 't-approved'), 't-approved', 'an approved post takes the id the app chose');
select pg_temp.logout();
select is((select author_id from public.messages where id = 't-approved'), '4', 'and is posted as the author');

-- Event card totals (whole team, no identities) ---------------------------------------------------
select set_config('t.bought', (select count(*)::text from public.attendances where event_id = 'e1' and has_ticket), true);
select pg_temp.login('20');
select is((select bought::text from public.event_rsvp_counts() where event_id = 'e1'), current_setting('t.bought'),
  'event card totals count the whole team, even for someone who sees only themselves');
select pg_temp.logout();

select * from finish();
rollback;
