-- Invite an existing person to sign in to their own record (migration
-- 20261018000100_invite_existing_person): who may create a person-bound invite
-- (upline yes, leader and deputy yes, crossline no, candidate no, someone who
-- already signs in no, yourself no, customers no), one open invite per person
-- (a new one replaces it), what the anonymous preview reveals, and accepting:
-- the signed-in user is attached to the EXISTING person (no new people row,
-- sponsor, stage and history kept, member row updated or created), only by the
-- account whose email the inviter confirmed, never twice, never expired, never
-- by someone already on the team. Ordinary invites still create a new person.
--
-- Seed facts: sponsor line Maria (1, leader) -> Anita (2) -> Jamal (4) -> Tasha
-- (700); Imani Brooks (701) is an apprentice under Anita with a member row and
-- no login; Priya (8) is Maria's, so a crossline to Anita; Marcus (6) is Maria's
-- deputy; Beau (20) is a candidate; Carlos (9) is Jamal's prospect and has no
-- member row. Maria owns customer c1.
begin;
create extension if not exists pgtap with schema extensions;
select plan(92);

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
-- Sign in as an auth user that has no member row (the person being invited).
create function pg_temp.login_as_user(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
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
-- A confirmed (or not) auth user with the given email, created as postgres.
create function pg_temp.mk_user(p_uid text, p_email text, p_confirmed boolean default true) returns void language plpgsql as $$
begin
  insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at)
  values ('00000000-0000-0000-0000-000000000000', p_uid::uuid, 'authenticated', 'authenticated', p_email,
          case when p_confirmed then now() end);
end $$;
create function pg_temp.token(p_person text) returns text language sql as $$
  select token from public.invites where person_id = p_person and used_at is null
$$;

-- Shape ----------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'invites' and column_name = 'person_id'),
  'invites has person_id');
select ok((select is_nullable = 'YES' from information_schema.columns
           where table_schema = 'public' and table_name = 'invites' and column_name = 'sponsor_person_id'),
  'a person-bound invite may have no sponsor (a leader has none)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'invites_one_open_per_person_idx'),
  'at most one unused invite per person is a unique index');
select ok(has_function_privilege('authenticated', 'public.can_invite_person(text)', 'execute')
          and not has_function_privilege('anon', 'public.can_invite_person(text)', 'execute'),
  'only signed-in people can ask whether they may invite someone');
select ok(has_function_privilege('anon', 'public.get_invite(text)', 'execute')
          and has_function_privilege('authenticated', 'public.get_invite(text)', 'execute'),
  'anyone can still preview an invite');
select ok(has_function_privilege('authenticated', 'public.accept_invite(text)', 'execute')
          and not has_function_privilege('anon', 'public.accept_invite(text)', 'execute'),
  'only signed-in people accept an invite');

-- Who may create a person-bound invite --------------------------------------------------------
select pg_temp.login('2');
select lives_ok($$insert into public.invites (person_id, email) values ('701', 'imani@invite.test')$$,
  'Anita (upline) invites Imani, who is in her downline');
select is((select sponsor_person_id || '|' || stage || '|' || name || '|' || created_by || '|' || workspace_id
           from public.invites where person_id = '701'),
  '2|apprentice|Imani Brooks|2|w1', 'sponsor, stage and name come from the person; created by the inviter');
select is((select used_at is null and expires_at > now() + interval '13 days' and expires_at < now() + interval '15 days'
           from public.invites where person_id = '701'),
  true, 'open for 14 days');
-- Fields the client sends for sponsor and stage are replaced by the person's.
select lives_ok($$insert into public.invites (person_id, email, sponsor_person_id, stage, name)
                  values ('701', 'imani@invite.test', '4', 'ibo', 'Someone Else')$$,
  'a second invite for the same person');
select is((select count(*)::int from public.invites where person_id = '701' and used_at is null), 1,
  'the new invite replaced the previous unused one (one open invite per person)');
select is((select sponsor_person_id || '|' || stage || '|' || name from public.invites where person_id = '701'),
  '2|apprentice|Imani Brooks', 'the person''s sponsor, stage and name win over what was sent');
