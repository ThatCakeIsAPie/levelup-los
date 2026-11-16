-- Who is on the board after Registered, from the database side (migration 20261112000100, pipeline_registered_in_progress()), and what
-- hangs on it: tasks and notes on the card, and the agent connector's card tools. Self-contained (workspace prw), all rolled back.
--
-- Team 'prw': Pat (prl, leader) -> Alex (pra, IBO) -> registered people Bo (prb, started on the 1st of this month), Eve (pre, the day
-- before), Fay (prf, an IBO for years), Gus (prg, started the day before the 1st of last month), Hal (prh, the 1st of last month);
-- Pat's apprentice Dee (prd, deputy). Alex's prospect Pia (prp1), customer person Cara (prcu). Xavier (prx) leads another line, Cal
-- (prc) is a candidate. Steps after Registered: Pat's s-act then s-90, Alex's s-call (so Alex's board ends with s-call, Pat's with s-90).
-- Logins: 1 Pat, 2 Alex, 3 Bo, 4 Dee, 5 Xavier, 6 Cal. All dates are the team's (workspace_today / its time zone), never the server's.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e100' || p_n)::uuid $$;
create function pg_temp.conn(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e200' || p_n)::uuid $$;
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
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    raise exception 'rows=%', v_rows using errcode = 'XX999';
  exception
    when sqlstate 'XX999' then return sqlerrm;
    when others then return sqlstate;
  end;
end $$;
create function pg_temp.try_as(p_n int, p_sql text) returns text language plpgsql as $$
begin
  perform pg_temp.as_login(p_n);
  return pg_temp.try(p_sql);
end $$;
create function pg_temp.run_as(p_n int, p_sql text) returns text language plpgsql as $$
declare
  v_rows int;
begin
  perform pg_temp.as_login(p_n);
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
    return 'rows=' || v_rows;
  exception when others then return sqlstate;
  end;
end $$;
-- Is this registered person's card in progress, as the given login asks (back as the owner afterwards)?
create function pg_temp.inprog(p_n int, p_person text) returns boolean language plpgsql as $$
declare
  v boolean;
begin
  perform pg_temp.as_login(p_n);
  v := public.pipeline_registered_in_progress(p_person);
  perform pg_temp.as_postgres();
  return v;
end $$;
-- Who of these people are in progress, as Alex asks: 'prb,prf'.
create function pg_temp.who(p_people text) returns text language sql as $$
  select coalesce(string_agg(p, ',' order by p) filter (where pg_temp.inprog(2, p)), '-')
    from unnest(string_to_array(p_people, ',')) p
$$;
create function pg_temp.col(p_doc jsonb, p_key text, p_field text) returns text language sql as $$
  select coalesce(string_agg(coalesce(x #>> string_to_array(p_field, '.'), '~'), ',' order by n), '')
    from jsonb_array_elements(p_doc -> p_key) with ordinality t (x, n) $$;
create function pg_temp.colset(p_doc jsonb, p_key text, p_field text) returns text language sql as $$
  select coalesce(string_agg(coalesce(x #>> string_to_array(p_field, '.'), '~'), ',' order by coalesce(x #>> string_to_array(p_field, '.'), '~') collate "C"), '')
    from jsonb_array_elements(p_doc -> p_key) t (x) $$;
create function pg_temp.pretend_connector_session() returns void language plpgsql as $$
begin
  execute $f$create or replace function agent_private.via_connector() returns boolean
             language sql stable set search_path = '' as 'select true'$f$;
end $$;

insert into public.workspaces (id, name, timezone) values
  ('prw', 'Post Registration Team',
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
-- The first day of this month and of last month, in the team's calendar; and the first instant of this month, in its zone.
create temp table cal as
  select date_trunc('month', public.workspace_today('prw'))::date as m0,
         (date_trunc('month', public.workspace_today('prw')) - interval '1 month')::date as m1,
         (date_trunc('month', public.workspace_today('prw'))::timestamp at time zone w.timezone) as m0_start
    from public.workspaces w where w.id = 'prw';
grant select on cal to public;
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date)
select v.id, 'prw', v.name, v.biz, v.sponsor, v.owner, v.bsd
  from cal, lateral (values
    ('prl',  'Pat Leader',     'ibo',        null::text, null::text, public.workspace_today('prw') - 900),
    ('pra',  'Alex Mid',       'ibo',        'prl', null, public.workspace_today('prw') - 700),
    ('prb',  'Bo Registered',  'apprentice', 'pra', null, cal.m0),
    ('pre',  'Eve Registered', 'apprentice', 'pra', null, cal.m0 - 1),
    ('prf',  'Fay Ibo',        'ibo',        'pra', null, public.workspace_today('prw') - 800),
    ('prg',  'Gus Registered', 'apprentice', 'pra', null, cal.m1 - 1),
    ('prh',  'Hal Registered', 'apprentice', 'pra', null, cal.m1),
    ('prd',  'Dee Deputy',     'apprentice', 'prl', null, public.workspace_today('prw') - 80),
    ('prx',  'Xavier Outside', 'ibo',        null,  null, public.workspace_today('prw') - 800),
    ('prc',  'Cal Candidate',  'prospect',   'prl', null, null::date),
    ('prp1', 'Pia Prospect',   'prospect',   'pra', null, null),
    ('prcu', 'Cara Customer',  'customer',   null,  'pra', null)) v (id, name, biz, sponsor, owner, bsd);
insert into auth.users (instance_id, id, aud, role, email)
select '00000000-0000-0000-0000-000000000000', pg_temp.login(n), 'authenticated', 'authenticated', 'post-reg-' || n || '@card.test'
  from generate_series(1, 6) n;
insert into public.members (workspace_id, person_id, user_id, role) values
  ('prw', 'prl', pg_temp.login(1), 'leader'),
  ('prw', 'pra', pg_temp.login(2), 'member'),
  ('prw', 'prb', pg_temp.login(3), 'member'),
  ('prw', 'prd', pg_temp.login(4), 'member'),
  ('prw', 'prx', pg_temp.login(5), 'member'),
  ('prw', 'prc', pg_temp.login(6), 'member');
insert into public.deputies (workspace_id, leader_id, deputy_id) values ('prw', 'prl', 'prd');
insert into public.pipeline_steps (id, workspace_id, owner_id, band, label, position) values
  ('s-act',  'prw', 'prl', 'registered', 'Activated',      0),
  ('s-90',   'prw', 'prl', 'registered', 'Active 90 days', 1),
  ('s-call', 'prw', 'pra', 'registered', 'Team call',      0);
create temp table people_ids as select 'prb,pre,prf,prg,prh,prp1,prcu' as v;
grant select on people_ids to public;

-- The cutoff: the first day, in the team's zone, of the month of the earliest step ---------------------------------------------------
select is(pg_temp.who('prb,pre,prf,prg,prh'), 'prb', 'steps created this month: only Bo (started on the 1st) is on the board; the others finished');
select is(pg_temp.who('prp1,prcu'), '-', 'a prospect or a customer person never has a card after Registered');
update public.pipeline_steps set created_at = (select m0_start from cal) where id = 's-act';
select is(pg_temp.who('prb,pre,prf,prg,prh'), 'prb', 'a step created at the first instant of this month: the same cutoff');
update public.pipeline_steps set created_at = (select m0_start from cal) - interval '1 second' where id = 's-act';
select is(pg_temp.who('prb,pre,prf,prg,prh'), 'prb,pre,prh', 'one second earlier (last month, team time): the cutoff is last month''s 1st, so Eve and Hal come on too');
select is(pg_temp.who('prg'), '-', 'Gus, the day before that, is still finished');
update public.pipeline_steps set created_at = (select m0_start from cal) - interval '1 second' where id = 's-90';
update public.pipeline_steps set created_at = now() where id = 's-act';
select is(pg_temp.who('prb,pre,prh'), 'prb,pre,prh', 'only the EARLIEST step counts, whichever it is: s-90 is now the earliest, so the cutoff is last month''s 1st');
update public.pipeline_steps set created_at = (select m0_start from cal) - interval '1 second' where id = 's-act';
update public.pipeline_steps set created_at = now() where id = 's-90';

-- A stored card in Registered follows the same rule as no card at all; a card in a step is in progress whenever they registered ----------
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at) values
  ('pre', 'prw', 'registered', now() - interval '30 days'),
  ('prf', 'prw', 's-act', now() - interval '90 days');
select is(pg_temp.who('prb,pre,prf,prg,prh'), 'prb,pre,prf,prh', 'Eve''s card is in Registered: same as without; Fay (an IBO for years) is in progress in s-act');
-- registered on the day of the earliest move into the registered band, before their start date
insert into public.pipeline_moves (id, workspace_id, person_id, owner_id, from_column, to_column, milestone, moved_at, moved_by)
values ('m-g1', 'prw', 'prg', 'pra', 'first_plan', 'registered', 'registered', now(), 'pra'),
       ('m-b1', 'prw', 'prb', 'pra', 'first_plan', 'registered', 'registered', (select m0_start from cal) - interval '40 days', 'pra');
select is(pg_temp.who('prb,prg'), 'prg', 'the day of their registration move wins over the start date: Gus moved in today, Bo registered long before');
alter table public.pipeline_moves disable trigger pipeline_moves_after_delete;
delete from public.pipeline_moves where id in ('m-g1', 'm-b1');
alter table public.pipeline_moves enable trigger pipeline_moves_after_delete;
delete from public.pipeline_cards where person_id in ('pre', 'prf');

-- The finishing column: the last of the board''s steps; its older cards are finished ----------------------------------------------------
-- Alex''s board: s-act, s-90 (Pat''s), s-call (his): s-call finishes. Pat''s board: s-act, s-90: s-90 finishes.
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at) values
  ('prb', 'prw', 's-call', (select m0_start from cal)),
  ('prh', 'prw', 's-call', (select m0_start from cal) - interval '1 second'),
  ('prg', 'prw', 's-90',   (select m0_start from cal) - interval '200 days'),
  ('prd', 'prw', 's-90',   (select m0_start from cal) - interval '1 second');
select is(pg_temp.who('prb'), 'prb', 'Bo entered the finishing column (s-call) this month: in progress');
select is(pg_temp.who('prh'), '-', 'Hal entered it a second before this month: finished');
select is(pg_temp.who('prg'), 'prg', 'Gus is in s-90, not the finishing column of Alex''s board: in progress however long ago');
select is(pg_temp.inprog(2, 'prd'), false, 'Alex does not see Dee at all (she is Pat''s)');
select is(pg_temp.inprog(1, 'prd'), false, 'Dee is in s-90, the finishing column of Pat''s board, since last month: finished');
update public.pipeline_cards set column_id = 's-act' where person_id = 'prd';
select is(pg_temp.inprog(1, 'prd'), true, 'in s-act (not finishing) the same card is in progress');
update public.pipeline_cards set column_id = 's-90', entered_at = now() where person_id = 'prd';
select is(pg_temp.inprog(1, 'prd'), true, 'and in s-90 entered this month it is in progress too');

-- Taken off the board: not in progress; put back: again ------------------------------------------------------------------------------
update public.pipeline_cards set dropped_at = now() where person_id = 'prb';
select is(pg_temp.who('prb'), '-', 'a card taken off the board is not in progress');
update public.pipeline_cards set dropped_at = null where person_id = 'prb';
select is(pg_temp.who('prb'), 'prb', 'put back, it is');

-- Hidden and deleted steps: the card falls back to Registered, and the cutoff rule applies ---------------------------------------------
update public.pipeline_cards set column_id = 's-90', entered_at = now() - interval '90 days' where person_id = 'prg';
select is(pg_temp.who('prg'), 'prg', 'Gus in s-90');
select pg_temp.as_login(2);
insert into public.pipeline_step_hides (step_id) values ('s-90');
select pg_temp.as_postgres();
select is(pg_temp.who('prg'), '-', 'Alex hides s-90: Gus''s card shows in Registered, and he registered before the cutoff');
select is(pg_temp.who('prb'), 'prb', 'Bo, registered after the cutoff, is still there');
delete from public.pipeline_step_hides where step_id = 's-90';
select is(pg_temp.who('prg'), 'prg', 'shown again: back in s-90');
select pg_temp.as_login(1);
delete from public.pipeline_steps where id = 's-90';
select pg_temp.as_postgres();
select is((select column_id from public.pipeline_cards where person_id = 'prg'), 'registered', 'Pat deletes s-90: the card is in Registered');
select is(pg_temp.who('prg,prb'), 'prb', 'and Gus is finished, Bo in progress');
select is(pg_temp.inprog(1, 'prd'), false, 'Dee''s card (s-90 deleted) is in Registered, and she registered long before the cutoff: finished');

-- Visibility: only people who can see the person ask ----------------------------------------------------------------------------------
select is(pg_temp.inprog(5, 'prb'), false, 'a crossline sees nothing');
select is(pg_temp.inprog(6, 'prb'), false, 'a candidate sees nothing');
select is(pg_temp.inprog(3, 'prb'), true, 'Bo asking about himself: in progress');

-- Tasks and notes keep working while the card is in progress (D) -----------------------------------------------------------------------
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), 'rows=1', 'Alex adds a task to Bo''s card');
select is(pg_temp.try_as(1, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), 'rows=1', 'Pat (upline) can');
select is(pg_temp.try_as(4, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), 'rows=1', 'Dee (deputy) can');
select is(pg_temp.try_as(3, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), 'rows=1', 'Bo can on his own card');
select is(pg_temp.try_as(5, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), '42501', 'a crossline cannot');
select is(pg_temp.try_as(6, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), '42501', 'nor a candidate');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title, assignee_id) values ('prb', 'Call Bo', 'pra')$$), 'rows=1', 'a task goes to the card''s owner (Alex)');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title, assignee_id) values ('prb', 'Call Bo', 'prd')$$), '42501', 'but not to just anybody');
select is(pg_temp.try_as(2, $$insert into public.card_notes (person_id, body) values ('prb', 'Activated on a call')$$), 'rows=1', 'Alex adds a note');
select is(pg_temp.try_as(5, $$insert into public.card_notes (person_id, body) values ('prb', 'x')$$), '42501', 'a crossline cannot');
select is(pg_temp.try_as(6, $$insert into public.card_notes (person_id, body) values ('prb', 'x')$$), '42501', 'nor a candidate');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prp1', 'Call Pia')$$), 'rows=1', 'a prospect''s card works as it did');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prcu', 'Call Cara')$$), '23514', 'a customer person has no card here');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('pre', 'Call Eve')$$), 'rows=1', 'Eve (in progress, registered after the cutoff) takes a task');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prh', 'Call Hal')$$), '23514', 'Hal''s card is finished: no new task (as before the steps existed)');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prg', 'Call Gus')$$), '23514', 'nor Gus''s');
select pg_temp.as_postgres();
insert into public.card_tasks (id, workspace_id, person_id, title, created_by) values ('t-old', 'prw', 'prh', 'Old task', 'pra');
select is(pg_temp.try_as(2, $$update public.card_tasks set done = true where id = 't-old'$$), 'rows=1', 'a task already on a finished card can still be ticked');
select is(pg_temp.try_as(2, $$delete from public.card_tasks where id = 't-old'$$), 'rows=1', 'and deleted');
select pg_temp.as_postgres();
update public.pipeline_cards set dropped_at = now() where person_id = 'prb';
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), '23514', 'a card taken off the board takes no new task');
select pg_temp.as_postgres();
update public.pipeline_cards set dropped_at = null where person_id = 'prb';

