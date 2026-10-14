-- Chat eligibility, DM privacy (leaders included) and the DM rule with blocks.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

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

-- Eligibility ------------------------------------------------------------------
select ok(public.chat_eligible('1'), 'the leader chats');
select ok(public.chat_eligible('2'), 'an IBO chats');
select ok(public.chat_eligible('4'), 'an apprentice chats');
select ok(not public.chat_eligible('20'), 'a candidate (prospect with an account) does not chat');
select ok(not public.chat_eligible('c1'), 'customers do not chat');
select is(public.effective_biz_class('apprentice', current_date - 400), 'ibo',
  'an apprentice past one year counts as an IBO (effectiveBizClass)');
select is(public.effective_biz_class('apprentice', current_date - 100), 'apprentice',
  'an apprentice inside the first year stays an apprentice');

-- Beau (candidate) reads nothing ----------------------------------------------
select pg_temp.login('20');
select is((select count(*)::int from public.conversations), 0, 'Beau sees no chats');
select is((select count(*)::int from public.messages), 0, 'Beau reads no messages');
select is((select count(*)::int from public.chat_directory), 0, 'Beau gets no chat directory');
select throws_ok($$select public.create_dm('1')$$, '42501', null, 'Beau cannot start a DM');
select throws_ok($$insert into public.conversations (kind, title) values ('group', 'Beau group')$$,
  '42501', null, 'Beau cannot create a group');
select pg_temp.logout();

-- A prospect with an account and a stray membership row still reads nothing --
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000009',
        'authenticated', 'authenticated', 'carlos@levelup.test');
insert into public.members (workspace_id, person_id, user_id)
values ('w1', '9', '00000000-0000-4000-8000-000000000009');
insert into public.conversation_members (conversation_id, person_id) values ('main', '9');
select pg_temp.login('9');
select is((select count(*)::int from public.messages), 0,
  'a prospect cannot read chats even with a membership row');
select throws_ok($$insert into public.messages (conversation_id, body) values ('main', 'hi')$$,
  '42501', null, 'a prospect cannot post');
select pg_temp.logout();

-- Nobody reads a DM they are not in, leaders included ---------------------------
select pg_temp.login('1');
select is((select count(*)::int from public.conversations where id = 'dm-2-4'), 0,
  'the leader cannot see the Anita-Jamal DM');
select is((select count(*)::int from public.messages where conversation_id = 'dm-2-4'), 0,
  'the leader cannot read its messages');
select throws_ok($$insert into public.conversation_members (conversation_id, person_id) values ('dm-2-4', '1')$$,
  '42501', null, 'the leader cannot add herself to it');
with u as (update public.messages set deleted_at = now() where conversation_id = 'dm-2-4' returning 1)
select is(count(*)::int, 0, 'the leader cannot remove messages in it') from u;
select pg_temp.logout();

select pg_temp.login('4');
select is((select count(*)::int from public.messages where conversation_id = 'dm-2-4'), 2,
  'Jamal reads his own DM with Anita');
select ok((select count(*)::int from public.chat_directory) > 30, 'chat users get the member directory');

-- DM rule: both eligible, share a chat, no block either way ----------------------
select ok(public.can_dm('4', '7'), 'Jamal can DM Sarah (they share the team chats)');
select is(public.create_dm('7'), public.create_dm('7'), 'create_dm returns the existing DM the second time');
select is((select count(*)::int from public.conversation_members where conversation_id = public.create_dm('7')), 2,
  'a DM has exactly two members');
select throws_ok($$insert into public.conversations (kind, title) values ('dm', null)$$,
  '42501', null, 'DMs are only created through create_dm');
select ok(not public.can_dm('1', '7'), 'can_dm only answers about pairs that include the caller');
select throws_ok($$select public.create_dm('9')$$, '42501', null, 'nobody DMs a prospect');
select pg_temp.logout();

-- An eligible member who shares no chat with Jamal
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date)
values ('t-loner', 'w1', 'Lone Member', 'apprentice', '4', current_date);
insert into public.members (workspace_id, person_id) values ('w1', 't-loner');
delete from public.conversation_members where person_id = 't-loner';

select pg_temp.login('4');
select throws_ok($$select public.create_dm('t-loner')$$, '42501',
  'You can only message people you share a chat with', 'no DM without a shared chat');
select lives_ok($$insert into public.blocks (blocked_id) values ('11')$$, 'Jamal blocks Tom');
select throws_ok($$select public.create_dm('11')$$, '42501', null, 'no new DM with someone you blocked');
select pg_temp.logout();

select pg_temp.login('11');
select throws_ok($$select public.create_dm('4')$$, '42501', null, 'no new DM with someone who blocked you');
select is((select count(*)::int from public.blocks), 0, 'the blocked person never sees the block');
select pg_temp.logout();

-- Blocked after the DM exists: no more posting in it
select pg_temp.login('7');
insert into public.blocks (blocked_id) values ('4');
select pg_temp.logout();
select pg_temp.login('4');
select throws_ok($$insert into public.messages (conversation_id, body) values (public.create_dm('7'), 'hello?')$$,
  '42501', null, 'nobody posts in a DM after being blocked');
select pg_temp.logout();

select * from finish();
rollback;
