-- Moving the card of a registered person (migration 20261112000100): between Registered and the steps after it, never anywhere
-- else; the person stays what they are; the moves are recorded; undo removes the move only, and un-registers only for the move that
-- registered them; taking the card off the board and putting it back. Who may. Self-contained (workspace prw), all rolled back.
--
-- Team 'prw': Pat (prl, leader, root) -> Alex (pra, IBO) -> Bo (prb, apprentice) and Eve (pre, apprentice, no stored card);
-- Alex's prospects Pia (prp1, card in First plan) and Quinn (prp2, no card). Dee (prd, Pat's deputy), Cal (prc, a candidate),
-- Xavier (prx, a second root). Customer person Cara (prcu). Steps after Registered: Pat's s-act and s-90, Alex's s-call, Xavier's
-- s-xav; Pat's s-info is before Registered.
-- Logins: 1 Pat, 2 Alex, 3 Bo, 4 Dee, 5 Xavier, 6 Cal.
begin;
create extension if not exists pgtap with schema extensions;
select plan(89);

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
-- Everything that says what a person is: class, stage, start date, length of the stage history.
create function pg_temp.stage(p_person text) returns text language sql as $$
  select biz_class || '/' || coalesce(pipeline_stage, '-') || '/' || coalesce(business_start_date::text, '-') || '/'
         || jsonb_array_length(coalesce(stage_history, '[]'::jsonb))
    from public.people where id = p_person
$$;
create function pg_temp.acts(p_person text, p_summary text) returns integer language sql as $$
  select count(*)::int from public.activity where related_person_id = p_person and kind = 'stage_changed' and summary = p_summary
$$;
create function pg_temp.card(p_person text) returns text language sql as $$
  select coalesce((select column_id from public.pipeline_cards where person_id = p_person), '-') $$;
create function pg_temp.moves(p_person text) returns text language sql as $$
  select coalesce(string_agg(coalesce(from_column, '-') || '>' || to_column || '(' || milestone || ')', ' ' order by moved_at, id), '')
    from public.pipeline_moves where person_id = p_person $$;

insert into public.workspaces (id, name, timezone) values
  ('prw', 'Post Registration Team',
   case when extract(hour from now() at time zone 'UTC') >= 10 then 'Pacific/Kiritimati' else 'Pacific/Pago_Pago' end);
insert into public.people (id, workspace_id, name, biz_class, sponsor_id, owner_id, business_start_date) values
  ('prl',  'prw', 'Pat Leader',     'ibo',        null,  null, public.workspace_today('prw') - 900),
  ('pra',  'prw', 'Alex Mid',       'ibo',        'prl', null, public.workspace_today('prw') - 700),
  ('prb',  'prw', 'Bo Registered',  'apprentice', 'pra', null, public.workspace_today('prw') - 9),
  ('pre',  'prw', 'Eve Registered', 'apprentice', 'pra', null, public.workspace_today('prw') - 200),
  ('prd',  'prw', 'Dee Deputy',     'apprentice', 'prl', null, public.workspace_today('prw') - 80),
  ('prx',  'prw', 'Xavier Outside', 'ibo',        null,  null, public.workspace_today('prw') - 800),
  ('prc',  'prw', 'Cal Candidate',  'prospect',   'prl', null, null),
  ('prp1', 'prw', 'Pia Prospect',   'prospect',   'pra', null, null),
  ('prp2', 'prw', 'Quinn Prospect', 'prospect',   'pra', null, null),
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
insert into public.pipeline_steps (id, workspace_id, owner_id, band, label, position) values
  ('s-act',  'prw', 'prl', 'registered',  'Activated',      0),
  ('s-90',   'prw', 'prl', 'registered',  'Active 90 days', 1),
  ('s-info', 'prw', 'prl', 'first_plan',  'Info follow-up', 0),
  ('s-call', 'prw', 'pra', 'registered',  'Team call',      0),
  ('s-xav',  'prw', 'prx', 'registered',  'Xavier step',    0);
insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at) values
  ('prp1', 'prw', 'first_plan', now() - interval '5 days');
create temp table before as select pg_temp.stage('prb') as bo, pg_temp.stage('pre') as eve, pg_temp.stage('prp1') as pia;
grant select on before to public;

-- Bo, registered, no stored card, moves through the steps and back -----------------------------------------------------------
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prb', 's-act', 'mv-1')$$), 'rows=1', 'Alex moves Bo (registered) into a step after Registered');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), 's-act', 'the card is created there');
select is(pg_temp.moves('prb'), '->s-act(registered)', 'the move is recorded: no from, the step, band registered');
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prb', 's-90', 'mv-2')$$), 'rows=1', 'then to the next step');
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prb', 'registered', 'mv-3')$$), 'rows=1', 'and back to Registered');
select pg_temp.as_postgres();
select is(pg_temp.moves('prb'), '->s-act(registered) s-act>s-90(registered) s-90>registered(registered)', 'every move is in pipeline_moves');
select is(pg_temp.card('prb'), 'registered', 'the card is in Registered');
select is(pg_temp.stage('prb'), (select bo from before), 'Bo''s class, stage, start date and stage history never changed');
select is(pg_temp.acts('prb', 'Pipeline → apprentice'), 0, 'no registration was logged');
select is((select count(*)::int from public.pipeline_moves where person_id = 'prb' and moved_by = 'pra' and owner_id = 'pra'), 3,
  'the moves are Alex''s, on his prospect line');

