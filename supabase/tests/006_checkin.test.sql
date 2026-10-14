-- Automatic conversation check-in: messages both ways within 24 hours in a
-- DM (or replies both ways in a group) record one contact per direction with
-- source 'message', at most once per pair per local day, and notify both.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

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
create function pg_temp.pair_contacts(a text, b text) returns integer language sql as $$
  select count(*)::int from public.contacts
  where source = 'message'
    and ((person_id = a and by_id = b) or (person_id = b and by_id = a))
$$;

-- DM: Jamal writes Sarah, Sarah answers
select pg_temp.login('4');
-- Clients open the DM first (create_dm), then post into it.
select public.create_dm('7');
insert into public.messages (conversation_id, body) values (public.create_dm('7'), 'Hey Sarah, got your ticket yet?');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '7'), 0, 'one direction is not a conversation');

select pg_temp.login('7');
insert into public.messages (conversation_id, body) values (public.create_dm('4'), 'Buying it tonight!');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '7'), 2, 'messages both ways within 24 hours log exactly two contacts');
select is((select count(*)::int from public.contacts
           where source = 'message' and person_id = '7' and by_id = '4' and date = public.workspace_today('w1')), 1,
  'a contact for Sarah by Jamal, dated today in the team''s time zone');
select is((select count(*)::int from public.contacts where source = 'message' and person_id = '4' and by_id = '7'), 1,
  'and one for Jamal by Sarah');
select is((select array_agg(recipient_id order by recipient_id) from public.notifications
           where type = 'checkin_logged' and conversation_id in (select conversation_id from public.conversation_members where person_id = '7')
             and recipient_id in ('4', '7')),
  array['4', '7'], 'both people get a checkin_logged notification');

-- More messages the same day: no duplicates
select pg_temp.login('4');
insert into public.messages (conversation_id, body) values (public.create_dm('7'), 'Great, see you there');
select pg_temp.logout();
select pg_temp.login('7');
insert into public.messages (conversation_id, body) values (public.create_dm('4'), 'See you!');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '7'), 2, 'at most once per pair per day');

-- One-way DM: never counts
select pg_temp.login('4');
select public.create_dm('11');
insert into public.messages (conversation_id, body) values (public.create_dm('11'), 'Tom?');
insert into public.messages (conversation_id, body) values (public.create_dm('11'), 'You there?');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '11'), 0, 'messages in one direction only never count');

-- Group: a plain post and a single reply are one direction; replies both ways count
select pg_temp.login('8');
insert into public.messages (id, conversation_id, body) values ('t-g1', 'main', 'Anyone free Saturday?');
select pg_temp.logout();
select pg_temp.login('4');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-g2', 'main', 'I am!', 't-g1');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '8'), 0, 'a single reply in a group is one direction');

select pg_temp.login('8');
insert into public.messages (id, conversation_id, body, reply_to_id) values ('t-g3', 'main', 'Great, let''s meet at 10', 't-g2');
select pg_temp.logout();
select is(pg_temp.pair_contacts('4', '8'), 2, 'replies both ways in a group log a check-in');

-- A plain message to everyone never counts
select pg_temp.login('6');
insert into public.messages (conversation_id, body) values ('main', 'hey everyone');
select pg_temp.logout();
select is((select count(*)::int from public.contacts where source = 'message' and (person_id = '6' or by_id = '6')), 0,
  'one "hey" to everyone is not a check-in');

select * from finish();
rollback;
