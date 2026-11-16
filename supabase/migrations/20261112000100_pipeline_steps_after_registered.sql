-- Pipeline steps after Registered (part 1: the database).
--
-- A leader may add steps in a band after the Registered milestone (band 'registered', recruiting board only; the
-- customer board gets nothing). A registered person (apprentice or IBO) may have a card in Registered or in one of
-- those steps and move it between them, and nothing else. What changes, and nothing more:
--
--  * pipeline_steps.band accepts 'registered' (a step's id, label, owner, order, hides and deletes are unchanged:
--    deleting one still sends its cards to its band's milestone, here Registered).
--  * move_pipeline_card(): a registered person's card moves only between 'registered' and the steps of the registered
--    band, in either direction; it never changes their class, stage history or start date, and logs no registration.
--    A prospect still registers by moving into 'registered', and reaches the steps after it only that way.
--  * pipeline_moves_after_delete(): undoing a move into 'registered' un-registers the person only when it is the move
--    that registered them (their earliest move into the registered band), not a later move back from a step.
--  * pipeline_registered_card_column(person) / pipeline_registered_in_progress(person): the column a registered person's
--    card is in on their sponsor's board, or null (and false) when it is not in progress there (mirror of
--    src/data/pipeline/afterRegistered.ts). Only a board with at least one registered-band step has any.
--  * card_tasks_guard(): a task may be added to the card of a registered person while it is in progress.
--  * pipeline_cards: a registered person's card that has no stored row can be created (in Registered) so it can be
--    taken off the board and put back; cards are otherwise created and moved only by move_pipeline_card().
--  * agent_private.card_lookup() / card_docs() and agent_list_cards(): the connector reads, and works the tasks and
--    notes of, the cards of registered people in progress, with their column id and name. Agents still cannot move,
--    create or delete a card.
--
-- Functions are redefined with create or replace: owner, security setting, search_path and grants are those they have.

-- ---------------------------------------------------------------------------
-- The band
-- ---------------------------------------------------------------------------

alter table public.pipeline_steps drop constraint pipeline_steps_band_check;
alter table public.pipeline_steps add constraint pipeline_steps_band_check
  check (band in ('contact', 'first_meeting', 'first_plan', 'registered'));

-- ---------------------------------------------------------------------------
-- Is a registered person's card in progress?
--
-- On the board of the person's sponsor (its columns: board_columns('recruiting', sponsor), hidden steps left out):
--  * no step in the registered band: no (nothing after Registered exists, as before);
--  * the card is taken off the board: no;
--  * the cutoff is the first day, in the team's time zone, of the month in which the board's earliest registered-band
--    step was created;
--  * a card in one of the steps is in progress, except one in the board's LAST registered-band step (the finishing
--    column) that entered it before the current month: that one is finished;
--  * a person with no stored card, or a card in Registered (or in a column the board does not have: a step that is
--    hidden or deleted), is in progress when they registered on or after the cutoff. They registered on the day of
--    their earliest move into the registered band, else on their business start date.
-- ---------------------------------------------------------------------------

