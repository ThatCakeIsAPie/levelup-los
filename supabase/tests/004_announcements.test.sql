-- Announcements: members draft, leaders/moderators post and approve.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

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

-- A member drafts instead of posting
select pg_temp.login('4');
select throws_ok($$insert into public.messages (conversation_id, body) values ('announcements', 'Hi all')$$,
  '42501', null, 'members cannot post to Announcements directly');
select lives_ok($$insert into public.announcement_drafts (id, conversation_id, body) values ('t-draft', 'announcements', 'Team BBQ Saturday')$$,
  'members draft an announcement');
select is((select count(*)::int from public.announcement_drafts), 1, 'members see only their own drafts');
select throws_ok($$select public.approve_announcement('t-draft')$$, '42501', null, 'members cannot approve');
select pg_temp.logout();

select is((select array_agg(recipient_id order by recipient_id) from public.notifications
           where type = 'announcement_draft' and ref_id = 't-draft'),
          array['1', '2'], 'a draft notifies the leader and the moderator');

-- The moderator posts directly and sees every pending draft
select pg_temp.login('2');
select lives_ok($$insert into public.messages (conversation_id, body) values ('announcements', 'Moderator post')$$,
  'moderators post to Announcements directly');
select is((select count(*)::int from public.announcement_drafts where status = 'pending'), 2,
  'reviewers see every pending draft (Sarah''s and Jamal''s)');
select pg_temp.logout();

-- The leader approves: the post appears as the author's
select pg_temp.login('1');
select isnt(public.approve_announcement('t-draft'), null, 'the leader approves the draft');
select lives_ok($$insert into public.messages (conversation_id, body) values ('announcements', 'Leader post')$$,
  'leaders post without approval');
select pg_temp.logout();

select is((select author_id from public.messages where conversation_id = 'announcements' and body = 'Team BBQ Saturday'), '4',
  'the approved post appears as Jamal''s');
select is((select status || ':' || reviewer_id from public.announcement_drafts where id = 't-draft'), 'approved:1',
  'the draft records the approval and reviewer');
select is((select count(*)::int from public.notifications
           where type = 'announcement_posted' and recipient_id = '4' and ref_id = 't-draft'), 1,
  'the author is told it was posted');
select is((select count(*)::int from public.notifications
           where type = 'announcement_draft' and ref_id = 't-draft' and read_at is null), 0,
  'the reviewers'' draft notifications are cleared');

select pg_temp.login('1');
select throws_ok($$select public.approve_announcement('t-draft')$$, '22023', null, 'a draft is approved only once');
select lives_ok($$select public.reject_announcement('draft-1')$$, 'the leader rejects Sarah''s draft');
select pg_temp.logout();

select is((select status from public.announcement_drafts where id = 'draft-1'), 'rejected', 'the draft is marked rejected');

select * from finish();
rollback;