select throws_ok($$insert into public.invites (person_id) values ('701')$$, '23514', null,
  'a person-bound invite needs the confirmed email');
select throws_ok($$insert into public.invites (person_id, email) values ('8', 'priya@invite.test')$$,
  '42501', null, 'Anita cannot invite Priya: a crossline, not in her downline');
select throws_ok($$insert into public.invites (person_id, email) values ('4', 'jamal@invite.test')$$,
  '42501', null, 'Anita cannot invite Jamal: he already signs in');
select throws_ok($$insert into public.invites (person_id, email) values ('2', 'anita@invite.test')$$,
  '42501', null, 'nobody invites themselves');
select is(public.can_invite_person('701'), true, 'can_invite_person: yes for her downline');
select is(public.can_invite_person('8'), false, 'can_invite_person: no for a crossline');
select is(public.can_invite_person('4'), false, 'can_invite_person: no for someone who signs in');

-- A person added in the app has no member row; the upline still invites them.
insert into public.people (id, name, biz_class, pipeline_stage, sponsor_id, business_start_date)
values ('np1', 'Nora Pike', 'apprentice', 'apprentice', '2', current_date);
select is((select count(*)::int from public.members where person_id = 'np1'), 0,
  'a person added in the app has no member row');
select lives_ok($$insert into public.invites (person_id, email) values ('np1', 'nora@invite.test')$$,
  'Anita invites Nora, who has no member row');

-- The invite is visible to everyone who may invite the person, and withdrawn by them.
select pg_temp.login('1');
select is((select count(*)::int from public.invites where person_id = '701'), 1,
  'Maria (leader) sees the invite Anita made');
select lives_ok($$insert into public.invites (person_id, email) values ('701', 'imani@invite.test')$$,
  'Maria (leader) invites Imani');
select is((select created_by from public.invites where person_id = '701' and used_at is null), '1',
  'and her invite replaced Anita''s');
select pg_temp.login('2');
select is((select count(*)::int from public.invites where person_id = '701'), 1,
  'Anita sees the open invite Maria made for her downline');
select is(pg_temp.affected($$delete from public.invites where person_id = '701' and used_at is null$$), 1,
  'Anita withdraws it');
select is((select count(*)::int from public.invites where person_id = '701'), 0, 'gone');

select pg_temp.login('1');
select lives_ok($$insert into public.invites (person_id, email) values ('8', 'priya@invite.test')$$,
  'Maria invites Priya');
select throws_ok($$insert into public.invites (person_id, email)
                   values ((select id from public.people where biz_class = 'customer' and owner_id = '1' limit 1), 'c@invite.test')$$,
  '42501', null, 'a customer is never invited');
select throws_ok($$insert into public.invites (person_id, email) values ('1', 'maria@invite.test')$$,
  '42501', null, 'not even a leader invites themselves');
-- A leader has no sponsor: the invite for a person with none has none either (nobody but
-- the database owner can create one: a root person is visible to no one else).
insert into public.people (id, name, biz_class, pipeline_stage) values ('root1', 'Rhea Root', 'ibo', 'ibo');
select pg_temp.logout();
select lives_ok($$insert into public.invites (workspace_id, person_id, email) values ('w1', 'root1', 'rhea@invite.test')$$,
  'the table takes a person-bound invite for a person with no sponsor');
select is((select sponsor_person_id is null and stage = 'ibo' and name = 'Rhea Root' from public.invites where person_id = 'root1'), true,
  'which has no sponsor, and the person''s stage and name');
select throws_ok($$insert into public.invites (workspace_id, email) values ('w1', 'x@invite.test')$$, '23514', null,
  'but an invite always has a sponsor or a person');

select pg_temp.login('6');
select lives_ok($$insert into public.invites (person_id, email) values ('8', 'priya2@invite.test')$$,
  'Marcus, Maria''s deputy, invites Priya (acting as leader)');
select is((select created_by from public.invites where person_id = '8' and used_at is null), '6',
  'replacing Maria''s invite with his');

select pg_temp.login('4');
select lives_ok($$insert into public.invites (person_id, email) values ('9', 'carlos@invite.test')$$,
  'Jamal invites Carlos in his downline (the database has no stage rule; the app offers it to registered people)');
