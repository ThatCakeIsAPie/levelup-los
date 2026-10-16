-- Event categories (migration 20261016002000_event_categories).
--
-- Seed facts (src/data/seed.ts): Maria (1) is the leader, Marcus (6) her
-- deputy, Anita (2) a moderator at 3/10, Jamal (4) an apprentice under Anita,
-- Tasha (700) under Jamal, Beau (20) a candidate. Customers: Grace Lin (c1)
-- is Maria's, Kofi Mensah (c8) is Jamal's. Night Owls no5 was two days ago.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- Schema and the starting categories --------------------------------------------------
select has_table('public', 'event_categories', 'event_categories exists');
select has_column('public', 'events', 'category_id', 'events point at a category');
select col_not_null('public', 'events', 'category_id', 'every event has a category');
select hasnt_column('public', 'events', 'type', 'the fixed type is gone');
select ok((select relrowsecurity from pg_class where oid = 'public.event_categories'::regclass),
  'row-level security is on');
select is(array(select name from public.event_categories where workspace_id = 'w1' order by position),
  array['Night Owls', 'Work session', 'Info session', 'Training', 'Monthly team meeting', 'Conference'],
  'the team starts with the six old types, in order');
select is((select string_agg(id || ':' || allows_virtual::int || uses_tickets::int || uses_travel::int
                             || counts_for_missed_followups::int || welcomes_customers::int, ' ' order by position)
             from public.event_categories where workspace_id = 'w1'),
  'w1-night_owls:00010 w1-work_session:00010 w1-info_session:10011 w1-training:10011 '
  || 'w1-monthly_meeting:11011 w1-conference:11110',
  'their settings match the old types (online, tickets, travel, misses, customers)');

insert into public.workspaces (id, name) values ('w9', 'Another team');
select is((select count(*)::int from public.event_categories where workspace_id = 'w9'), 6,
  'a new workspace starts with the six too');

-- Reading -----------------------------------------------------------------------------
select pg_temp.login('4');
select is((select count(*)::int from public.event_categories), 6,
  'everyone on the team reads the categories (not another team''s)');
select pg_temp.logout();

-- Adding: anyone who may add events ------------------------------------------------------
select pg_temp.login('2');
select lives_ok($$insert into public.event_categories (id, name, icon, allows_virtual, created_by, archived_at)
  values ('t-zoom', 'Zoom chat', 'mic', true, '1', now())$$, 'Anita adds a category');
select is((select created_by || ':' || (archived_at is null)::text from public.event_categories where id = 't-zoom'),
  '2:true', 'it''s stamped as hers, and starts active');
select throws_ok($$insert into public.event_categories (name) values ('night owls')$$,
  '23505', null, 'no second active category with the same name');
select lives_ok($$insert into public.event_categories (id, name) values ('t-book', 'Book club')$$,
  'Anita adds another');
select is(pg_temp.affected($$update public.event_categories set name = 'Book night' where id = 't-book'$$), 0,
  'Anita can''t rename, even her own');
select throws_ok($$select public.merge_event_categories('t-book', 'w1-training')$$,
  '42501', null, 'Anita can''t merge');
select lives_ok($$insert into public.events (id, name, category_id, date, format)
  values ('t-z1', 'Zoom chat', 't-zoom', current_date + 3, 'virtual'),
         ('t-b1', 'Book club', 't-book', current_date + 4, 'in_person')$$,
  'she plans events in her new categories');
select pg_temp.logout();

select pg_temp.login('20');
select throws_ok($$insert into public.event_categories (name) values ('Beau''s night')$$,
  '42501', null, 'a candidate can''t add one');
select pg_temp.logout();

select pg_temp.login('4');
select is(pg_temp.affected($$update public.event_categories set uses_tickets = true where id = 'w1-training'$$), 0,
  'Jamal can''t change one');
select throws_ok($$select public.merge_event_categories('t-book', 'w1-training')$$,
  '42501', null, 'Jamal can''t merge');
select pg_temp.logout();

