-- Renameable pipeline stages (migration 20261017000100_stage_names): a person
-- reads and writes only their own names; the stage key must be one of the
-- pipeline's four and the name 1 to 30 trimmed characters; and
-- effective_stage_names() gives, per pipeline and stage, the caller's own name,
-- else the nearest upline's, else nothing.
--
-- Seed facts: sponsor line Maria (1) -> Anita (2) -> Jamal (4) -> Tasha (700);
-- Marcus (6) is Maria's, David (3) too; Beau (20) is a candidate. No stage
-- names are seeded.
begin;
create extension if not exists pgtap with schema extensions;
select plan(56);

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
-- The name the caller sees for a stage ("name|from" or "none").
create function pg_temp.seen(p_pipeline text, p_stage text, p_own boolean default true) returns text
language sql as $$
  select coalesce((select e.name || '|' || e.from_person_id
                   from public.effective_stage_names(p_own) e
                   where e.pipeline = p_pipeline and e.stage_key = p_stage), 'none')
$$;

select has_table('public', 'stage_names', 'stage_names exists');
select columns_are('public', 'stage_names',
  array['person_id', 'workspace_id', 'pipeline', 'stage_key', 'name', 'updated_at'],
  'one row per person, pipeline and stage');
select ok((select relrowsecurity from pg_class where oid = 'public.stage_names'::regclass),
  'row-level security is on');
select ok(has_function_privilege('authenticated', 'public.effective_stage_names(boolean)', 'execute'),
  'signed-in people can call effective_stage_names');
select ok(not has_function_privilege('anon', 'public.effective_stage_names(boolean)', 'execute'),
  'anon cannot');

-- Your own names ------------------------------------------------------------------------
select pg_temp.login('4');
insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'contact', 'Intro');
select is((select person_id || '|' || workspace_id from public.stage_names), '4|w1',
  'a name is yours and your workspace''s by default');
select is(pg_temp.affected($$update public.stage_names set name = 'Hello' where pipeline = 'recruiting' and stage_key = 'contact'$$), 1,
  'you change your own name');
select is((select name from public.stage_names where stage_key = 'contact'), 'Hello', 'as given');
update public.stage_names set updated_at = '2020-01-01' where stage_key = 'contact';
select ok((select updated_at > now() - interval '1 minute' from public.stage_names where stage_key = 'contact'),
  'a change stamps when it happened');
-- The same stage on the other pipeline is a separate row.
insert into public.stage_names (pipeline, stage_key, name) values ('customer', 'contact', 'Reach out');
select is((select count(*)::int from public.stage_names), 2, 'both pipelines can name "contact"');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('customer', 'contact', 'Again')$$,
  '23505', null, 'one name per person, pipeline and stage');
insert into public.stage_names (pipeline, stage_key, name) values ('customer', 'contact', 'Again')
  on conflict (person_id, pipeline, stage_key) do update set name = excluded.name;
select is((select name from public.stage_names where pipeline = 'customer' and stage_key = 'contact'), 'Again',
  'saving again (upsert) replaces it');

-- Stage keys and names are checked -----------------------------------------------------------
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_sale', 'X')$$,
  '23514', null, 'first_sale is not a recruiting stage');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('customer', 'first_plan', 'X')$$,
  '23514', null, 'first_plan is not a customer stage');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('customer', 'registered', 'X')$$,
  '23514', null, 'registered is not a customer stage');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'on_ditto', 'X')$$,
  '23514', null, 'on_ditto is not a recruiting stage');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'not_a_stage', 'X')$$,
  '23514', null, 'unknown stage key');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('sales', 'contact', 'X')$$,
  '23514', null, 'unknown pipeline');
select throws_ok($$update public.stage_names set stage_key = 'on_ditto' where pipeline = 'recruiting'$$,
  '23514', null, 'a row can''t be moved to a key its pipeline doesn''t have');
select lives_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_meeting', repeat('x', 30))$$,
  '30 characters is fine');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', repeat('x', 31))$$,
  '23514', null, '31 characters is too long');
select throws_ok($$update public.stage_names set name = repeat('y', 40) where stage_key = 'first_meeting'$$,
  '23514', null, 'an update can''t make it too long either');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', '')$$,
  '23514', null, 'not empty (clear a name by deleting the row)');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', '   ')$$,
  '23514', null, 'not blank');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', ' padded ')$$,
  '23514', null, 'trimmed');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', E'two\nlines')$$,
  '23514', null, 'no line breaks');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'first_plan', NULL)$$,
  '23502', null, 'a name is required');

-- Nobody else's ----------------------------------------------------------------------------
select throws_ok($$insert into public.stage_names (person_id, pipeline, stage_key, name) values ('1', 'recruiting', 'registered', 'X')$$,
  '42501', null, 'you can''t name stages for your upline');
select throws_ok($$insert into public.stage_names (person_id, pipeline, stage_key, name) values ('700', 'recruiting', 'registered', 'X')$$,
  '42501', null, 'or your downline');
select throws_ok($$update public.stage_names set person_id = '1' where stage_key = 'contact' and pipeline = 'recruiting'$$,
  '42501', null, 'a row can''t be handed to someone else');
select is(pg_temp.affected($$delete from public.stage_names where pipeline = 'customer'$$), 1,
  'you delete your own row (back to the inherited name)');
select pg_temp.logout();