select throws_ok($$insert into public.invites (person_id, email) values ('7', 'sarah@invite.test')$$,
  '42501', null, 'Jamal cannot invite Sarah Kim, who is in another branch');

select pg_temp.login('20');
select throws_ok($$insert into public.invites (person_id, email) values ('20', 'beau@invite.test')$$,
  '42501', null, 'a candidate invites nobody');
select throws_ok($$insert into public.invites (person_id, email) values ('6', 'marcus@invite.test')$$,
  '42501', null, 'a candidate cannot invite someone they cannot see');
select is(public.can_invite_person('9'), false, 'can_invite_person: no for a candidate');

-- A crossline cannot read or withdraw someone else's person invite ------------------------
select pg_temp.login('2');
select is((select count(*)::int from public.invites where person_id in ('8', 'root1')), 0,
  'Anita sees no invites for people outside her downline');
select is(pg_temp.affected($$delete from public.invites where person_id = '8'$$), 0,
  'and withdraws none of them');

-- The anonymous preview ---------------------------------------------------------------------
select pg_temp.login('2');
select lives_ok($$insert into public.invites (person_id, email) values ('701', 'imani@invite.test')$$,
  'Anita invites Imani again');
select set_config('test.imani_token', pg_temp.token('701'), true);
select pg_temp.anon();
select is((select for_person from public.get_invite(current_setting('test.imani_token'))), true, 'the preview says it is for a person');
select is((select name || '|' || email || '|' || stage || '|' || workspace_name || '|' || is_valid::text
           from public.get_invite(current_setting('test.imani_token'))),
  'Imani Brooks|i***@invite.test|apprentice|Demo Team|true',
  'the preview shows the invitee''s own name and a masked email, not the address');
select is((select sponsor_name from public.get_invite(current_setting('test.imani_token'))), 'Anita Patel', 'and the sponsor''s name');

-- Accepting: only the confirmed address, onto the existing person -----------------------------
select pg_temp.logout();
-- The address matches whatever the case (Imani's account has capitals); an unconfirmed one does not count.
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000701', 'Imani@Invite.TEST');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000702', 'someone.else@invite.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000703', 'imani@invite.test', false);
create temp table before_counts as
  select (select count(*) from public.people) as people, (select count(*) from public.members) as members,
         (select stage_history from public.people where id = '701') as history;

select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000702');
select throws_ok($$select public.accept_invite(current_setting('test.imani_token'))$$, '42501',
  'This invite was sent to a different email address', 'a different account cannot claim the record');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000703');
select throws_ok($$select public.accept_invite(current_setting('test.imani_token'))$$, '42501',
  'Confirm your email address first', 'the right address, but not confirmed yet, cannot claim it');
select pg_temp.logout();
select is((select used_at is null from public.invites where person_id = '701'), true, 'the refused attempts did not use the invite');
select is((select user_id is null from public.members where person_id = '701'), true, 'nor sign anyone in');

select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000701');
select is(public.accept_invite(current_setting('test.imani_token')), '701',
  'the invited account accepts and gets the existing person''s id');
select pg_temp.logout();
select is((select (select count(*) from public.people) - people from before_counts), 0::bigint, 'no new people row');
select is((select (select count(*) from public.members) - members from before_counts), 0::bigint,
  'no new member row either: the existing one was used');
select is((select user_id::text from public.members where person_id = '701'), 'a0000000-0000-4000-8000-000000000701',
  'the member row now belongs to the signed-in user');
select is((select role from public.members where person_id = '701'), 'member', 'with the role it had');
select is((select sponsor_id || '|' || biz_class || '|' || pipeline_stage || '|' || name from public.people where id = '701'),
  '2|apprentice|apprentice|Imani Brooks', 'sponsor, stage and name are untouched');
select is((select stage_history from public.people where id = '701'), (select history from before_counts),
  'stage history is untouched');
select is((select email from public.people where id = '701'), 'imani@invite.test',
  'an empty email on the record is filled from the invite');