-- Refused: the same place, and every other column ---------------------------------------------------------------------------------
select pg_temp.as_login(2);
select throws_ok($$select public.move_pipeline_card('prb', 'registered')$$, '22023', 'Already there', 'Registered to Registered is refused');
select throws_ok($$select public.move_pipeline_card('prb', 'first_plan')$$, '22023',
  'A registered person moves only between Registered and the steps after it', 'an earlier milestone is refused, with the reason');
select pg_temp.as_postgres();
select is(pg_temp.try_as(2, format($$select public.move_pipeline_card('prb', %L)$$, c)), '22023', 'Bo cannot go to ' || c)
  from unnest(array['contact', 'first_meeting', 'first_plan', 'not_contacted', 'referral_source', 'not_interested', 'do_not_contact',
                    's-info', 's-xav', 'no-such-column']) c;
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prcu', 'registered')$$), '22023', 'a customer person never moves on this board');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), 'registered', 'nothing moved');

-- Undo: the move goes, the person stays ----------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$delete from public.pipeline_moves where id = 'mv-1'$$), 'rows=0', 'only the latest move can be undone');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-3'$$), 'rows=1', 'Alex undoes the move back into Registered');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), 's-90', 'the card is back in the step');
select is(pg_temp.stage('prb'), (select bo from before), 'and Bo is still what he was (the un-register trigger did not fire)');
select is(pg_temp.acts('prb', 'Pipeline → prospect'), 0, 'nothing was logged as un-registered');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-2'$$), 'rows=1', 'undo the move into the second step');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), 's-act', 'the card is back in the first');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-1'$$), 'rows=1', 'undo the first move (it created the card)');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), '-', 'the card is gone again');
select is(pg_temp.stage('prb'), (select bo from before), 'Bo is untouched, still registered');
select is(pg_temp.moves('prb'), '', 'and has no moves');

-- A prospect registers, moves through a step, and the two undos each do their own thing ------------------------------------------
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prp1', 's-act')$$), '22023', 'a prospect cannot jump into a step after Registered');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prp2', 's-call')$$), '22023', 'not even without a card');
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prp1', 'registered', 'mv-p1')$$), 'rows=1', 'a prospect still registers by moving into Registered');
select pg_temp.as_postgres();
select is(split_part(pg_temp.stage('prp1'), '/', 1) || '/' || split_part(pg_temp.stage('prp1'), '/', 2), 'apprentice/apprentice', 'they are an apprentice');
select is(split_part(pg_temp.stage('prp1'), '/', 3)::date, public.workspace_today('prw'), 'from today (the team''s day)');
select is(pg_temp.acts('prp1', 'Pipeline → apprentice'), 1, 'and the registration is logged once');
create temp table pia_registered as select pg_temp.stage('prp1') as v;
grant select on pia_registered to public;
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prp1', 's-call', 'mv-p2')$$), 'rows=1', 'now the card moves into a step');
select pg_temp.as_postgres();
select is(pg_temp.stage('prp1'), (select v from pia_registered), 'registering is not repeated: nothing about Pia changed');
select is(pg_temp.acts('prp1', 'Pipeline → apprentice'), 1, 'and no second registration is logged');
select is(pg_temp.try_as(2, $$delete from public.pipeline_moves where id = 'mv-p1'$$), 'rows=0', 'the registering move cannot be undone while a later move stands');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-p2'$$), 'rows=1', 'undo the step move');
select pg_temp.as_postgres();
select is(pg_temp.card('prp1') || ' ' || pg_temp.stage('prp1'), 'registered ' || (select v from pia_registered), 'back in Registered, still an apprentice');
select is(pg_temp.acts('prp1', 'Pipeline → prospect'), 0, 'not un-registered');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-p1'$$), 'rows=1', 'undo the registering move');
select pg_temp.as_postgres();
select is(pg_temp.card('prp1') || ' ' || split_part(pg_temp.stage('prp1'), '/', 1) || ' ' || pg_temp.acts('prp1', 'Pipeline → prospect'),
  'first_plan prospect 1', 'that one puts the card back in First plan and the person back to prospect, once');
select is((select business_start_date::text from public.people where id = 'prp1') is null, true, 'without a start date');

-- A registered person with no stored card ---------------------------------------------------------------------------------------------
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('pre', 'registered')$$), '22023', 'Eve has no card and sits in Registered: moving there is refused');
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('pre', 's-call', 'mv-e1')$$), 'rows=1', 'a move into a step creates the card');
select pg_temp.as_postgres();
select is(pg_temp.card('pre') || ' ' || pg_temp.moves('pre'), 's-call ->s-call(registered)', 'with its move');
select is(pg_temp.run_as(2, $$delete from public.pipeline_moves where id = 'mv-e1'$$), 'rows=1', 'undo it');
select pg_temp.as_postgres();
select is(pg_temp.card('pre') || ' ' || pg_temp.stage('pre'), '- ' || (select eve from before), 'the card is gone and Eve is untouched');