-- Others' rows are invisible and untouchable
insert into public.stage_names (person_id, workspace_id, pipeline, stage_key, name) values
  ('1', 'w1', 'recruiting', 'contact', 'Top contact'),
  ('1', 'w1', 'recruiting', 'first_meeting', 'Top meeting'),
  ('1', 'w1', 'customer', 'contact', 'Top customer contact'),
  ('2', 'w1', 'recruiting', 'contact', 'Mid contact'),
  ('700', 'w1', 'customer', 'on_ditto', 'Tasha subscribed');
select pg_temp.login('4');
select is((select count(*)::int from public.stage_names where person_id <> '4'), 0,
  'you don''t read your upline''s or your downline''s rows');
select is(pg_temp.affected($$update public.stage_names set name = 'Hacked' where person_id <> '4'$$), 0,
  'or change them');
select is(pg_temp.affected($$delete from public.stage_names where person_id <> '4'$$), 0,
  'or delete them');
select pg_temp.logout();
select is((select count(*)::int from public.stage_names where name = 'Hacked'), 0, 'and nothing was changed');

-- A candidate has no pipeline
select pg_temp.login('20');
select throws_ok($$insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'contact', 'X')$$,
  '42501', null, 'a candidate has no pipeline to rename');
select pg_temp.logout();

-- effective_stage_names(): own, else the nearest upline, else none ----------------------------
-- Rows now: Maria (recruiting contact, first_meeting; customer contact), Anita (recruiting contact),
-- Tasha (customer on_ditto), Jamal (recruiting contact "Hello", first_meeting 30 x's).
delete from public.stage_names where person_id = '4';

select pg_temp.login('700');
select is(pg_temp.seen('recruiting', 'contact'), 'Mid contact|2', 'Tasha: the nearest upline (Anita) beats Maria');
select is(pg_temp.seen('recruiting', 'first_meeting'), 'Top meeting|1', 'a stage only Maria named comes from Maria');
select is(pg_temp.seen('customer', 'contact'), 'Top customer contact|1', 'the customer pipeline resolves on its own');
select is(pg_temp.seen('recruiting', 'first_plan'), 'none', 'a stage nobody named has no custom name');
select is(pg_temp.seen('customer', 'on_ditto'), 'Tasha subscribed|700', 'her own name is hers');
select is(pg_temp.seen('customer', 'on_ditto', false), 'none', 'false leaves her own out');
select is((select count(*)::int from public.effective_stage_names()), 4, 'four stages have a name for her');
select is((select from_person_name from public.effective_stage_names() where pipeline = 'recruiting' and stage_key = 'contact'),
  'Anita Patel', 'with the name of who set it, though she may not read Anita''s profile');
select is((select depth from public.effective_stage_names() where pipeline = 'recruiting' and stage_key = 'contact'), 2,
  'and how far up they are');
-- Her own name wins over both uplines.
insert into public.stage_names (pipeline, stage_key, name) values ('recruiting', 'contact', 'Tasha contact');
select is(pg_temp.seen('recruiting', 'contact'), 'Tasha contact|700', 'own beats the nearest upline');
select is(pg_temp.seen('recruiting', 'contact', false), 'Mid contact|2', 'the inherited one is still there for the placeholder');
select pg_temp.logout();

-- A downline's own name is not overridden by a later upline change.
insert into public.stage_names (person_id, workspace_id, pipeline, stage_key, name)
  values ('4', 'w1', 'recruiting', 'contact', 'Jamal contact');
update public.stage_names set name = 'Top contact v2' where person_id = '1' and pipeline = 'recruiting' and stage_key = 'contact';
update public.stage_names set name = 'Mid contact v2' where person_id = '2' and pipeline = 'recruiting' and stage_key = 'contact';
select pg_temp.login('4');
select is(pg_temp.seen('recruiting', 'contact'), 'Jamal contact|4', 'Jamal keeps his own name after both uplines changed theirs');
select is(pg_temp.seen('recruiting', 'contact', false), 'Mid contact v2|2', 'and would inherit Anita''s new one');
select pg_temp.logout();
select pg_temp.login('700');
select is(pg_temp.seen('recruiting', 'contact', false), 'Jamal contact|4',
  'what Tasha would inherit is the nearest upline''s: Jamal, not Anita or Maria');
select pg_temp.logout();

-- Above and beside see none of it
select pg_temp.login('2');
select is(pg_temp.seen('recruiting', 'contact'), 'Mid contact v2|2', 'Anita sees her own, nothing from her downline');
select is(pg_temp.seen('customer', 'on_ditto'), 'none', 'a downline''s name never travels up');
select pg_temp.logout();
select pg_temp.login('6');
select is(pg_temp.seen('recruiting', 'contact'), 'Top contact v2|1', 'Marcus (a crossline of Anita) gets Maria''s, not Anita''s');
select pg_temp.logout();
select pg_temp.login('1');
select is(pg_temp.seen('recruiting', 'first_meeting'), 'Top meeting|1', 'Maria sees her own');
select is(pg_temp.seen('recruiting', 'first_meeting', false), 'none', 'and has nothing above her');
select pg_temp.logout();

-- A sponsor cycle (which the app never makes) ends the walk instead of looping.
alter table public.people disable trigger user;
update public.people set sponsor_id = '700' where id = '1';
alter table public.people enable trigger user;
select pg_temp.login('700');
select is((select count(*)::int from public.effective_stage_names(false)), 3,
  'a cycle in the sponsor line still returns each name once');
select pg_temp.logout();

select * from finish();
rollback;
