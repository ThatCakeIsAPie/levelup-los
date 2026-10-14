-- Personal chat pins (migration 20261013000200_chat_pins): conversation_members.pinned_at.
-- Team chats start pinned for everyone; each person pins and unpins only their
-- own rows; at most 10 pins per tab (groups / direct messages).
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

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
create function pg_temp.pinned(p_conv text, p_person text) returns boolean language sql as $$
  select pinned_at is not null from public.conversation_members
  where conversation_id = p_conv and person_id = p_person
$$;

-- Schema and seed -----------------------------------------------------------------------
select col_type_is('public', 'conversation_members', 'pinned_at', 'timestamp with time zone',
  'conversation_members.pinned_at is a timestamptz');
select is((select count(*)::int from public.conversation_members cm
           join public.conversations c on c.id = cm.conversation_id
           where c.pinned and cm.pinned_at is null), 0,
  'every member of a team chat starts with it pinned');
select is((select count(*)::int from public.conversation_members cm
           join public.conversations c on c.id = cm.conversation_id
           where not c.pinned and cm.pinned_at is not null), 0,
  'side groups and DMs start unpinned');

-- New memberships of a team chat start pinned (the team-chat triggers add everyone).
insert into public.conversations (id, workspace_id, kind, title, pinned, created_by)
values ('t-team', 'w1', 'group', 'Test team group', true, '1');
select ok((select count(*) from public.conversation_members where conversation_id = 't-team') > 1
          and not exists (select 1 from public.conversation_members
                          where conversation_id = 't-team' and pinned_at is null),
  'a new team chat is pinned for every member it gets');

-- Your own pins -------------------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$update public.conversation_members set pinned_at = null
                  where conversation_id = 'main' and person_id = '1'$$,
  'Maria unpins Main chat for herself');
select lives_ok($$update public.conversation_members set pinned_at = now()
                  where conversation_id = 'carpool' and person_id = '1'$$,
  'Maria pins a side group');
select lives_ok($$update public.conversation_members set pinned_at = now()
                  where conversation_id = 'dm-1-2' and person_id = '1'$$,
  'Maria pins a DM');
select pg_temp.logout();
select is(pg_temp.pinned('main', '1'), false, 'Main chat is unpinned for Maria');
select is(pg_temp.pinned('main', '4'), true, '... and still pinned for Jamal');
select is(pg_temp.pinned('carpool', '1'), true, 'the carpool pin is saved');
select is(pg_temp.pinned('carpool', '4'), false, '... only for Maria');
select is(pg_temp.pinned('dm-1-2', '2'), false, 'Maria''s DM pin does not pin it for Anita');

-- Nobody pins for someone else ------------------------------------------------------------
-- Maria (leader) may edit roles in team chats, but not other people's pins.
select pg_temp.login('1');
select throws_ok($$update public.conversation_members set pinned_at = null
                   where conversation_id = 'high-signal' and person_id = '4'$$,
  '42501', 'Read state, mute and pins are personal', 'a leader cannot unpin a team chat for someone');
-- In a DM the other person's row isn't writable at all.
update public.conversation_members set pinned_at = now()
where conversation_id = 'dm-1-2' and person_id = '2';
select pg_temp.logout();
select is(pg_temp.pinned('dm-1-2', '2'), false, 'Maria cannot pin a DM for Anita');

select pg_temp.login('4');
update public.conversation_members set pinned_at = null
where conversation_id = 'high-signal' and person_id = '1';
select pg_temp.logout();
select is(pg_temp.pinned('high-signal', '1'), true, 'Jamal cannot unpin a chat for Maria');

-- David (3) is the carpool admin.
select pg_temp.login('3');
select throws_ok($$update public.conversation_members set pinned_at = now()
                   where conversation_id = 'carpool' and person_id = '4'$$,
  '42501', 'Read state, mute and pins are personal', 'a group admin cannot pin the group for a member');
insert into public.conversation_members (conversation_id, person_id, role, pinned_at)
values ('carpool', '6', 'member', now());
select pg_temp.logout();
select is(pg_temp.pinned('carpool', '6'), false, 'adding someone to a group never pins it for them');

-- At most 10 pins per tab ------------------------------------------------------------------
-- Jamal: 4 team chats pinned (+ t-team above = 5). Five more groups make 10.
insert into public.conversations (id, workspace_id, kind, title, created_by)
select 't-g' || i, 'w1', 'group', 'Group ' || i, '4' from generate_series(1, 6) i;
select is((select count(*)::int from public.conversation_members
           where person_id = '4' and conversation_id like 't-g%' and pinned_at is null), 6,
  'Jamal''s new groups start unpinned');
select pg_temp.login('4');
select lives_ok($$update public.conversation_members set pinned_at = now()
                  where person_id = '4' and conversation_id in ('t-g1', 't-g2', 't-g3', 't-g4', 't-g5')$$,
  'Jamal pins up to 10 groups');
select throws_ok($$update public.conversation_members set pinned_at = now()
                   where person_id = '4' and conversation_id = 't-g6'$$,
  '23514', 'You can pin up to 10 chats here', 'an 11th group pin is refused');
select lives_ok($$update public.conversation_members set pinned_at = now()
                  where person_id = '4' and conversation_id = 'dm-2-4'$$,
  'DMs have their own 10 pins');
select pg_temp.logout();
select is((select count(*)::int from public.conversation_members cm
           join public.conversations c on c.id = cm.conversation_id
           where cm.person_id = '4' and c.kind <> 'dm' and cm.pinned_at is not null), 10,
  'Jamal has exactly 10 pinned groups');

select * from finish();
rollback;