-- The agent connector (E) ------------------------------------------------------------------------------------------------------------------
insert into public.feature_switches (workspace_id, feature, enabled) values ('prw', 'agents', true);
insert into public.agent_connections (id, user_id, person_id, workspace_id, label, key_hash, access, revoked_at) values
  (pg_temp.conn(2), pg_temp.login(2), 'pra', 'prw', 'Alex write', pg_temp.hash('k2'), 'write', null),
  (pg_temp.conn(5), pg_temp.login(5), 'prx', 'prw', 'Xavier write', pg_temp.hash('k5'), 'write', null);
select pg_temp.pretend_connector_session();
create function pg_temp.no_card_writes() returns trigger language plpgsql as $$ begin raise exception 'a tool wrote a card' using errcode = 'XX888'; end $$;
create trigger card_trap before insert or update or delete on public.pipeline_cards for each statement execute function pg_temp.no_card_writes();
select pg_temp.as_connector(2, 2);
select is(pg_temp.colset(public.agent_list_cards('recruiting', null, false), 'cards', 'person.id'), 'prb,pre,prp1', 'list_cards: Alex''s team''s cards: Bo and Eve (in progress) and Pia; not Hal or Gus (finished)');
select is(pg_temp.col(public.agent_list_cards('recruiting', 'prb', false), 'cards', 'column.id') || '/' ||
          pg_temp.col(public.agent_list_cards('recruiting', 'prb', false), 'cards', 'column.name'), 's-call/Team call',
  'Bo''s card shows its step: column id and name');