select is((select count(*)::int from public.activity
           where related_person_id = '701' and kind = 'created' and summary = 'Joined from an invite link'), 1,
  'the activity entry is the one an invite sign-up writes');
select is((select used_by::text from public.invites where person_id = '701'), 'a0000000-0000-4000-8000-000000000701',
  'the invite is marked used by that user');
select is(public.can_invite_person('701'), false, 'can_invite_person: not once they sign in');
select pg_temp.login('2');
select is(public.can_invite_person('701'), false, 'even for their upline, once they sign in');
select throws_ok($$insert into public.invites (person_id, email) values ('701', 'imani@invite.test')$$,
  '42501', null, 'so nobody can invite them again');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000701');
select is((select name from public.people where id = '701'), 'Imani Brooks',
  'as that user the app loads the existing record');
select is(public.current_person_id(), '701', 'and they are person 701');

-- Used, again ---------------------------------------------------------------------------------
select throws_ok($$select public.accept_invite(current_setting('test.imani_token'))$$, '22023',
  'This invite has already been used', 'a used invite cannot be used again');

-- A person with no member row: it is created -----------------------------------------------
select pg_temp.logout();
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000801', 'nora@invite.test');
update public.people set email = 'nora.old@example.com' where id = 'np1';
select set_config('test.nora_token', pg_temp.token('np1'), true);
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000801');
select is(public.accept_invite(current_setting('test.nora_token')), 'np1', 'Nora accepts');
select pg_temp.logout();
select is((select user_id::text || '|' || role from public.members where person_id = 'np1'),
  'a0000000-0000-4000-8000-000000000801|member', 'a member row was created for her');
select is((select email from public.people where id = 'np1'), 'nora.old@example.com',
  'an email already on the record is kept');
select ok(exists (select 1 from public.conversation_members where person_id = 'np1'),
  'she joined the team chats like any new member');

-- A person with no sponsor is claimed the same way.
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000802', 'rhea@invite.test');
select set_config('test.root1', pg_temp.token('root1'), true);
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000802');
select is(public.accept_invite(current_setting('test.root1')), 'root1', 'a person with no sponsor accepts');
select pg_temp.logout();
select is((select sponsor_id is null and user_id::text = 'a0000000-0000-4000-8000-000000000802'
           from public.people p join public.members m on m.person_id = p.id where p.id = 'root1'), true,
  'and keeps having none');

-- Expired, someone already on the team, a person who signs in elsewhere, a deleted person ---------
select pg_temp.login('2');
insert into public.people (id, name, biz_class, pipeline_stage, sponsor_id, business_start_date)
values ('np2', 'Pia Moss', 'apprentice', 'apprentice', '2', current_date),
       ('np3', 'Quin Ames', 'apprentice', 'apprentice', '2', current_date),
       ('np4', 'Rue Vale', 'apprentice', 'apprentice', '2', current_date),
       ('np5', 'Sol Dane', 'apprentice', 'apprentice', '2', current_date);
insert into public.invites (person_id, email) values
  ('np2', 'pia@invite.test'), ('np3', 'quin@invite.test'), ('np4', 'rue@invite.test'), ('np5', 'sol@invite.test');
select pg_temp.logout();
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000901', 'pia@invite.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000902', 'quin@invite.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000903', 'rue@invite.test');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000904', 'other.login@invite.test');
select set_config('test.np2', pg_temp.token('np2'), true);
select set_config('test.np3', pg_temp.token('np3'), true);
select set_config('test.np4', pg_temp.token('np4'), true);
select set_config('test.np5', pg_temp.token('np5'), true);

update public.invites set expires_at = now() - interval '1 day' where person_id = 'np2';
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000901');
select throws_ok($$select public.accept_invite(current_setting('test.np2'))$$, '22023',
  'This invite has expired', 'an expired invite is refused');
select pg_temp.anon();
select is((select is_valid from public.get_invite(current_setting('test.np2'))), false, 'and the preview says it is not valid');