-- The board's steps after Registered are read from the sponsor line directly (as move_pipeline_card() reads them), not
-- through board_columns(), which shows a line only to people who can see its sponsor: the registered person themselves
-- cannot see theirs.
create function public.pipeline_registered_card_column(p_person_id text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_p public.people;
  v_tz text;
  v_steps text[];
  v_first timestamptz;
  v_cutoff date;
  v_card public.pipeline_cards;
  v_has_card boolean;
  v_col text;
  v_reg date;
begin
  select * into v_p from public.people p where p.id = p_person_id;
  if not found or v_p.biz_class not in ('apprentice', 'ibo') or v_p.sponsor_id is null
     or v_p.workspace_id is distinct from public.current_workspace_id()
     or p_person_id not in (select public.visible_person_ids()) then
    return null;
  end if;
  with recursive up (id, sponsor, d) as (
    select p.id, p.sponsor_id, 0 from public.people p where p.id = v_p.sponsor_id
    union all
    select s.id, s.sponsor_id, up.d + 1 from public.people s join up on s.id = up.sponsor where up.d < 100
  ), chain as (
    select up.id, (max(up.d) over () - up.d) as depth from up
  ), st as (
    select s.id, s.position, s.created_at, c.depth
      from public.pipeline_steps s join chain c on c.id = s.owner_id
     where s.band = 'registered' and s.workspace_id = v_p.workspace_id
       and not exists (select 1 from public.pipeline_step_hides h join chain c2 on c2.id = h.person_id
                        where h.step_id = s.id)
  )
  select array_agg(st.id order by st.depth, st.position, st.created_at, st.id), min(st.created_at)
    into v_steps, v_first from st;
  if v_steps is null then
    return null;
  end if;
  select * into v_card from public.pipeline_cards c where c.person_id = p_person_id;
  v_has_card := found;
  if v_has_card and v_card.dropped_at is not null then
    return null;
  end if;
  select w.timezone into v_tz from public.workspaces w where w.id = v_p.workspace_id;
  v_cutoff := date_trunc('month', v_first at time zone v_tz)::date;
  v_col := case when v_has_card and v_card.column_id = any (v_steps) then v_card.column_id else 'registered' end;
  if v_col = 'registered' then
    v_reg := coalesce((select min((m.moved_at at time zone v_tz)::date) from public.pipeline_moves m
                        where m.person_id = p_person_id and m.milestone = 'registered'),
                      v_p.business_start_date);
    return case when v_reg is not null and v_reg >= v_cutoff then 'registered' end;
  end if;
  if v_col = v_steps[array_length(v_steps, 1)]
     and to_char(v_card.entered_at at time zone v_tz, 'YYYY-MM')
         <> to_char(public.workspace_today(v_p.workspace_id), 'YYYY-MM') then
    return null;
  end if;
  return v_col;
end $$;

create function public.pipeline_registered_in_progress(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select public.pipeline_registered_card_column(p_person_id) is not null $$;

revoke execute on function public.pipeline_registered_card_column(text) from public, anon;
grant execute on function public.pipeline_registered_card_column(text) to authenticated;
revoke execute on function public.pipeline_registered_in_progress(text) from public, anon;
grant execute on function public.pipeline_registered_in_progress(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Moves: as in 20261016001500_referral_source.sql, with registered people.
-- ---------------------------------------------------------------------------

create or replace function public.move_pipeline_card(
  p_person_id text,
  p_to text,
  p_move_id text default null,
  p_next_column text default null,
  p_next_step_date date default null,
  p_next_step_time time default null,
  p_source text default null,
  p_hot boolean default null,
  p_rating text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_ws text := public.current_workspace_id();
  v_p public.people;
  v_card public.pipeline_cards;
  v_had_card boolean;
  v_registered boolean := false;
  v_band text;
  v_owner text;
  v_next text;
  v_date date;
  v_time time;
  v_move public.pipeline_moves;
begin
  if v_me is null or public.is_candidate() then
    raise exception 'Candidates don''t have a pipeline yet' using errcode = '42501';
  end if;
  select * into v_p from public.people p where p.id = p_person_id for update;
  if not found or v_p.workspace_id is distinct from v_ws or not public.can_see_person(p_person_id) then
    raise exception 'Person not found' using errcode = 'P0002';
  end if;
  if v_p.biz_class in ('apprentice', 'ibo') then
    v_registered := true;
  elsif v_p.biz_class <> 'prospect' then
    raise exception 'Only prospects move on the board' using errcode = '22023';
  end if;
  v_owner := coalesce(v_p.sponsor_id, v_me);

  v_band := case
    when p_to in ('contact', 'first_meeting', 'first_plan', 'registered') then p_to
    when p_to = 'not_contacted' then 'start'
    when p_to in ('referral_source', 'not_interested', 'do_not_contact') then 'out'
  end;
  if v_band is null then
    select s.band into v_band from public.pipeline_steps s
     where s.id = p_to and s.workspace_id = v_ws
       and (s.owner_id in (select c.person_id from public.sponsor_chain(v_owner) c)
            or s.owner_id in (select public.my_chain_ids()));
  end if;
  if v_band is null then
    raise exception 'That column isn''t on this board' using errcode = '22023';
  end if;
  -- A registered person's card stays in Registered or the steps after it; a prospect reaches those only by registering.
  if v_registered and v_band <> 'registered' then
    raise exception 'A registered person moves only between Registered and the steps after it' using errcode = '22023';
  end if;
  if not v_registered and v_band = 'registered' and p_to <> 'registered' then
    raise exception 'A prospect registers first, then moves through the steps after Registered' using errcode = '22023';
  end if;

  select * into v_card from public.pipeline_cards c where c.person_id = p_person_id for update;
  v_had_card := found;
  if v_had_card and v_card.dropped_at is not null then
    raise exception 'That card is off the board' using errcode = '22023';
  end if;
  if (v_had_card and v_card.column_id = p_to) or (v_registered and not v_had_card and p_to = 'registered') then
    raise exception 'Already there' using errcode = '22023';
  end if;

  -- The booking after the move.
  if nullif(trim(p_next_column), '') is not null and p_next_column <> p_to then
    v_next := p_next_column;
    v_date := p_next_step_date;
    v_time := case when p_next_step_date is not null then p_next_step_time end;
  elsif v_had_card and public.booking_kept('recruiting', v_owner, v_card.next_column, p_to) then
    v_next := v_card.next_column;
    v_date := v_card.next_step_date;
    v_time := v_card.next_step_time;
  end if;

  insert into public.pipeline_moves (id, workspace_id, person_id, owner_id, from_column, to_column,
                                     milestone, moved_at, moved_by, booking_before)
  values (coalesce(nullif(trim(p_move_id), ''), gen_random_uuid()::text), v_ws, p_person_id,
          v_owner, case when v_had_card then v_card.column_id end, p_to,
          v_band, now(), v_me,
          jsonb_build_object('next_column', v_card.next_column,
                             'next_step_date', v_card.next_step_date,
                             'next_step_time', v_card.next_step_time))
  returning * into v_move;

  insert into public.pipeline_cards (person_id, workspace_id, column_id, entered_at, next_column,
                                     next_step_date, next_step_time, hot, rating, source,
                                     dropped_at, updated_at)
  values (p_person_id, v_ws, p_to, v_move.moved_at, v_next, v_date, v_time,
          coalesce(p_hot, false), p_rating, nullif(trim(p_source), ''), null, now())
  on conflict (person_id) do update
     set column_id = excluded.column_id,
         entered_at = excluded.entered_at,
         next_column = excluded.next_column,
         next_step_date = excluded.next_step_date,
         next_step_time = excluded.next_step_time,
         hot = coalesce(p_hot, public.pipeline_cards.hot),
         rating = coalesce(p_rating, public.pipeline_cards.rating),
         source = coalesce(nullif(trim(p_source), ''), public.pipeline_cards.source),
         updated_at = now()
  returning * into v_card;

  if p_to = 'registered' and not v_registered then
    update public.people
       set biz_class = 'apprentice',
           pipeline_stage = 'apprentice',
           business_start_date = public.workspace_today(v_ws),
           stage_history = stage_history || jsonb_build_array(jsonb_build_object(
             'stage', 'apprentice',
             'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     where id = p_person_id;
    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                 related_person_id, kind, summary, meta)
    values (v_ws, coalesce((select p.name from public.people p where p.id = v_me), 'Someone'), v_me,
            'person', p_person_id, p_person_id, 'stage_changed', 'Pipeline → apprentice',
            jsonb_build_object('from', 'prospect', 'to', 'apprentice'));
  end if;

  return jsonb_build_object('move', to_jsonb(v_move), 'card', to_jsonb(v_card));
end $$;

-- Undoing a move: as in 20261014005000_pipeline_next_steps.sql, but only the move that registered the person
-- (their earliest move into the registered band) un-registers them.
create or replace function public.pipeline_moves_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor text := public.current_person_id();
begin
  if old.from_column is null then
    delete from public.pipeline_cards c
     where c.person_id = old.person_id and c.column_id = old.to_column;
  else
    update public.pipeline_cards c
       set column_id = old.from_column,
           entered_at = coalesce((select max(m.moved_at) from public.pipeline_moves m
                                  where m.person_id = old.person_id), c.entered_at),
           next_column = case when old.booking_before is null then c.next_column
                              else old.booking_before ->> 'next_column' end,
           next_step_date = case when old.booking_before is null then c.next_step_date
                                 else (old.booking_before ->> 'next_step_date')::date end,
           next_step_time = case when old.booking_before is null then c.next_step_time
                                 else (old.booking_before ->> 'next_step_time')::time end,
           updated_at = now()
     where c.person_id = old.person_id and c.column_id = old.to_column;
  end if;

  if old.to_column = 'registered'
     and not exists (select 1 from public.pipeline_moves m
                      where m.person_id = old.person_id and m.milestone = 'registered'
                        and (m.moved_at, m.id) < (old.moved_at, old.id)) then
    update public.people p
       set biz_class = 'prospect',
           pipeline_stage = 'prospect',
           business_start_date = null,
           stage_history = coalesce(p.stage_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'stage', 'prospect',
             'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
     where p.id = old.person_id and p.biz_class = 'apprentice';
    if found then
      insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                   related_person_id, kind, summary, meta)
      values (old.workspace_id,
              coalesce((select p.name from public.people p where p.id = v_actor), 'Someone'), v_actor,
              'person', old.person_id, old.person_id, 'stage_changed', 'Pipeline → prospect',
              jsonb_build_object('from', 'apprentice', 'to', 'prospect'));
    end if;
  end if;
  return old;
end $$;

-- A registered person's card with no stored row (they registered without the board, or before steps existed) is
-- created in Registered, so it can be taken off the board and put back. Nothing else creates a card but a move.
create policy "add the card of a registered person" on public.pipeline_cards
  for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and person_id in (select public.visible_person_ids())
    and not (select public.is_candidate())
    and column_id = 'registered'
    and exists (select 1 from public.people p
                 where p.id = person_id and p.biz_class in ('apprentice', 'ibo'))
  );

-- ---------------------------------------------------------------------------
-- Tasks: as in 20261108000100_card_tasks.sql, and the card of a registered person in progress takes them.
-- ---------------------------------------------------------------------------

create or replace function public.card_tasks_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_client boolean := public.is_client_write();
  v_ws text;
  v_owner text;
  v_biz text;
begin
  new.title := btrim(new.title);
  if new.person_id is not null then
    select p.workspace_id, p.sponsor_id, p.biz_class into v_ws, v_owner, v_biz
      from public.people p where p.id = new.person_id;
  else
    select e.workspace_id, e.owner_id into v_ws, v_owner
      from public.list_entries e where e.id = new.entry_id;
  end if;
  -- A client write to a card that does not exist (or is not readable) is refused. The database's own writes (a
  -- foreign key setting created_by or assignee_id null while the card is being deleted, the migration role) go on.
  if v_ws is null and v_client then
    raise exception 'No such card' using errcode = '42501';
  end if;
  if v_ws is not null and v_ws is distinct from new.workspace_id then
    raise exception 'The card is in another team' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_client then
      if new.person_id is not null and v_biz is distinct from 'prospect'
         and not (coalesce(v_biz in ('apprentice', 'ibo'), false)
                  and public.pipeline_registered_in_progress(new.person_id)) then
        raise exception 'Only a prospect has a card on the recruiting board' using errcode = '23514';
      end if;
      new.created_by := v_me;
      new.created_at := now();
      new.updated_at := now();
    end if;
    -- (the database's own writes, a migration, keep the created_at / updated_at they give)
  elsif v_client and (new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id
                      or new.person_id is distinct from old.person_id or new.entry_id is distinct from old.entry_id
                      or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at) then
    raise exception 'A task cannot move to another card, and who made it and when cannot change' using errcode = '42501';
  end if;

  -- The assignee: the card's owner or the caller, and registered.
  if v_client and new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    if not (new.assignee_id = v_me or new.assignee_id is not distinct from v_owner)
       or not public.card_task_registered(new.assignee_id) then
      raise exception 'A task goes to the card''s owner or to you' using errcode = '42501';
    end if;
  end if;

  -- done_at / done_by: stamped when ticked, cleared when unticked, never taken from the client.
  if tg_op = 'INSERT' then
    if new.done then
      if v_client or new.done_at is null then
        new.done_at := now();
        new.done_by := coalesce(new.done_by, v_me);
      end if;
    else
      new.done_at := null;
      new.done_by := null;
    end if;
  elsif not new.done then
    new.done_at := null;
    new.done_by := null;
  elsif not old.done then
    if v_client or new.done_at is null then
      new.done_at := now();
      new.done_by := case when v_client then v_me else coalesce(new.done_by, v_me) end;
    end if;
  elsif v_client then
    new.done_at := old.done_at;
    new.done_by := old.done_by;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The agent connector: cards of registered people in progress (as in 20261108000100_card_tasks.sql)
-- ---------------------------------------------------------------------------

create or replace function agent_private.card_lookup(p_board text, p_id text)
returns table (board text, card_id text, person_id text, entry_id text, name text, owner_id text,
               workspace_id text, off_board boolean)
language sql stable security invoker set search_path = ''
as $$
  select 'recruiting'::text, p.id, p.id, null::text, p.name, p.sponsor_id, p.workspace_id,
         coalesce(c.dropped_at is not null, false)
    from public.people p
    left join public.pipeline_cards c on c.person_id = p.id
   where p_board = 'recruiting' and p.id = p_id
     and (p.biz_class = 'prospect'
          or (p.biz_class in ('apprentice', 'ibo') and public.pipeline_registered_in_progress(p.id)))
  union all
  select 'customer'::text, e.id, null::text, e.id, e.name, e.owner_id, e.workspace_id, false
    from public.list_entries e
   where p_board = 'customer' and e.id = p_id
$$;

create or replace function agent_private.card_docs(p_boards text[], p_ids text[], p_caller text, p_workspace text, p_detail int)
returns setof jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_tz text;
begin
  select w.timezone into v_tz from public.workspaces w where w.id = p_workspace;
  return query
  with k as (
    select u.b as board, u.id, u.n from unnest(p_boards, p_ids) with ordinality u (b, id, n)
  ), cards as (
    select k.n, k.board, p.id as card_id, p.id as person_id, null::text as entry_id, p.name, p.sponsor_id as owner_id,
           null::text as customer_id,
           case when p.biz_class = 'prospect' then coalesce(c.column_id, 'contact')
                else public.pipeline_registered_card_column(p.id) end as column_id,
           (c.dropped_at is not null) as off_board
      from k
      join public.people p on k.board = 'recruiting' and p.id = k.id
           and (p.biz_class = 'prospect'
                or (p.biz_class in ('apprentice', 'ibo') and public.pipeline_registered_in_progress(p.id)))
      left join public.pipeline_cards c on c.person_id = p.id
    union all
    select k.n, k.board, e.id, null::text, e.id, e.name, e.owner_id, e.customer_id,
           coalesce(c.column_id, 'not_contacted'), false
      from k
      join public.list_entries e on k.board = 'customer' and e.id = k.id
      left join public.customer_cards c on c.entry_id = e.id
  ), tk as (
    select cd.n,
           count(t.id)::int as total,
           (count(t.id) filter (where t.done))::int as done_n,
           (array_agg(t.due_date order by t.due_date + coalesce(t.due_time, time '23:59:59.999999'))
              filter (where not t.done and t.due_date is not null))[1] as nd,
           (array_agg(t.due_time order by t.due_date + coalesce(t.due_time, time '23:59:59.999999'))
              filter (where not t.done and t.due_date is not null))[1] as nt,
           array_remove(array_agg(distinct t.assignee_id) filter (where not t.done), null) as assignees
      from cards cd
      left join public.card_tasks t on (t.person_id = cd.person_id or t.entry_id = cd.entry_id)
     group by cd.n
  ), nm as (
    select * from agent_private.card_names(array(
      select x.owner_id from cards x where x.owner_id is not null
      union select a from tk, unnest(tk.assignees) a
      union select n.author_id from public.card_notes n
             where p_detail >= 2 and (n.person_id in (select x.person_id from cards x) or n.entry_id in (select x.entry_id from cards x))))
  ), own as (
    select distinct x.board, coalesce(x.owner_id, p_caller) as owner from cards x
  ), cols as (
    select o.board, o.owner, bc.id, bc.label
      from own o cross join lateral public.board_columns(o.board, o.owner) bc
  ), sn as (
    select s.pipeline, s.stage_key, s.name from public.effective_stage_names(true) s
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'board', cd.board,
           'customer_id', cd.customer_id,
           'off_board', case when cd.off_board then true end,
           'next_due', case when tk.nd is null then null
                            when tk.nt is null then to_jsonb(tk.nd)
                            else to_jsonb(agent_private.fmt_local(tk.nd + tk.nt)) end,
           'timezone', case when tk.nt is not null then v_tz end))
         || jsonb_build_object(
              'person', jsonb_build_object('id', cd.card_id, 'full_name', cd.name),
              'owner', case when cd.owner_id is null then null
                            else jsonb_build_object('id', cd.owner_id, 'full_name', (select s.name from nm s where s.id = cd.owner_id)) end,
              'column', jsonb_build_object('id', cd.column_id, 'name', coalesce(
                          (select s.name from sn s where s.pipeline = cd.board and s.stage_key = cd.column_id),
                          (select l.label from cols l where l.board = cd.board and l.owner = coalesce(cd.owner_id, p_caller) and l.id = cd.column_id),
                          'Removed column')),
              'tasks_done', tk.done_n,
              'tasks_total', tk.total,
              'assignees', coalesce((select jsonb_agg(jsonb_build_object('id', a, 'full_name', (select s.name from nm s where s.id = a))
                                                      order by (select s.name from nm s where s.id = a), a)
                                       from unnest(tk.assignees) a), '[]'::jsonb),
              'notes_count', (select count(*)::int from public.card_notes n
                               where n.person_id = cd.person_id or n.entry_id = cd.entry_id))
         || case when p_detail >= 1 then jsonb_build_object('tasks', coalesce((
                   select jsonb_agg(x.d order by x.n)
                     from agent_private.card_task_docs(array(select t.id from public.card_tasks t
                                                              where t.person_id = cd.person_id or t.entry_id = cd.entry_id
                                                              order by t.position, t.created_at, t.id), p_workspace) with ordinality x (d, n)),
                   '[]'::jsonb)) else '{}'::jsonb end
         || case when p_detail >= 2 then jsonb_build_object(
                   'notes', coalesce((select jsonb_agg(jsonb_build_object(
                                'id', q.id,
                                'author', case when q.author_id is null then null
                                               else jsonb_build_object('id', q.author_id, 'full_name', (select s.name from nm s where s.id = q.author_id)) end,
                                'body', q.body, 'created_at', agent_private.fmt_utc(q.created_at)) order by q.created_at desc, q.id desc)
                                from (select n.* from public.card_notes n
                                       where n.person_id = cd.person_id or n.entry_id = cd.entry_id
                                       order by n.created_at desc, n.id desc limit 100) q), '[]'::jsonb),
                   'notes_truncated', (select count(*) from public.card_notes n
                                        where n.person_id = cd.person_id or n.entry_id = cd.entry_id) > 100)
                 else '{}'::jsonb end
    from cards cd
    join tk on tk.n = cd.n
   order by cd.n;
end
$$;

create or replace function public.agent_list_cards(
  p_board text default 'all', p_person_id text default null, p_mine_only boolean default true,
  p_has_open_tasks boolean default null, p_due_from date default null, p_due_until date default null,
  p_overdue boolean default false, p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_board text := coalesce(nullif(btrim(coalesce(p_board, '')), ''), 'all');
  v_mine boolean := coalesce(p_mine_only, true);
  v_overdue boolean := coalesce(p_overdue, false);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_args jsonb;
  v_problem text;
  v_tz text;
  v_now timestamp;
  v_post boolean;
  v_total int;
  v_all int;
  v_boards text[];
  v_ids text[];
  v_docs jsonb;
  v_filtered boolean;
  v_note text;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  v_args := jsonb_build_object('board', v_board, 'person_id', p_person_id, 'mine_only', v_mine,
                               'has_open_tasks', p_has_open_tasks, 'due_from', p_due_from, 'due_until', p_due_until,
                               'overdue', v_overdue, 'search', p_search, 'limit', v_limit, 'offset', v_offset);
  if v_board not in ('recruiting', 'customer', 'all') then
    v_problem := 'board must be recruiting, customer or all.';
  elsif p_due_from is not null and p_due_until is not null and p_due_until < p_due_from then
    v_problem := 'due_until must not be before due_from.';
  elsif char_length(coalesce(p_search, '')) > 100 then
    v_problem := 'search must be at most 100 characters.';
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'list_cards', v_args, 'refused: ' || v_problem);
    return jsonb_build_object('error', v_problem);
  end if;
  select w.timezone into v_tz from public.workspaces w where w.id = c.workspace_id;
  v_now := now() at time zone v_tz;
  -- Registered people have cards only where a step after Registered exists (nothing is looked up otherwise).
  v_post := exists (select 1 from public.pipeline_steps s where s.band = 'registered' and s.workspace_id = c.workspace_id);

  with base as (
    select 'recruiting'::text as board, p.id as card_id, p.name, p.sponsor_id as owner_id, null::text as customer_id,
           coalesce(k.dropped_at is not null, false) as off_board
      from public.people p
      left join public.pipeline_cards k on k.person_id = p.id
     where (p.biz_class = 'prospect'
            or (v_post and p.biz_class in ('apprentice', 'ibo') and public.pipeline_registered_in_progress(p.id)))
       and p.workspace_id = c.workspace_id
    union all
    select 'customer', e.id, e.name, e.owner_id, e.customer_id, false
      from public.list_entries e
     where e.workspace_id = c.workspace_id
  ), tk as (
    select t.person_id, t.entry_id,
           (count(*) filter (where not t.done))::int as open_n,
           min(t.due_date + coalesce(t.due_time, time '23:59:59.999999'))
             filter (where not t.done and t.due_date is not null) as nd
      from public.card_tasks t
     group by t.person_id, t.entry_id
  ), joined as (
    select b.board, b.card_id, b.name, b.owner_id, b.customer_id, coalesce(tk.open_n, 0) as open_n, tk.nd
      from base b
      left join tk on (b.board = 'recruiting' and tk.person_id = b.card_id)
                   or (b.board = 'customer' and tk.entry_id = b.card_id)
     where not b.off_board
  ), mineable as (
    select j.* from joined j where (not v_mine) or j.owner_id = c.person_id
  ), hits as (
    select m.*
      from mineable m
     where (v_board = 'all' or m.board = v_board)
       and (p_person_id is null or m.card_id = p_person_id or m.customer_id = p_person_id)
       and (p_has_open_tasks is null or (m.open_n > 0) = p_has_open_tasks)
       and (p_due_from is null or m.nd::date >= p_due_from)
       and (p_due_until is null or m.nd::date <= p_due_until)
       and (not v_overdue or m.nd < v_now)
       and (v_search is null or m.name ilike agent_private.like_pattern(v_search))
  ), page as (
    select h.board, h.card_id,
           row_number() over (order by (h.nd is null), h.nd, lower(h.name), h.name, h.board, h.card_id) as rn
      from hits h
     order by rn
     limit v_limit offset v_offset
  )
  select (select count(*)::int from hits), (select count(*)::int from mineable),
         coalesce((select array_agg(g.board order by g.rn) from page g), '{}'::text[]),
         coalesce((select array_agg(g.card_id order by g.rn) from page g), '{}'::text[])
    into v_total, v_all, v_boards, v_ids;

  select coalesce(jsonb_agg(d.doc order by d.n), '[]'::jsonb) into v_docs
    from agent_private.card_docs(v_boards, v_ids, c.person_id, c.workspace_id, 0) with ordinality d (doc, n);

  v_filtered := v_board <> 'all' or p_person_id is not null or p_has_open_tasks is not null or p_due_from is not null
                or p_due_until is not null or v_overdue or v_search is not null;
  v_note := case
    when v_total = 0 and v_all = 0 and v_mine then
      'You own no cards yet: a card is a prospect on the recruiting board or a name on the customer board, and a prospect has one as soon as add_prospect adds them. Use mine_only false to see your team''s cards.'
    when v_total = 0 and v_all = 0 then
      'There are no cards you can see: a card is a prospect on the recruiting board or a name on the customer board. Use add_prospect to add a prospect.'
    when v_total = 0 then
      'No card matches' || case when v_filtered then ' those filters' else '' end
      || case when v_mine then ' among the cards you own; mine_only false looks at your team''s too' else '' end || '.'
    when jsonb_array_length(v_docs) = 0 then 'offset is past the last card (total ' || v_total || ').'
  end;
  v_out := jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'timezone', v_tz, 'cards', v_docs)
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  perform agent_private.audit(c.connection_id, 'list_cards', v_args,
                              jsonb_array_length(v_docs) || ' of ' || v_total || ' rows');
  return v_out;
end
$$;
