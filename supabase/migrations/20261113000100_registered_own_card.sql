-- A registered person's own card: they can read it, not change it (follow-up to 20261112000100), and the agent
-- connector's card documents name the step it is in.
--
--  * move_pipeline_card(): a registered person (apprentice or IBO) moving their own card is refused (42501). The
--    owner, their upline and a deputy move it as before. A leader with no sponsor has no card, so nothing changes.
--  * pipeline_cards policies: the person themselves can no longer update, delete or insert their own card row
--    (they could, because they can see themselves): taking it off the board, putting it back or removing the row
--    would otherwise do what a move cannot. Reading stays. Tasks and notes on it follow their own rules.
--  * agent_private.card_docs(): a registered person looking at their own card in a step got the right column id and
--    the name 'Removed column'.
--
-- Functions are redefined with create or replace: owner, security setting, search_path and grants are those they
-- have. Policies are changed with alter policy: same names, same roles.


-- ---------------------------------------------------------------------------
-- Cards: nobody writes their own card row
-- ---------------------------------------------------------------------------

alter policy "edit cards of visible people" on public.pipeline_cards
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids())
         and person_id <> (select public.current_person_id())
         and not (select public.is_candidate()));
alter policy "remove cards of visible people" on public.pipeline_cards
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids())
         and person_id <> (select public.current_person_id())
         and not (select public.is_candidate()));
alter policy "add the card of a registered person" on public.pipeline_cards
  with check (
    workspace_id = (select public.current_workspace_id())
    and person_id in (select public.visible_person_ids())
    and person_id <> (select public.current_person_id())
    and not (select public.is_candidate())
    and column_id = 'registered'
    and exists (select 1 from public.people p
                 where p.id = person_id and p.biz_class in ('apprentice', 'ibo'))
  );

-- ---------------------------------------------------------------------------
-- Moves
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
  -- Nobody moves their own card: a registered person can see theirs (they are on their sponsor's board) but not change it.
  -- (After the column checks above, so a move that was never allowed is refused for the reason it always was.)
  if v_registered and p_person_id = v_me then
    raise exception 'You can''t change your own card' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- The agent connector's card documents
-- ---------------------------------------------------------------------------

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
                          -- A registered person looking at their own card: board_columns() shows a sponsor line only to people who
                          -- can see its sponsor, which they cannot, so the step's name is read from the steps they can read (their
                          -- own sponsor line), as pipeline_registered_card_column() reads them.
                          (select st.label from public.pipeline_steps st
                            where cd.board = 'recruiting' and st.id = cd.column_id and st.band = 'registered'
                              and st.workspace_id = p_workspace),
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
