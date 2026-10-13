-- Workspace isolation: a second team's rows are invisible and unreachable.
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

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

-- A second workspace with its own leader (person 901) and member (902)
insert into public.workspaces (id, name) values ('w2', 'Other team');
insert into public.people (id, workspace_id, name, biz_class, business_start_date)
values ('901', 'w2', 'Olivia Other', 'ibo', current_date - 900);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, business_start_date)
values ('902', 'w2', 'Oscar Other', 'apprentice', '901', current_date - 100);
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000901',
        'authenticated', 'authenticated', 'olivia@other.test');
insert into public.members (workspace_id, person_id, user_id, role)
values ('w2', '901', '00000000-0000-4000-8000-000000000901', 'leader'), ('w2', '902', null, 'member');
insert into public.conversations (id, workspace_id, kind, title, created_by)
values ('w2-main', 'w2', 'main', 'Main chat', '901');
insert into public.messages (id, conversation_id, author_id, body) values ('w2-m1', 'w2-main', '901', 'Hello team two');
insert into public.events (id, workspace_id, name, type, date) values ('w2-e1', 'w2', 'Other event', 'conference', current_date + 5);
insert into public.contacts (workspace_id, person_id, by_id) values ('w2', '902', '901');
insert into public.library_items (id, workspace_id, kind, title, url) values ('w2-lib', 'w2', 'audio', 'Other talk', 'w2/talk.m4a');

-- Maria (leader of w1) sees none of it
select pg_temp.login('1');
select is((select count(*)::int from public.workspaces), 1, 'Maria sees only her own workspace');
select is((select count(*)::int from public.people where workspace_id = 'w2'), 0, 'no people of another workspace');
select is((select count(*)::int from public.members where workspace_id = 'w2'), 0, 'no members of another workspace');
select is((select count(*)::int from public.events where id = 'w2-e1'), 0, 'no events of another workspace');
select is((select count(*)::int from public.contacts where workspace_id = 'w2'), 0, 'no contacts of another workspace');
select is((select count(*)::int from public.conversations where workspace_id = 'w2'), 0, 'no chats of another workspace');
select is((select count(*)::int from public.messages where id = 'w2-m1'), 0, 'no messages of another workspace');
select is((select count(*)::int from public.library_items where workspace_id = 'w2'), 0, 'no library of another workspace');
select throws_ok($$insert into public.people (workspace_id, name, biz_class, sponsor_id) values ('w2', 'Sneaky', 'prospect', '901')$$,
  '42501', null, 'nobody writes into another workspace');
select throws_ok($$select public.create_dm('901')$$, '42501', null, 'no DMs across workspaces');
select throws_ok($$insert into public.blocks (blocked_id) values ('901')$$, '42501', null, 'no blocks across workspaces');
select pg_temp.logout();

-- Olivia (leader of w2) sees only her team
select pg_temp.login('901');
select is(array(select id from public.people order by id), array['901', '902'], 'the other leader sees only her own team');
select is((select count(*)::int from public.events), 1, 'only her workspace''s events');
select is(array(select id from public.conversations), array['w2-main'], 'only her workspace''s chats');
select is((select count(*)::int from public.messages), 1, 'only her workspace''s messages');
select is((select count(*)::int from public.library_items), 1, 'only her workspace''s library');
select is((select count(*)::int from public.notifications), 0, 'no notifications from another workspace');
select is((select count(*)::int from public.chat_directory where workspace_id = 'w1'), 0, 'no directory entries from another workspace');
select throws_ok($$insert into public.attendances (event_id, person_id) values ('e1', '902')$$,
  '42501', null, 'no attendance rows on another workspace''s event');
select pg_temp.logout();

select * from finish();
rollback;