select is(pg_temp.col(public.agent_list_cards('recruiting', 'pre', false), 'cards', 'column.id') || '/' ||
          pg_temp.col(public.agent_list_cards('recruiting', 'pre', false), 'cards', 'column.name'), 'registered/Registered',
  'Eve''s, with no stored step, shows Registered');
select is(public.agent_get_card('prb') #>> '{column,id}', 's-call', 'get_card gives the column id');
select is(public.agent_get_card('prb') ->> 'error', null, 'without an error');
select ok(public.agent_get_card('prh') ->> 'error' is not null, 'get_card refuses a finished card, as for any person who has no card');
select ok(public.agent_get_card('prl') ->> 'error' is not null, 'and a registered person with no steps of their own (Pat)');
select is(public.agent_add_card_task('prb', 'Agent task') -> 'task' ->> 'summary', 'Agent task', 'add_card_task works on a card after Registered');
select is(public.agent_add_card_note('prb', 'Agent note') -> 'note' ->> 'body', 'Agent note', 'and add_card_note');
select ok(public.agent_add_card_task('prh', 'Agent task') ->> 'error' is not null, 'a finished card takes no task through the connector either');
select is(public.agent_get_card('prb') ->> 'tasks_total', '1', 'the task shows on the card');
select pg_temp.as_connector(5, 5);
select ok(public.agent_get_card('prb') ->> 'error' is not null, 'another line''s connector cannot see it');
select is(public.agent_list_cards('recruiting', null, false) ->> 'total', '0', 'list_cards for another line lists nothing');
select pg_temp.as_postgres();
select is((select count(*)::int from public.pipeline_cards where person_id = 'prb' and column_id = 's-call'), 1, 'no tool moved or wrote a card (the trap never fired)');
drop trigger card_trap on public.pipeline_cards;

-- No step after Registered on a board: nothing changes for it ----------------------------------------------------------------------------------
select pg_temp.as_login(2);
delete from public.pipeline_steps where id = 's-call';
select pg_temp.as_login(1);
delete from public.pipeline_steps where id = 's-act';
select pg_temp.as_postgres();
select is((select count(*)::int from public.pipeline_steps where band = 'registered' and workspace_id = 'prw'), 0, 'all the steps after Registered are gone');
select is(pg_temp.who('prb,pre,prf,prg,prh'), '-', 'nobody is in progress: the board is as it was');
select is(pg_temp.try_as(2, $$insert into public.card_tasks (person_id, title) values ('prb', 'Call Bo')$$), '23514', 'a registered person''s card takes no task');
select pg_temp.as_connector(2, 2);
select is(pg_temp.colset(public.agent_list_cards('recruiting', null, false), 'cards', 'person.id'), 'prp1', 'list_cards lists the prospect only');
select ok(public.agent_get_card('prb') ->> 'error' is not null, 'get_card refuses a registered person');
select pg_temp.as_postgres();

select * from finish();
rollback;
