-- A registered person's own card (migration 20261113000100): they can read it, not move it, take it off the board, put it back or
-- insert it; the owner, their upline and a deputy still can; a crossline and a candidate still cannot. And the agent connector's card
-- documents name the step for the person looking at their own card. Self-contained (workspace rcw), all rolled back.
--
-- Team 'rcw': Olive (ol, leader) -> Max (om, IBO) -> registered people Bo (ob, login 3) and Eve (oe, login 7, no stored card); Olive's
-- deputy Dee (od, login 4); Xavier (ox, login 5) leads another line; Cal (oc, login 6) is a candidate. Olive's steps after Registered:
-- Activated (s-act), then Core (s-core). Bo's card is in Activated. Logins: 1 Olive, 2 Max, 3 Bo, 4 Dee, 5 Xavier, 6 Cal, 7 Eve.
-- All dates are the team's (workspace_today / its time zone), never the server's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e300' || p_n)::uuid $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e400' || p_n)::uuid $$;
create function pg_temp.hash(p_text text) returns text language sql immutable as $$
  select encode(sha256(convert_to(p_text, 'utf8')), 'hex') $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.agent_connection_id', '', true);
end $$;
create function pg_temp.as_login(p_n int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_n), 'role', 'authenticated',
    'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', '', true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_connector(p_login int, p_conn int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_login),
    'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('app.agent_connection_id', pg_temp.conn(p_conn)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
-- Run a statement as a login: 'rows=N' (what it changed or returned) or the SQLSTATE it failed with. Back as the owner afterwards.
create function pg_temp.run_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
  v_out text;
begin
  perform pg_temp.as_login(p_n);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    v_out := 'rows=' || v_rows;
  exception when others then v_out := sqlstate;
  end;
  perform pg_temp.as_postgres();
  return v_out;
end $$;
-- One value, as a login (back as the owner afterwards).
create function pg_temp.val_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_login(p_n);
  execute p_sql into v;
  perform pg_temp.as_postgres();
  return v;
end $$;
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;

insert into public.workspaces (id, name, timezone) values
  ('rcw', 'Own Card Team',
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date) values
  ('ol', 'rcw', 'Olive Leader',   'ibo',        null, null, public.workspace_today('rcw') - 900),
  ('om', 'rcw', 'Max Mid',        'ibo',        'ol', null, public.workspace_today('rcw') - 700),
  ('ob', 'rcw', 'Bo Registered',  'apprentice', 'om', null, public.workspace_today('rcw')),
  ('oe', 'rcw', 'Eve Registered', 'apprentice', 'om', null, public.workspace_today('rcw')),
  ('od', 'rcw', 'Dee Deputy',     'apprentice', 'ol', null, public.workspace_today('rcw') - 80),
  ('ox', 'rcw', 'Xavier Outside', 'ibo',        null, null, public.workspace_today('rcw') - 800),
  ('oc', 'rcw', 'Cal Candidate',  'prospect',   'ol', null, null);
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'own-card-' || n || '@card.test'
  from generate_series(1, 7) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('rcw', 'ol', pg_temp.login(1), 'leader'),
  ('rcw', 'om', pg_temp.login(2), 'member'),
  ('rcw', 'ob', pg_temp.login(3), 'member'),
  ('rcw', 'od', pg_temp.login(4), 'member'),
  ('rcw', 'ox', pg_temp.login(5), 'member'),
  ('rcw', 'oc', pg_temp.login(6), 'member'),
  ('rcw', 'oe', pg_temp.login(7), 'member');
insert into public.deputies (workspace_id, leader_id, deputy_id) values ('rcw', 'ol', 'od');
insert into public.pipeline_steps (id, workspace_id, owner_id, band, label, position) values
  ('s-act',  'rcw', 'ol', 'registered', 'Activated', 0),
  ('s-core', 'rcw', 'ol', 'registered', 'Core',      1);
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at) values
  ('ob', 'rcw', 's-act', now());

-- Bo: his own card ---------------------------------------------------------------------------------------------------------------
select is(pg_temp.run_as(3, $$select public.move_pipeline_card('ob', 's-core')$$), '42501', 'Bo cannot move his own card to a step');
select is(pg_temp.run_as(3, $$select public.move_pipeline_card('ob', 'registered')$$), '42501', 'nor back to Registered');
select is((select column_id from public.pipeline_cards where person_id = 'ob'), 's-act', 'the card did not move');
select is(pg_temp.run_as(3, $$update public.pipeline_cards set dropped_at = now() where person_id = 'ob'$$), 'rows=0', 'Bo cannot take his own card off the board');
select is((select dropped_at is null from public.pipeline_cards where person_id = 'ob'), true, 'it is still on the board');
select is(pg_temp.run_as(3, $$update public.pipeline_cards set column_id = 's-core' where person_id = 'ob'$$), 'rows=0', 'nor change the row in any other way');
select is(pg_temp.run_as(3, $$delete from public.pipeline_cards where person_id = 'ob'$$), 'rows=0', 'nor delete the row');
select is((select count(*)::int from public.pipeline_cards where person_id = 'ob'), 1, 'the row is there');
update public.pipeline_cards set dropped_at = now() where person_id = 'ob';
select is(pg_temp.run_as(3, $$update public.pipeline_cards set dropped_at = null where person_id = 'ob'$$), 'rows=0', 'once someone takes it off, Bo cannot put it back');
select is((select dropped_at is not null from public.pipeline_cards where person_id = 'ob'), true, 'it is still off the board');
update public.pipeline_cards set dropped_at = null where person_id = 'ob';
select is(pg_temp.val_as(3, $$select count(*)::text from public.pipeline_cards where person_id = 'ob'$$), '1', 'Bo can still read his own card');