-- Who may move the card: the same people as for a prospect, and the person themselves (they see themselves) ------------------------------
select is(pg_temp.try_as(1, $$select public.move_pipeline_card('prb', 's-act')$$), 'rows=1', 'upline (Pat)');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prb', 's-act')$$), 'rows=1', 'owner (Alex)');
select is(pg_temp.try_as(4, $$select public.move_pipeline_card('prb', 's-act')$$), 'rows=1', 'deputy (Dee)');
select is(pg_temp.try_as(3, $$select public.move_pipeline_card('prb', 's-act')$$), '42501', 'the registered person (Bo) cannot move his own card, though he sees it (061)');
select is(pg_temp.try_as(5, $$select public.move_pipeline_card('prb', 's-act')$$), 'P0002', 'crossline (Xavier): the person is not found');
select is(pg_temp.try_as(6, $$select public.move_pipeline_card('prb', 's-act')$$), '42501', 'candidate (Cal): no pipeline');
select is(pg_temp.try_as(1, $$select public.move_pipeline_card('prp2', 'first_meeting')$$), 'rows=1', 'for comparison, a prospect: upline');
select is(pg_temp.try_as(4, $$select public.move_pipeline_card('prp2', 'first_meeting')$$), 'rows=1', 'deputy');
select is(pg_temp.try_as(5, $$select public.move_pipeline_card('prp2', 'first_meeting')$$), 'P0002', 'crossline');
select is(pg_temp.try_as(6, $$select public.move_pipeline_card('prp2', 'first_meeting')$$), '42501', 'candidate');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prb', 's-xav')$$), '22023', 'a step of another line is not on this board');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prb', 's-info')$$), '22023', 'nor is a step before Registered, for a registered person');

-- Taking the card off the board and putting it back ---------------------------------------------------------------------------------------
select is(pg_temp.run_as(2, $$select public.move_pipeline_card('prb', 's-act', 'mv-d1')$$), 'rows=1', 'Bo''s card is in a step');
select is(pg_temp.try_as(2, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=1', 'Alex takes it off the board');
select is(pg_temp.try_as(1, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=1', 'Pat can');
select is(pg_temp.try_as(4, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=1', 'the deputy can');
select is(pg_temp.try_as(5, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=0', 'a crossline cannot');
select is(pg_temp.try_as(6, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=0', 'nor a candidate');
select is(pg_temp.run_as(2, $$update public.pipeline_cards set dropped_at = now() where person_id = 'prb'$$), 'rows=1', 'Alex does it');
select pg_temp.as_postgres();
select is(pg_temp.stage('prb'), (select bo from before), 'Bo is still what he was');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prb', 'registered')$$), '22023', 'a card that is off the board does not move');
select is(pg_temp.run_as(2, $$update public.pipeline_cards set dropped_at = null where person_id = 'prb'$$), 'rows=1', 'Alex puts it back');
select pg_temp.as_postgres();
select is(pg_temp.card('prb'), 's-act', 'in the column it was in');
select is(pg_temp.try_as(2, $$select public.move_pipeline_card('prb', 'registered')$$), 'rows=1', 'and it moves again');

-- A registered person''s card that was never stored can be created in Registered, to be taken off the board ----------------------------------
select is(pg_temp.try_as(2, $$insert into public.pipeline_cards (person_id, column_id, dropped_at) values ('pre', 'registered', now())$$), 'rows=1',
  'Alex creates Eve''s card in Registered, taken off');
select is(pg_temp.try_as(1, $$insert into public.pipeline_cards (person_id, column_id, dropped_at) values ('pre', 'registered', now())$$), 'rows=1', 'Pat too');
select is(pg_temp.try_as(2, $$insert into public.pipeline_cards (person_id, column_id) values ('pre', 's-call')$$), '42501', 'but not straight into a step (that is a move)');
select is(pg_temp.try_as(2, $$insert into public.pipeline_cards (person_id, column_id) values ('prp2', 'registered')$$), '42501', 'nor for a prospect');
select is(pg_temp.try_as(2, $$insert into public.pipeline_cards (person_id, column_id) values ('prcu', 'registered')$$), '42501', 'nor for a customer person');
select is(pg_temp.try_as(5, $$insert into public.pipeline_cards (person_id, column_id) values ('pre', 'registered')$$), '42501', 'a crossline cannot');
select is(pg_temp.try_as(6, $$insert into public.pipeline_cards (person_id, column_id) values ('pre', 'registered')$$), '42501', 'a candidate cannot');

-- A deleted step sends the registered person''s card to Registered, and changes nothing about them ---------------------------------------------
select is(pg_temp.run_as(1, $$delete from public.pipeline_steps where id = 's-act'$$), 'rows=1', 'Pat deletes the step Bo''s card is in');
select pg_temp.as_postgres();
select is(pg_temp.card('prb') || ' ' || pg_temp.stage('prb'), 'registered ' || (select bo from before), 'the card is in Registered and Bo is untouched');

select * from finish();
rollback;