-- Quin signs in elsewhere first (a member row with a user): the invite no longer applies.
select pg_temp.logout();
insert into public.members (workspace_id, person_id, user_id, role)
values ('w1', 'np3', 'a0000000-0000-4000-8000-000000000904', 'member');
select pg_temp.anon();
select is((select is_valid from public.get_invite(current_setting('test.np3'))), false,
  'the preview of an invite for a person who now signs in is not valid');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000902');
select throws_ok($$select public.accept_invite(current_setting('test.np3'))$$, '22023',
  'This person already has a sign-in', 'a person who already signs in cannot be claimed');

-- Someone already on the team cannot use a person invite (Jamal, whose email is not the invite's).
select pg_temp.login('4');
select throws_ok($$select public.accept_invite(current_setting('test.np4'))$$, '23505',
  'You are already a member of this team', 'a user already in the workspace is refused');

-- A person who was removed takes their invite with them.
select pg_temp.logout();
delete from public.people where id = 'np5';
select is((select count(*)::int from public.invites where person_id = 'np5'), 0, 'deleting the person deletes their invite');
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000905', 'sol@invite.test');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000905');
select throws_ok($$select public.accept_invite(current_setting('test.np5'))$$, 'P0002', 'Invite not found',
  'and the link no longer opens anything');

-- Undoing a registration withdraws the unused invite -------------------------------------------
select pg_temp.logout();
select is((select count(*)::int from public.invites where person_id = 'np4' and used_at is null), 1, 'Rue has an open invite');
update public.people set biz_class = 'prospect', pipeline_stage = 'prospect' where id = 'np4';
select is((select count(*)::int from public.invites where person_id = 'np4'), 0,
  'it is withdrawn when they go back to prospect');

-- Ordinary invites are unchanged ---------------------------------------------------------------
select pg_temp.login('2');
select lives_ok($$insert into public.invites (sponsor_person_id, stage, name, email)
                  values ('2', 'prospect', 'Olive New', 'olive@invite.test')$$,
  'an ordinary invite is created as before');
select is((select person_id is null from public.invites where name = 'Olive New'), true, 'with no person');
select throws_ok($$insert into public.invites (sponsor_person_id, stage) values ('8', 'prospect')$$,
  '42501', null, 'an ordinary invite still needs a sponsor you can see');
select pg_temp.login('20');
select throws_ok($$insert into public.invites (sponsor_person_id, stage) values ('20', 'prospect')$$,
  '42501', null, 'and a candidate still cannot create one');
select pg_temp.logout();
select set_config('test.olive', (select token from public.invites where name = 'Olive New'), true);
select pg_temp.mk_user('a0000000-0000-4000-8000-000000000a01', 'olive.signup@elsewhere.test');
create temp table before_ordinary as select (select count(*) from public.people) as people;
select pg_temp.anon();
select is((select for_person || '|' || name || '|' || email || '|' || stage from public.get_invite(current_setting('test.olive'))),
  'false|Olive New|olive@invite.test|prospect', 'the ordinary preview shows the name and email as before');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000a01');
create temp table olive as select public.accept_invite(current_setting('test.olive')) as id;
select pg_temp.logout();
select is((select (select count(*) from public.people) - people from before_ordinary), 1::bigint,
  'accepting an ordinary invite creates one new person');
select is((select p.name || '|' || p.sponsor_id || '|' || p.biz_class || '|' || p.pipeline_stage || '|' || p.email
           from public.people p where p.id = (select id from olive)),
  'Olive New|2|prospect|prospect|olive@invite.test', 'under the sponsor, at the invited stage, with the invite''s email');
select is((select jsonb_array_length(stage_history) from public.people where id = (select id from olive)), 1,
  'with one stage-history entry');
select is((select m.user_id::text || '|' || m.role from public.members m where m.person_id = (select id from olive)),
  'a0000000-0000-4000-8000-000000000a01|member', 'and a member row for the user');
select is((select count(*)::int from public.activity
           where related_person_id = (select id from olive) and summary = 'Joined from an invite link'), 1,
  'and the same activity entry');
select pg_temp.login_as_user('a0000000-0000-4000-8000-000000000a01');
select throws_ok($$select public.accept_invite(current_setting('test.olive'))$$, '22023',
  'This invite has already been used', 'an ordinary invite works once');

select * from finish();
rollback;