-- Eve: no stored card; she cannot insert her own row -------------------------------------------------------------------------------
select is(pg_temp.run_as(7, $$insert into public.pipeline_cards (person_id, workspace_id, column_id) values ('oe', 'rcw', 'registered')$$), '42501', 'Eve cannot create her own card row');
select is((select count(*)::int from public.pipeline_cards where person_id = 'oe'), 0, 'none was created');
select is(pg_temp.run_as(2, $$insert into public.pipeline_cards (person_id, workspace_id, column_id) values ('oe', 'rcw', 'registered')$$), 'rows=1', 'her sponsor Max can create it');
delete from public.pipeline_cards where person_id = 'oe';

-- The owner, an upline and a deputy still move, take off and put back ---------------------------------------------------------------
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('ob', 's-core')$$), 'rows=1', 'owner (Max) moves Bo''s card');
select is(pg_temp.run_as(1, $$select public.move_pipeline_card('ob', 's-act')$$), 'rows=1', 'upline (Olive) moves it');
select is(pg_temp.run_as(4, $$select public.move_pipeline_card('ob', 's-core')$$), 'rows=1', 'deputy (Dee) moves it');
select is((select column_id from public.pipeline_cards where person_id = 'ob'), 's-core', 'it is in Core');
select is(pg_temp.run_as(2, $$update public.pipeline_cards set dropped_at = now() where person_id = 'ob'$$), 'rows=1', 'owner takes it off the board');
select is(pg_temp.run_as(1, $$update public.pipeline_cards set dropped_at = null where person_id = 'ob'$$), 'rows=1', 'upline puts it back');
select is(pg_temp.run_as(4, $$update public.pipeline_cards set dropped_at = now() where person_id = 'ob'$$), 'rows=1', 'deputy takes it off');
select is(pg_temp.run_as(2, $$update public.pipeline_cards set dropped_at = null where person_id = 'ob'$$), 'rows=1', 'owner puts it back');

-- A crossline and a candidate are refused as before ---------------------------------------------------------------------------------
select is(pg_temp.run_as(5, $$select public.move_pipeline_card('ob', 's-act')$$), 'P0002', 'a crossline cannot move it (person not found)');
select is(pg_temp.run_as(6, $$select public.move_pipeline_card('ob', 's-act')$$), '42501', 'a candidate has no pipeline');
select is(pg_temp.run_as(5, $$update public.pipeline_cards set dropped_at = now() where person_id = 'ob'$$), 'rows=0', 'a crossline cannot take it off');
select is(pg_temp.run_as(6, $$update public.pipeline_cards set dropped_at = now() where person_id = 'ob'$$), 'rows=0', 'nor a candidate');
select is(pg_temp.run_as(5, $$insert into public.pipeline_cards (person_id, workspace_id, column_id) values ('oe', 'rcw', 'registered')$$), '42501', 'a crossline cannot create a card row');
select is(pg_temp.run_as(6, $$insert into public.pipeline_cards (person_id, workspace_id, column_id) values ('oe', 'rcw', 'registered')$$), '42501', 'nor a candidate');
select is((select column_id || '/' || (dropped_at is null)::text from public.pipeline_cards where person_id = 'ob'), 's-core/true', 'Bo''s card is where the owner left it');

-- The agent connector names the step for the person looking at their own card ---------------------------------------------------------
insert into public.feature_switches (workspace_id, feature, enabled) values ('rcw', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(2), pg_temp.login(2), 'om', 'rcw', 'Max read', pg_temp.hash('k2'), 'read', null),
  (pg_temp.conn(3), pg_temp.login(3), 'ob', 'rcw', 'Bo read', pg_temp.hash('k3'), 'read', null);
select pg_temp.pretend_connector_session();
select pg_temp.as_connector(3, 3);
select is(public.agent_get_card('ob') #>> '{column,id}', 's-core', 'Bo looking at his own card: the column id');
select is(public.agent_get_card('ob') #>> '{column,name}', 'Core', 'and the step''s name, not ''Removed column''');
select pg_temp.as_postgres();
update public.pipeline_cards set column_id = 's-act' where person_id = 'ob';
select pg_temp.as_connector(3, 3);
select is(public.agent_get_card('ob') #>> '{column,name}', 'Activated', 'the other step (inherited from his sponsor''s upline)');
select pg_temp.as_postgres();
update public.pipeline_cards set column_id = 'registered' where person_id = 'ob';
select pg_temp.as_connector(3, 3);
select is(public.agent_get_card('ob') #>> '{column,name}', 'Registered', 'in Registered: its name');
select pg_temp.as_postgres();
update public.pipeline_cards set column_id = 's-core' where person_id = 'ob';
select pg_temp.as_connector(2, 2);
select is(public.agent_get_card('ob') #>> '{column,name}', 'Core', 'Max (the owner) still sees the same name');

select * from finish();
rollback;