-- Leaders and deputies edit --------------------------------------------------------------
select pg_temp.login('1');
select is(pg_temp.affected($$update public.event_categories
  set name = 'Book night', icon = 'book', tone = 'green', position = 7, created_by = '1'
  where id = 't-book'$$), 1, 'Maria renames and recolors it');
select is((select name || ':' || created_by from public.event_categories where id = 't-book'),
  'Book night:2', 'who made it never changes');
select throws_ok($$update public.event_categories set tone = 'purple' where id = 't-book'$$,
  '23514', null, 'colors come from the curated set');
select is(pg_temp.affected($$delete from public.event_categories where id = 't-book'$$), 0,
  'categories are never deleted');
select pg_temp.logout();

select pg_temp.login('6');
select is(pg_temp.affected($$update public.event_categories set welcomes_customers = true where id = 't-book'$$), 1,
  'Marcus, Maria''s deputy, changes a setting');
select pg_temp.logout();

-- Events and their category ----------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into public.events (id, name, date) values ('t-none', 'Quick meetup', current_date + 1)$$,
  'an event without a category…');
select is((select category_id from public.events where id = 't-none'), 'w1-night_owls',
  '…gets the team''s first one');
select throws_ok($$insert into public.events (name, category_id, date) values ('X', 'w9-training', current_date)$$,
  '23514', null, 'no category of another team');
select is((select format from public.events where id = 't-z1'), 'virtual',
  'an online event in a category that allows it');

-- Merging --------------------------------------------------------------------------------
select is((select public.merge_event_categories('t-zoom', 'w1-night_owls')), 1,
  'Maria merges Zoom chat into Night Owls: one event moved');
select is((select category_id || ':' || format from public.events where id = 't-z1'),
  'w1-night_owls:in_person', 'the event moved, and is in person now (Night Owls is in person only)');
select isnt((select archived_at from public.event_categories where id = 't-zoom'), null,
  'the merged category is archived');
select is((select count(*)::int from public.event_categories where id = 't-zoom'), 1,
  'and still there for old links and history');
select throws_ok($$select public.merge_event_categories('t-book', 't-zoom')$$,
  '23514', null, 'nothing merges into an archived category');
select throws_ok($$select public.merge_event_categories('t-book', 't-book')$$,
  '22023', null, 'a category doesn''t merge into itself');
select throws_ok($$select public.merge_event_categories('t-book', 'w9-training')$$,
  'P0002', null, 'nor into another team''s');

-- Archived ---------------------------------------------------------------------------------
select is(pg_temp.affected($$update public.event_categories set archived_at = now() where id = 't-book'$$), 1,
  'Maria archives Book night');
select lives_ok($$update public.events set name = 'Book night (moved)', date = current_date + 5 where id = 't-b1'$$,
  'its events can still be edited');
select throws_ok($$insert into public.events (name, category_id, date) values ('X', 't-book', current_date)$$,
  '23514', null, 'but it can''t be picked for a new event');
select throws_ok($$update public.events set category_id = 't-zoom' where id = 't-none'$$,
  '23514', null, 'nor moved into');
select pg_temp.logout();

-- Customers' missed events: their owner (and the owner's uplines) note them -------------------
select pg_temp.login('1');
select lives_ok($$insert into public.missed_event_notes (person_id, event_id, note)
  values ('c1', 'no5', 'Grace was travelling')$$, 'Maria notes her own customer''s miss');
select pg_temp.logout();
select pg_temp.login('2');
select lives_ok($$insert into public.missed_event_notes (person_id, event_id, note)
  values ('c8', 'no5', 'Kofi''s kid was sick')$$, 'Anita notes a customer of Jamal''s (she''s his upline)');
select pg_temp.logout();
select pg_temp.login('700');
select throws_ok($$insert into public.missed_event_notes (person_id, event_id, note)
  values ('c8', 'no5', 'x')$$, '42501', null, 'Tasha can''t (she''s under the owner)');
select pg_temp.logout();

select * from finish();
rollback;
