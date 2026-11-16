-- Steps after Registered (migration 20261112000100): the band, who adds, edits, hides and deletes, the order of the columns,
-- and that the customer board gets nothing. Self-contained (workspace prw), all rolled back.
--
-- Team 'prw': Pat (prl, leader, root) -> Alex (pra, IBO) -> Bo (prb, apprentice, registered today). Dee (prd, Pat's deputy),
-- Cal (prc, a prospect with a login: a candidate), Xavier (prx, a second root) and Xena (prxr, his apprentice).
-- Logins: 1 Pat, 2 Alex, 3 Bo, 4 Dee, 5 Xavier, 6 Cal.
begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

create function pg_temp.login(p_n int) returns uuid language sql immutable as $$
  select ('00000000-0000-4000-8000-0000000e100' || p_n)::uuid $$;
create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.as_login(p_n int) returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pg_temp.login(p_n), 'role', 'authenticated',
    'aud', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.q(p_sql text) returns text language plpgsql as $$
declare
  v_prev text := current_setting('role');
  v text;
begin
  perform set_config('role', 'postgres', true);
  execute p_sql into v;
  perform set_config('role', v_prev, true);
  return v;
end $$;
-- Run one statement as the current role and undo it: 'rows=N' when it ran (N rows changed), else its SQLSTATE.
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
-- The same, without undoing it.
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
-- The ids of the columns of an owner's board from one band on, in board order ('registered,s-a,s-b,referral_source,...').
create function pg_temp.board(p_owner text, p_from_band text default 'registered') returns text language sql as $$
  select string_agg(c.id, ',' order by c.ord)
    from public.board_columns('recruiting', p_owner) c
   where c.ord >= (select min(x.ord) from public.board_columns('recruiting', p_owner) x where x.band = p_from_band)
$$;

insert into public.workspaces (id, name, timezone) values
  ('prw', 'Post Registration Team',
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date) values
  ('prl',  'prw', 'Pat Leader',     'ibo',        null,  null, public.workspace_today('prw') - 900),
  ('pra',  'prw', 'Alex Mid',       'ibo',        'prl', null, public.workspace_today('prw') - 700),
  ('prb',  'prw', 'Bo Registered',  'apprentice', 'pra', null, public.workspace_today('prw')),
  ('prd',  'prw', 'Dee Deputy',     'apprentice', 'prl', null, public.workspace_today('prw') - 80),
  ('prx',  'prw', 'Xavier Outside', 'ibo',        null,  null, public.workspace_today('prw') - 800),
  ('prxr', 'prw', 'Xena Outside',   'apprentice', 'prx', null, public.workspace_today('prw') - 20),
  ('prc',  'prw', 'Cal Candidate',  'prospect',   'prl', null, null),
  ('prcu', 'prw', 'Cara Customer',  'customer',   null,  'pra', null);
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

-- The band ----------------------------------------------------------------------------------------------------------------
select is(pg_temp.run_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-act', 'registered', 'Activated', 0)$$),
  'rows=1', 'Pat adds a step after Registered');
select is(pg_temp.run_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-90', 'registered', 'Active 90 days', 1)$$),
  'rows=1', 'and a second one, after the first');
select is(pg_temp.run_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-info', 'first_plan', 'Info follow-up', 0)$$),
  'rows=1', 'a step before Registered still works');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'afterwards', 'Whatever', 0)$$),
  '23514', 'a band that is not one of the four is refused');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', 'Registered', 2)$$),
  '23514', 'a step cannot be named like a milestone (Registered)');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', 'first plan', 2)$$),
  '23514', 'or any milestone, in any capitals');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', 'Do not contact', 2)$$),
  '23514', 'or a fixed column');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', repeat('a', 25), 2)$$),
  '23514', 'a name has at most 24 characters');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', '   ', 2)$$),
  '23514', 'and is not empty');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'registered', ' activated ', 2)$$),
  '23505', 'the same name twice in a band by one leader is refused');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position) values ('s-x', 'first_plan', 'Activated', 2)$$),
  'rows=1', 'the same name in another band is fine');
select is(pg_temp.try_as(1, $$insert into public.pipeline_steps (id, band, label, position, owner_id) values ('s-x', 'registered', 'Mine', 2, 'pra')$$),
  '42501', 'a step is always its own leader''s');
select is(pg_temp.run_as(2, $$insert into public.pipeline_steps (id, band, label, position) values ('s-call', 'registered', 'Team call', 0)$$),
  'rows=1', 'Alex adds his own step after Registered');
select is(pg_temp.run_as(2, $$insert into public.pipeline_steps (id, band, label, position) values ('s-act2', 'registered', 'Activated', 1)$$),
  'rows=1', 'and may reuse a name his upline has (names are per leader)');
select is(pg_temp.run_as(5, $$insert into public.pipeline_steps (id, band, label, position) values ('s-xav', 'registered', 'Xavier step', 0)$$),
  'rows=1', 'Xavier adds one on his own line');

-- Who edits and deletes ----------------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$update public.pipeline_steps set label = 'Hijacked' where id = 's-act'$$), 'rows=0',
  'Alex cannot rename Pat''s step');
select is(pg_temp.try_as(2, $$delete from public.pipeline_steps where id = 's-act'$$), 'rows=0', 'or delete it');
select is(pg_temp.try_as(1, $$update public.pipeline_steps set label = 'Hijacked' where id = 's-call'$$), 'rows=0',
  'and Pat cannot rename Alex''s');
select is(pg_temp.try_as(1, $$update public.pipeline_steps set label = 'Active 60 days' where id = 's-90'$$), 'rows=1',
  'the owner renames his own');
select is(pg_temp.try_as(1, $$update public.pipeline_steps set band = 'first_plan' where id = 's-90'$$), '42501',
  'a step never changes band');
select is(pg_temp.try_as(1, $$update public.pipeline_steps set band = 'registered' where id = 's-info'$$), '42501',
  'not even into the band after Registered');

-- The columns: Registered, the steps after it (uplines'' first), then the outcomes ----------------------------------------------
select pg_temp.as_postgres();
select is(pg_temp.board('prl'), 'registered,s-act,s-90,referral_source,not_interested,do_not_contact',
  'Pat''s board: Registered, his steps, then the outcome columns');
select is(pg_temp.board('pra'), 'registered,s-act,s-90,s-call,s-act2,referral_source,not_interested,do_not_contact',
  'Alex inherits Pat''s steps first, then his own in his own order');
select is(pg_temp.board('prb'), 'registered,s-act,s-90,s-call,s-act2,referral_source,not_interested,do_not_contact',
  'and so does everyone under Alex');
select is(pg_temp.board('prx'), 'registered,s-xav,referral_source,not_interested,do_not_contact',
  'another line sees only its own');
select is(pg_temp.q($$select string_agg(c.id, ',' order by c.ord) from public.board_columns('recruiting', 'pra') c where c.band = 'first_plan'$$),
  'first_plan,s-info', 'steps before Registered keep their place, before Registered');

-- Reorder: the owner changes his positions ---------------------------------------------------------------------------------------
select is(pg_temp.run_as(1, $$update public.pipeline_steps set position = case id when 's-90' then 0 else 1 end where id in ('s-act', 's-90')$$),
  'rows=2', 'Pat swaps his two steps');
select pg_temp.as_postgres();
select is(pg_temp.board('pra', 'registered'), 'registered,s-90,s-act,s-call,s-act2,referral_source,not_interested,do_not_contact',
  'the order follows, for Alex too');

-- Hide: an inherited one, for the hider's whole downline --------------------------------------------------------------------------
select is(pg_temp.run_as(2, $$insert into public.pipeline_step_hides (step_id) values ('s-act')$$), 'rows=1', 'Alex hides Pat''s step');
select is(pg_temp.try_as(2, $$insert into public.pipeline_step_hides (step_id) values ('s-call')$$), '42501',
  'but not his own (he deletes it instead)');
select is(pg_temp.try_as(2, $$insert into public.pipeline_step_hides (step_id) values ('s-xav')$$), '42501',
  'nor one from another line');
select pg_temp.as_postgres();
select is(pg_temp.board('pra'), 'registered,s-90,s-call,s-act2,referral_source,not_interested,do_not_contact', 'it is gone from Alex''s board');
select is(pg_temp.board('prb'), 'registered,s-90,s-call,s-act2,referral_source,not_interested,do_not_contact', 'and from his downline''s');
select is(pg_temp.board('prl'), 'registered,s-90,s-act,referral_source,not_interested,do_not_contact', 'but not from Pat''s');

-- Delete: a card in it goes back to Registered, and its hides go ---------------------------------------------------------------------
insert into public.pipeline_cards (person_id, workspace_id, column_id) values ('prb', 'prw', 's-act');
select is(pg_temp.run_as(1, $$delete from public.pipeline_steps where id = 's-act'$$), 'rows=1', 'Pat deletes his step');
select pg_temp.as_postgres();
select is((select column_id from public.pipeline_cards where person_id = 'prb'), 'registered', 'Bo''s card in it is back in Registered');
select is((select count(*)::int from public.pipeline_step_hides where step_id = 's-act'), 0, 'its hide went with it');

-- The customer board gets nothing ------------------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$insert into public.customer_steps (id, band, label, position) values ('cs-x', 'registered', 'After', 0)$$), '23514',
  'a customer step cannot take the band after Registered');
select pg_temp.as_postgres();
select is((select count(*)::int from public.board_columns('customer', 'pra') where band = 'registered'), 0,
  'and the customer board has no such band');

select * from finish();
rollback;
