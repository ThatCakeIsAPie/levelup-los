-- Pipeline cards: tasks, due dates and notes (part 1 of 2: the database and the agent tools; the app is part 2).
--
-- A card on either pipeline board (the recruiting board: a prospect; the customer board: a name on someone's list)
-- gains a checklist of TASKS and a running log of NOTES. The boards, their columns and moves are not changed, and
-- the cards' own booking columns (next_column, next_step_date, next_step_time) and note column are neither read nor
-- written by anything here. The card's due date is the earliest due date among its open tasks: there is no
-- due-date or assignee column on the cards.
--
-- Rows can also be written with no signed-in person (a migration running as the table owner): created_by, done_by,
-- assignee_id and author_id are nullable, nothing is required from a session, and the guards skip the who-may-do-what
-- checks for any writer that is not `authenticated`.
--
--   card_tasks   id, workspace_id, person_id | entry_id (the card), title, done, done_at, done_by, due_date, due_time,
--                assignee_id, position, created_by, created_at, updated_at
--   card_notes   id, workspace_id, person_id | entry_id (the card), author_id, body, created_at        (never edited)
--
-- HOW A TASK POINTS AT ITS CARD. A card is keyed by the prospect (pipeline_cards.person_id) or by the list name
-- (customer_cards.entry_id), but the board shows a card for EVERY prospect and EVERY list name: one that has never
-- moved has no stored row (the app's implicitCard() / implicitCustomerCard(); add_prospect and the People page leave
-- none), and undoing the move that created a card deletes its row while the prospect stays on the board. A task that
-- pointed at the stored row could not exist for those cards, and would vanish on an undo. So a task points at what
-- the card is about: `person_id` (the prospect, references people, recruiting board) or `entry_id` (the list name,
-- references list_entries, customer board), exactly one of them. Deleting the person, or the name from the list (which
-- also deletes its stored card), deletes the tasks and notes by cascade; the stored card row is not their parent.
--
-- WHO MAY DO WHAT. Exactly what the cards' own policies allow: whoever may read a card reads its tasks and notes;
-- whoever may edit a card adds, changes, ticks and deletes its tasks; whoever may read a card adds a note; an author
-- deletes their own note. The predicates are the cards' (recruiting: the prospect is in visible_person_ids() and the
-- caller is not a candidate; customer: list_entry_visible()), written so a policy tests membership once per
-- statement; pgTAP proves they agree with the stored cards' policies. The assignee, when set, must be the card's
-- owner (a prospect's sponsor; the list's owner) or the caller, and a registered person.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The list names the caller may read: the set form of list_entry_visible().
create function public.card_entry_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  select e.id
    from public.list_entries e
   where e.workspace_id = public.current_workspace_id()
     and not public.is_candidate()
     and e.owner_id in (select public.visible_person_ids())
$$;

-- A registered person: effective stage apprentice or IBO, or the team's leader.
create function public.card_task_registered(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.people p
     where p.id = p_person_id
       and p.workspace_id = public.current_workspace_id()
       and (public.effective_biz_class(p.biz_class, p.business_start_date) in ('apprentice', 'ibo')
            or exists (select 1 from public.members m
                        where m.person_id = p.id and m.workspace_id = p.workspace_id and m.role = 'leader')))
$$;

-- The people the caller is an upline of: exactly the ids for which is_upline_of() is true, as one set.
create function public.card_upline_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  select v.id
    from public.visible_person_ids() v (id)
   where v.id is distinct from public.current_person_id()
     and v.id not in (select public.deputy_leader_ids())
     and exists (select 1 from public.people p
                  where p.id = v.id and p.biz_class <> 'customer'
                    and p.workspace_id = public.current_workspace_id())
$$;

-- Who owns a card: a prospect's sponsor, a list's owner.
create function public.card_owner(p_person_id text, p_entry_id text) returns text
language sql stable security definer set search_path = ''
as $$
  select case when p_person_id is not null
              then (select p.sponsor_id from public.people p
                     where p.id = p_person_id and p.id in (select public.visible_person_ids()))
              else (select e.owner_id from public.list_entries e
                     where e.id = p_entry_id and e.id in (select public.card_entry_ids())) end
$$;

revoke all on function
  public.card_entry_ids(), public.card_task_registered(text), public.card_upline_ids(), public.card_owner(text, text)
  from public, anon;
grant execute on function
  public.card_entry_ids(), public.card_task_registered(text), public.card_upline_ids(), public.card_owner(text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.card_tasks (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- The card: the prospect on the recruiting board, or the name on the customer board; exactly one.
  person_id text references public.people (id) on delete cascade,
  entry_id text references public.list_entries (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  -- Stamped by a trigger when the task is ticked, cleared when it is unticked.
  done_at timestamptz,
  done_by text references public.people (id) on delete set null,
  -- A date, and a time of day on it: wall clock in the team's time zone (workspaces.timezone), like
  -- events.start_time. A time needs a date. No time means due at the end of that day.
  due_date date,
  due_time time,
  -- Who has to do it: the card's owner or the person who set it (checked by a trigger). Null: whoever owns the card.
  assignee_id text references public.people (id) on delete set null,
  position integer not null default 0 check (position >= 0),
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint card_tasks_one_card check (num_nonnulls(person_id, entry_id) = 1),
  constraint card_tasks_due_time_needs_date check (due_time is null or due_date is not null),
  constraint card_tasks_done_stamp check (done = (done_at is not null))
);
comment on table public.card_tasks is
  'A checklist item on a pipeline card (recruiting: the prospect; customer: the list name). Read and edited by whoever reads and edits the card.';
comment on column public.card_tasks.due_time is
  'Wall-clock time on due_date in the team''s time zone (workspaces.timezone); null = no time (due at the end of the day).';
create index card_tasks_person_idx on public.card_tasks (person_id, position) where person_id is not null;
create index card_tasks_entry_idx on public.card_tasks (entry_id, position) where entry_id is not null;
create index card_tasks_assignee_idx on public.card_tasks (assignee_id) where assignee_id is not null and not done;
create index card_tasks_workspace_due_idx on public.card_tasks (workspace_id, due_date);

create table public.card_notes (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  person_id text references public.people (id) on delete cascade,
  entry_id text references public.list_entries (id) on delete cascade,
  -- Always the caller on a client write (set by a trigger). Null if the author was removed.
  author_id text default public.current_person_id() references public.people (id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint card_notes_one_card check (num_nonnulls(person_id, entry_id) = 1)
);
comment on table public.card_notes is 'The running log of a pipeline card, newest last by created_at. Notes are never edited.';
create index card_notes_person_idx on public.card_notes (person_id, created_at desc) where person_id is not null;
create index card_notes_entry_idx on public.card_notes (entry_id, created_at desc) where entry_id is not null;

-- ---------------------------------------------------------------------------
-- Guards and stamps (direct client writes: the app and the agent connector run as `authenticated`; the database's
-- own functions and the seed skip the who-may-do-what checks, like every other guard trigger)
-- ---------------------------------------------------------------------------

create function public.card_tasks_guard() returns trigger
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
      if new.person_id is not null and v_biz is distinct from 'prospect' then
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

create trigger card_tasks_guard before insert or update on public.card_tasks
  for each row execute function public.card_tasks_guard();

create function public.card_notes_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_ws text;
begin
  new.body := btrim(new.body);
  if new.person_id is not null then
    select p.workspace_id into v_ws from public.people p where p.id = new.person_id;
  else
    select e.workspace_id into v_ws from public.list_entries e where e.id = new.entry_id;
  end if;
  if v_ws is null and public.is_client_write() then
    raise exception 'No such card' using errcode = '42501';
  end if;
  if v_ws is not null and v_ws is distinct from new.workspace_id then
    raise exception 'The card is in another team' using errcode = '23514';
  end if;
  if public.is_client_write() then
    new.author_id := public.current_person_id();
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger card_notes_guard before insert on public.card_notes
  for each row execute function public.card_notes_guard();

revoke execute on function public.card_tasks_guard(), public.card_notes_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: the cards' own rules
-- ---------------------------------------------------------------------------

alter table public.card_tasks enable row level security;
alter table public.card_notes enable row level security;

revoke all on public.card_tasks, public.card_notes from public, anon, authenticated;
grant select, insert, update, delete on public.card_tasks, public.card_notes to authenticated;

-- Recruiting: "read cards of visible people" / "edit cards of visible people" (pipeline_cards): the prospect is in
-- visible_person_ids() and the caller is not a candidate. Customer: "read customer cards of your team" / "edit
-- customer cards of your team": list_entry_visible(entry_id). Reading and editing are the same people on both boards.
create policy "read tasks of your cards" on public.card_tasks
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and ((person_id is not null and person_id in (select public.visible_person_ids())
               and not (select public.is_candidate()))
              or (entry_id is not null and entry_id in (select public.card_entry_ids()))));
create policy "add tasks to your cards" on public.card_tasks
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and ((person_id is not null and person_id in (select public.visible_person_ids())
                    and not (select public.is_candidate()))
                   or (entry_id is not null and entry_id in (select public.card_entry_ids()))));
create policy "change tasks of your cards" on public.card_tasks
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and ((person_id is not null and person_id in (select public.visible_person_ids())
               and not (select public.is_candidate()))
              or (entry_id is not null and entry_id in (select public.card_entry_ids()))));
create policy "remove tasks of your cards" on public.card_tasks
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and ((person_id is not null and person_id in (select public.visible_person_ids())
               and not (select public.is_candidate()))
              or (entry_id is not null and entry_id in (select public.card_entry_ids()))));

-- Notes: whoever reads the card reads and adds notes (as themself); the author deletes their own; no edits.
create policy "read notes of your cards" on public.card_notes
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and ((person_id is not null and person_id in (select public.visible_person_ids())
               and not (select public.is_candidate()))
              or (entry_id is not null and entry_id in (select public.card_entry_ids()))));
create policy "add notes to your cards" on public.card_notes
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and author_id = (select public.current_person_id())
              and ((person_id is not null and person_id in (select public.visible_person_ids())
                    and not (select public.is_candidate()))
                   or (entry_id is not null and entry_id in (select public.card_entry_ids()))));
create policy "authors remove their notes" on public.card_notes
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and author_id = (select public.current_person_id())
         and ((person_id is not null and person_id in (select public.visible_person_ids())
               and not (select public.is_candidate()))
              or (entry_id is not null and entry_id in (select public.card_entry_ids()))));

-- ---------------------------------------------------------------------------
-- Agent tools (plan: docs/plans/agent-connector-2026-11-14.md). One `agent_*` function each here and one entry in
-- supabase/functions/agent/tools.ts. They run as the person, so the policies above decide what is seen and changed.
-- A task is a VTODO (iCalendar, RFC 5545): uid, summary, due, status NEEDS-ACTION / COMPLETED, completed, created,
-- last_modified, with the CRM's own fields beside it. No tool creates, moves, books or deletes a card, and none
-- deletes a task or a note. IBO# and LTD# are read by none of them.
-- ---------------------------------------------------------------------------

-- Names for ids, as the caller: people they can read, else the chat directory (an upline who took a task on a
-- downline's card is not a person the downline can read, but is in the directory). The directory is only read
-- when a name is missing.
create function agent_private.card_names(p_ids text[]) returns table (id text, name text)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_missing text[];
begin
  return query select p.id, p.name from public.people p where p.id = any (p_ids);
  select array(select x from unnest(p_ids) x where x is not null and not exists (select 1 from public.people p where p.id = x))
    into v_missing;
  if cardinality(v_missing) > 0 then
    return query select d.person_id, d.name from public.chat_directory d where d.person_id = any (v_missing);
  end if;
end
$$;

-- One card as the caller may address it: board 'recruiting' (p_id is a prospect's id) or 'customer' (p_id is the id
-- of a name on a list). Nothing when it does not exist or the caller cannot read it (row-level security).
create function agent_private.card_lookup(p_board text, p_id text)
returns table (board text, card_id text, person_id text, entry_id text, name text, owner_id text,
               workspace_id text, off_board boolean)
language sql stable security invoker set search_path = ''
as $$
  select 'recruiting'::text, p.id, p.id, null::text, p.name, p.sponsor_id, p.workspace_id,
         coalesce(c.dropped_at is not null, false)
    from public.people p
    left join public.pipeline_cards c on c.person_id = p.id
   where p_board = 'recruiting' and p.id = p_id and p.biz_class = 'prospect'
  union all
  select 'customer'::text, e.id, null::text, e.id, e.name, e.owner_id, e.workspace_id, false
    from public.list_entries e
   where p_board = 'customer' and e.id = p_id
$$;

-- The audit row's "what it was about", where add_prospect records its prospect (new_values): the card's person id
-- and name (for the customer board: the list name's id and name) and the board.
create function agent_private.card_stamp(p_board text, p_id text) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('id', k.card_id, 'name', k.name, 'board', k.board)
    from agent_private.card_lookup(p_board, p_id) k
$$;

create function agent_private.task_stamp(p_task_id text) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object('task_id', t.id, 'title', t.title, 'done', t.done, 'due_date', t.due_date,
                            'due_time', to_char(t.due_time, 'HH24:MI'), 'assignee_id', t.assignee_id)
    from public.card_tasks t where t.id = p_task_id
$$;

-- Tasks as tool results (VTODO plus the CRM's fields), in the order of p_ids; the ones the caller can read.
create function agent_private.card_task_docs(p_ids text[], p_workspace text) returns setof jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_tz text;
begin
  select w.timezone into v_tz from public.workspaces w where w.id = p_workspace;
  return query
  with ts as (
    select u.n, t.id, t.person_id, t.entry_id, t.title, t.done, t.done_at, t.done_by, t.due_date, t.due_time,
           t.assignee_id, t.position, t.created_at, t.updated_at
      from unnest(p_ids) with ordinality u (id, n)
      join public.card_tasks t on t.id = u.id
  ), nm as (
    select * from agent_private.card_names(array(select x.assignee_id from ts x where x.assignee_id is not null
                                                 union select x.done_by from ts x where x.done_by is not null))
  )
  select jsonb_strip_nulls(jsonb_build_object(
           'id', ts.id,
           'uid', ts.id || '@card-tasks.invalid',
           'summary', ts.title,
           'status', case when ts.done then 'COMPLETED' else 'NEEDS-ACTION' end,
           'done', ts.done,
           'due', case when ts.due_date is null then null
                       when ts.due_time is null then to_jsonb(ts.due_date)
                       else to_jsonb(agent_private.fmt_local(ts.due_date + ts.due_time)) end,
           'due_date', ts.due_date,
           'due_time', to_char(ts.due_time, 'HH24:MI'),
           'timezone', case when ts.due_time is not null then v_tz end,
           'due_utc', case when ts.due_time is not null
                           then agent_private.fmt_utc(agent_private.zoned_instant(ts.due_date + ts.due_time, v_tz)) end,
           'completed', agent_private.fmt_utc(ts.done_at),
           'created', agent_private.fmt_utc(ts.created_at),
           'last_modified', agent_private.fmt_utc(ts.updated_at),
           'completed_by', case when ts.done_by is not null
                                then jsonb_build_object('id', ts.done_by, 'full_name', (select s.name from nm s where s.id = ts.done_by)) end))
         || jsonb_build_object(
              'card', jsonb_build_object(
                'board', case when ts.person_id is not null then 'recruiting' else 'customer' end,
                'person', jsonb_build_object('id', coalesce(ts.person_id, ts.entry_id),
                                             'full_name', coalesce(p.name, e.name))),
              'assignee', case when ts.assignee_id is null then null
                               else jsonb_build_object('id', ts.assignee_id, 'full_name', (select s.name from nm s where s.id = ts.assignee_id)) end,
              'position', ts.position)
    from ts
    left join public.people p on p.id = ts.person_id
    left join public.list_entries e on e.id = ts.entry_id
   order by ts.n;
end
$$;

-- Cards as tool results, in the order of the (board, id) pairs; the ones the caller can read (a recruiting card is a
-- prospect, with the stored card's column and booking if it has one, else Contact made; a customer card is a list
-- name, else Not contacted yet). p_detail 0: the summary; 1: + all the tasks; 2: + the notes (newest first, 100).
-- The column names are the caller's: board_columns() for the owner's board, with a renamed milestone shown as the
-- caller's own stage name (effective_stage_names(), the resolver the app uses). `next_due` (the earliest due among
-- the card's open tasks) is the card's due date. The card's booking columns are not read here.
create function agent_private.card_docs(p_boards text[], p_ids text[], p_caller text, p_workspace text, p_detail int)
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
           null::text as customer_id, coalesce(c.column_id, 'contact') as column_id, (c.dropped_at is not null) as off_board
      from k
      join public.people p on k.board = 'recruiting' and p.id = k.id and p.biz_class = 'prospect'
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

revoke all on function
  agent_private.card_names(text[]), agent_private.card_lookup(text, text), agent_private.card_stamp(text, text),
  agent_private.task_stamp(text), agent_private.card_task_docs(text[], text),
  agent_private.card_docs(text[], text[], text, text, int)
  from public, anon, service_role;
grant execute on function
  agent_private.card_names(text[]), agent_private.card_lookup(text, text), agent_private.card_stamp(text, text),
  agent_private.task_stamp(text), agent_private.card_task_docs(text[], text),
  agent_private.card_docs(text[], text[], text, text, int)
  to authenticated;

-- ---------------------------------------------------------------------------
-- whoami: the new tools in `can`, and open_tasks (open tasks assigned to the caller, or unassigned on the caller's
-- own cards)
-- ---------------------------------------------------------------------------

create or replace function public.agent_whoami() returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_out jsonb;
  v_read constant text[] := array['whoami', 'list_prospects', 'list_team', 'list_customers', 'get_person',
                                  'list_upcoming_events', 'export_events_ics', 'list_learning',
                                  'list_cards', 'get_card', 'list_card_tasks'];
  v_write constant text[] := array['add_prospect', 'update_prospect', 'update_my_profile', 'log_learning',
                                   'set_event_answer', 'add_card_task', 'update_card_task', 'complete_card_task',
                                   'add_card_note'];
begin
  select * into c from agent_private.ctx(false);
  select jsonb_build_object(
           'person', jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'stage', public.effective_biz_class(p.biz_class, p.business_start_date)),
           'team_role', (select m.role from public.members m
                          where m.user_id = auth.uid() and m.person_id = c.person_id limit 1),
           'team', (select w.name from public.workspaces w where w.id = c.workspace_id),
           'today', public.workspace_today(c.workspace_id),
           'access', c.access,
           'can', to_jsonb(case when c.access = 'write' then v_read || v_write else v_read end),
           'team_size', (select count(*)::int from agent_private.team(c.person_id)),
           'open_tasks', (select count(*)::int
                            from public.card_tasks t
                            left join public.people cp on cp.id = t.person_id
                            left join public.list_entries ce on ce.id = t.entry_id
                           where not t.done
                             and (t.assignee_id = c.person_id
                                  or (t.assignee_id is null and coalesce(cp.sponsor_id, ce.owner_id) = c.person_id))))
    into v_out
    from public.people p where p.id = c.person_id;
  perform agent_private.audit(c.connection_id, 'whoami', '{}'::jsonb, 'ok');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- list_cards
-- ---------------------------------------------------------------------------

-- The cards the caller can read, one per prospect on the recruiting board and per name on the customer board (a card
-- that never moved has no stored row but is on the board all the same). Filters: board (all by default), person_id
-- (the prospect, or on the customer board the name's id or the linked customer's id), mine_only (default true: the
-- cards the caller owns), has_open_tasks (true: at least one open task, false: none), due_from / due_until (the
-- card's next due date: the earliest open task, inclusive), overdue (an open task due before the team's now; a task
-- with no time is due at the end of its day), search (the person's name). Cards with a next due first, by it, then
-- by name. Cards taken off the board are left out. Result: {total, limit, offset, timezone, cards, note?}.
create function public.agent_list_cards(
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

  with base as (
    select 'recruiting'::text as board, p.id as card_id, p.name, p.sponsor_id as owner_id, null::text as customer_id,
           coalesce(k.dropped_at is not null, false) as off_board
      from public.people p
      left join public.pipeline_cards k on k.person_id = p.id
     where p.biz_class = 'prospect' and p.workspace_id = c.workspace_id
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

-- ---------------------------------------------------------------------------
-- get_card
-- ---------------------------------------------------------------------------

-- One card with everything: its summary, all its tasks (in position order) and its notes (newest first, the 100
-- newest, `notes_truncated`). A card the caller cannot read, an id that is no card on that board and an id that does
-- not exist all give the same refusal.
create function public.agent_get_card(p_person_id text, p_board text default 'recruiting') returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_board text := coalesce(nullif(btrim(coalesce(p_board, '')), ''), 'recruiting');
  v_args jsonb := jsonb_build_object('person_id', p_person_id, 'board', p_board);
  k record;
  v_doc jsonb;
begin
  select * into c from agent_private.ctx(false);
  if v_board not in ('recruiting', 'customer') then
    perform agent_private.audit(c.connection_id, 'get_card', v_args, 'refused: board must be recruiting or customer');
    return jsonb_build_object('error', 'board must be recruiting or customer.');
  end if;
  select * into k from agent_private.card_lookup(v_board, p_person_id);
  if not found then
    perform agent_private.audit(c.connection_id, 'get_card', v_args, 'refused: no such card among the visible ones');
    return jsonb_build_object('error', 'No such card among the cards you can see on the ' || v_board || ' board.');
  end if;
  select d into v_doc from agent_private.card_docs(array[v_board], array[k.card_id], c.person_id, c.workspace_id, 2) d;
  perform agent_private.audit(c.connection_id, 'get_card', v_args, 'viewed card', null,
                              agent_private.card_stamp(v_board, k.card_id));
  return v_doc;
end
$$;

-- ---------------------------------------------------------------------------
-- list_card_tasks
-- ---------------------------------------------------------------------------

-- Tasks across the cards the caller can read. status (open by default, done, all); due_from / due_until (the due
-- date, inclusive); overdue (open and due before the team's now); assigned: me (default: assigned to the caller, or
-- unassigned on a card the caller owns), team (assigned to a person the caller is an upline of, or unassigned on a
-- card such a person owns), all (every task visible); person_id (the card: a prospect, or a list name's id or the
-- linked customer's); changed_since. Dated tasks first by due date and time (no time: end of the day), then the
-- undated by position. Result: {total, limit, offset, timezone, tasks, note?}.
create function public.agent_list_card_tasks(
  p_status text default 'open', p_due_from date default null, p_due_until date default null,
  p_overdue boolean default false, p_assigned text default 'me', p_person_id text default null,
  p_changed_since timestamptz default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_status text := coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'open');
  v_assigned text := coalesce(nullif(btrim(coalesce(p_assigned, '')), ''), 'me');
  v_overdue boolean := coalesce(p_overdue, false);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_args jsonb;
  v_problem text;
  v_tz text;
  v_now timestamp;
  v_total int;
  v_ids text[];
  v_docs jsonb;
  v_filtered boolean;
  v_note text;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  v_args := jsonb_build_object('status', v_status, 'due_from', p_due_from, 'due_until', p_due_until,
                               'overdue', v_overdue, 'assigned', v_assigned, 'person_id', p_person_id,
                               'changed_since', p_changed_since, 'limit', v_limit, 'offset', v_offset);
  if v_status not in ('open', 'done', 'all') then
    v_problem := 'status must be open, done or all.';
  elsif v_assigned not in ('me', 'team', 'all') then
    v_problem := 'assigned must be me, team or all.';
  elsif v_overdue and v_status = 'done' then
    v_problem := 'overdue means open and past due: use status open (the default) or all, or leave overdue out.';
  elsif p_due_from is not null and p_due_until is not null and p_due_until < p_due_from then
    v_problem := 'due_until must not be before due_from.';
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'list_card_tasks', v_args, 'refused: ' || v_problem);
    return jsonb_build_object('error', v_problem);
  end if;
  select w.timezone into v_tz from public.workspaces w where w.id = c.workspace_id;
  v_now := now() at time zone v_tz;

  with tx as (
    select t.id, t.done, t.due_date, t.due_time, t.assignee_id, t.position, t.created_at, t.updated_at,
           coalesce(t.person_id, t.entry_id) as card_id, t.person_id, t.entry_id,
           coalesce(cp.sponsor_id, ce.owner_id) as owner_id, ce.customer_id,
           t.due_date + coalesce(t.due_time, time '23:59:59.999999') as due_at
      from public.card_tasks t
      left join public.people cp on cp.id = t.person_id
      left join public.list_entries ce on ce.id = t.entry_id
     where t.workspace_id = c.workspace_id
  ), hits as (
    select x.*
      from tx x
     where (v_status = 'all' or (v_status = 'open' and not x.done) or (v_status = 'done' and x.done))
       and (p_due_from is null or x.due_date >= p_due_from)
       and (p_due_until is null or x.due_date <= p_due_until)
       and (not v_overdue or (not x.done and x.due_at < v_now))
       and (v_assigned = 'all'
            or (v_assigned = 'me' and (x.assignee_id = c.person_id or (x.assignee_id is null and x.owner_id = c.person_id)))
            or (v_assigned = 'team'
                and ((x.assignee_id is not null and x.assignee_id <> c.person_id
                      and x.assignee_id in (select public.card_upline_ids()))
                     or (x.assignee_id is null and x.owner_id in (select public.card_upline_ids())))))
       and (p_person_id is null or x.card_id = p_person_id or x.customer_id = p_person_id)
       and (p_changed_since is null or x.updated_at > p_changed_since)
  ), page as (
    select h.id,
           row_number() over (order by (h.due_date is null), h.due_at, h.position, h.created_at, h.id) as rn
      from hits h
     order by rn
     limit v_limit offset v_offset
  )
  select (select count(*)::int from hits), coalesce((select array_agg(g.id order by g.rn) from page g), '{}'::text[])
    into v_total, v_ids;

  select coalesce(jsonb_agg(d.doc order by d.n), '[]'::jsonb) into v_docs
    from agent_private.card_task_docs(v_ids, c.workspace_id) with ordinality d (doc, n);

  v_filtered := p_due_from is not null or p_due_until is not null or v_overdue or p_person_id is not null
                or p_changed_since is not null;
  v_note := case
    when v_total = 0 then
      'No ' || case v_status when 'open' then 'open ' when 'done' then 'done ' else '' end || 'tasks'
      || case v_assigned when 'team' then ' for your team' when 'all' then '' else ' for you' end
      || case when v_filtered then ' match those filters' else '' end || '. '
      || case when v_filtered or v_status <> 'open' or v_assigned <> 'me'
              then 'Try status all, assigned all or fewer filters. ' else '' end
      || 'Use add_card_task to add one to a card (list_cards shows the cards).'
    when jsonb_array_length(v_docs) = 0 then 'offset is past the last task (total ' || v_total || ').'
  end;
  v_out := jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'timezone', v_tz, 'tasks', v_docs)
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  perform agent_private.audit(c.connection_id, 'list_card_tasks', v_args,
                              jsonb_array_length(v_docs) || ' of ' || v_total || ' rows');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- add_card_task
-- ---------------------------------------------------------------------------

-- One more task at the end of a card's checklist (at most 100 in all): title, optional due_date and due_time (a time
-- needs a date), optional assignee_id (the card's owner or the caller; none: whoever owns the card). Returns the
-- card with its tasks and the new task as `task`.
create function public.agent_add_card_task(
  p_person_id text, p_title text, p_board text default 'recruiting', p_due_date date default null,
  p_due_time time default null, p_assignee_id text default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_board text := coalesce(nullif(btrim(coalesce(p_board, '')), ''), 'recruiting');
  v_args jsonb := jsonb_build_object('person_id', p_person_id, 'board', p_board, 'title', p_title,
                                     'due_date', p_due_date, 'due_time', p_due_time, 'assignee_id', p_assignee_id);
  v_title text := btrim(coalesce(p_title, ''));
  v_assignee text := nullif(btrim(coalesce(p_assignee_id, '')), '');
  v_id text := gen_random_uuid()::text;
  k record;
  v_problem text;
  v_doc jsonb;
begin
  select * into c from agent_private.ctx(true);
  if v_board not in ('recruiting', 'customer') then
    v_problem := 'board must be recruiting or customer.';
  elsif char_length(v_title) not between 1 and 200 then
    v_problem := 'title must be 1 to 200 characters.';
  elsif p_due_time is not null and p_due_date is null then
    v_problem := 'due_time needs a due_date: a time of day belongs to a day.';
  elsif p_due_date is not null and p_due_date not between date '2000-01-01' and date '2100-01-01' then
    v_problem := 'due_date must be between 2000-01-01 and 2100-01-01.';
  elsif p_due_time is not null and extract(second from p_due_time) <> 0 then
    v_problem := 'due_time must be a time of day to the minute, HH:MM.';
  end if;
  if v_problem is null then
    select * into k from agent_private.card_lookup(v_board, p_person_id);
    if not found then
      v_problem := 'No such card among the cards you can see on the ' || v_board || ' board.';
    elsif v_assignee is not null
          and (not (v_assignee = c.person_id or v_assignee is not distinct from k.owner_id)
               or not public.card_task_registered(v_assignee)) then
      v_problem := 'assignee_id must be the card''s owner' || coalesce(' (' || (select o.name from agent_private.card_names(array[k.owner_id]) o limit 1) || ')', '')
                   || ' or you.';
    elsif (select count(*) from public.card_tasks t where t.person_id = k.person_id or t.entry_id = k.entry_id) >= 100 then
      v_problem := 'A card holds at most 100 tasks.';
    end if;
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'add_card_task', v_args, left('refused: ' || v_problem, 500));
    return jsonb_build_object('error', v_problem || ' Nothing was added.');
  end if;
  insert into public.card_tasks (id, workspace_id, person_id, entry_id, title, due_date, due_time, assignee_id, position)
  values (v_id, c.workspace_id, k.person_id, k.entry_id, v_title, p_due_date, p_due_time, v_assignee,
          coalesce((select max(t.position) + 1 from public.card_tasks t
                     where t.person_id = k.person_id or t.entry_id = k.entry_id), 0));
  select d into v_doc from agent_private.card_docs(array[v_board], array[k.card_id], c.person_id, c.workspace_id, 1) d;
  perform agent_private.audit(c.connection_id, 'add_card_task', v_args, 'added task ' || v_id, null,
                              agent_private.card_stamp(v_board, k.card_id) || agent_private.task_stamp(v_id));
  return v_doc || jsonb_build_object('task', (select e from jsonb_array_elements(v_doc -> 'tasks') e where e ->> 'id' = v_id));
end
$$;

-- ---------------------------------------------------------------------------
-- update_card_task
-- ---------------------------------------------------------------------------

-- Change a task's title, due_date, due_time (null clears) or assignee_id (null clears; otherwise the card's owner or
-- the caller). Anything else in the patch is refused by name and nothing changes. Ticking is complete_card_task.
create function public.agent_update_card_task(p_task_id text, p_patch jsonb) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('task_id', p_task_id, 'patch', p_patch);
  v_allowed constant text[] := array['title', 'due_date', 'due_time', 'assignee_id'];
  v_bad text;
  v_problem text;
  t record;
  v_title text;
  v_date date;
  v_time time;
  v_assignee text;
  v_owner text;
  v_old jsonb;
  v_rows int;
  v_board text;
  v_card text;
  v_doc jsonb;
begin
  select * into c from agent_private.ctx(true);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, 'refused: empty patch');
    return jsonb_build_object('error', 'Nothing to change: give at least one of title, due_date, due_time, assignee_id.');
  end if;
  select string_agg('"' || left(k, 40) || '"', ', ' order by k) into v_bad
    from jsonb_object_keys(p_patch) k where not (k = any (v_allowed));
  if v_bad is not null then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args,
                                left('refused: field ' || v_bad || ' is not allowed', 500));
    return jsonb_build_object('error',
      'Only title, due_date, due_time and assignee_id can be changed here; ' || v_bad || ' cannot (complete_card_task ticks a task). Nothing was changed.');
  end if;

  if p_patch ? 'title' and (jsonb_typeof(p_patch -> 'title') <> 'string'
                            or char_length(btrim(p_patch ->> 'title')) not between 1 and 200) then
    v_problem := 'title must be text of 1 to 200 characters.';
  elsif p_patch ? 'assignee_id' and jsonb_typeof(p_patch -> 'assignee_id') not in ('string', 'null') then
    v_problem := 'assignee_id must be the id of a person, or null.';
  elsif p_patch ? 'due_date' and jsonb_typeof(p_patch -> 'due_date') not in ('string', 'null') then
    v_problem := 'due_date must be a date, YYYY-MM-DD, or null.';
  elsif p_patch ? 'due_time' and jsonb_typeof(p_patch -> 'due_time') not in ('string', 'null') then
    v_problem := 'due_time must be a time, HH:MM, or null.';
  end if;
  if v_problem is null and jsonb_typeof(p_patch -> 'due_date') = 'string' then
    if (p_patch ->> 'due_date') !~ '^\d{4}-\d{2}-\d{2}$' then
      v_problem := 'due_date must be a date, YYYY-MM-DD, or null.';
    else
      begin
        v_date := (p_patch ->> 'due_date')::date;
        if v_date not between date '2000-01-01' and date '2100-01-01' then
          v_problem := 'due_date must be between 2000-01-01 and 2100-01-01.';
        end if;
      exception when others then
        v_problem := 'due_date must be a real date, YYYY-MM-DD, or null.';
      end;
    end if;
  end if;
  if v_problem is null and jsonb_typeof(p_patch -> 'due_time') = 'string' then
    if (p_patch ->> 'due_time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      v_problem := 'due_time must be a time of day, HH:MM (24 hours), or null.';
    else
      v_time := (p_patch ->> 'due_time')::time;
    end if;
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, left('refused: ' || v_problem, 500));
    return jsonb_build_object('error', v_problem || ' Nothing was changed.');
  end if;

  select x.id, x.person_id, x.entry_id, x.title, x.due_date, x.due_time, x.assignee_id
    into t from public.card_tasks x where x.id = p_task_id;
  if not found then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, 'refused: no such task among the visible ones');
    return jsonb_build_object('error', 'No such task among the cards you can see. Nothing was changed.');
  end if;
  v_board := case when t.person_id is not null then 'recruiting' else 'customer' end;
  v_card := coalesce(t.person_id, t.entry_id);
  v_owner := public.card_owner(t.person_id, t.entry_id);
  v_old := agent_private.task_stamp(p_task_id);

  v_title := case when p_patch ? 'title' then btrim(p_patch ->> 'title') else t.title end;
  v_date := case when not (p_patch ? 'due_date') then t.due_date
                 when jsonb_typeof(p_patch -> 'due_date') = 'null' then null else v_date end;
  v_time := case when not (p_patch ? 'due_time') then t.due_time
                 when jsonb_typeof(p_patch -> 'due_time') = 'null' then null else v_time end;
  v_assignee := case when not (p_patch ? 'assignee_id') then t.assignee_id
                     when jsonb_typeof(p_patch -> 'assignee_id') = 'null' then null
                     else nullif(btrim(p_patch ->> 'assignee_id'), '') end;

  if v_time is not null and v_date is null then
    v_problem := 'due_time needs a due_date. To remove the due date, send due_date and due_time both as null.';
  elsif v_assignee is not null and v_assignee is distinct from t.assignee_id
        and (not (v_assignee = c.person_id or v_assignee is not distinct from v_owner)
             or not public.card_task_registered(v_assignee)) then
    v_problem := 'assignee_id must be the card''s owner' || coalesce(' (' || (select o.name from agent_private.card_names(array[v_owner]) o limit 1) || ')', '')
                 || ' or you.';
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, left('refused: ' || v_problem, 500));
    return jsonb_build_object('error', v_problem || ' Nothing was changed.');
  end if;

  if (v_title, v_date, v_time, v_assignee) is not distinct from (t.title, t.due_date, t.due_time, t.assignee_id) then
    select d into v_doc from agent_private.card_docs(array[v_board], array[v_card], c.person_id, c.workspace_id, 1) d;
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, 'nothing to change',
                                agent_private.card_stamp(v_board, v_card) || v_old, agent_private.card_stamp(v_board, v_card) || v_old);
    return v_doc || jsonb_build_object('note', 'Nothing changed: the task already has those values.');
  end if;

  update public.card_tasks x
     set title = v_title, due_date = v_date, due_time = v_time, assignee_id = v_assignee
   where x.id = p_task_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    perform agent_private.audit(c.connection_id, 'update_card_task', v_args, 'refused: not allowed to change that task');
    return jsonb_build_object('error', 'You are not allowed to change that task. Nothing was changed.');
  end if;
  select d into v_doc from agent_private.card_docs(array[v_board], array[v_card], c.person_id, c.workspace_id, 1) d;
  perform agent_private.audit(c.connection_id, 'update_card_task', v_args, 'updated task ' || p_task_id,
                              agent_private.card_stamp(v_board, v_card) || v_old,
                              agent_private.card_stamp(v_board, v_card) || agent_private.task_stamp(p_task_id));
  return v_doc;
end
$$;

-- ---------------------------------------------------------------------------
-- complete_card_task
-- ---------------------------------------------------------------------------

-- Tick a task (done true, the default) or untick it (false). Returns the card with its tasks and the task as `task`.
create function public.agent_complete_card_task(p_task_id text, p_done boolean default true) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_done boolean := coalesce(p_done, true);
  v_args jsonb := jsonb_build_object('task_id', p_task_id, 'done', v_done);
  t record;
  v_board text;
  v_card text;
  v_note text;
  v_doc jsonb;
begin
  select * into c from agent_private.ctx(true);
  select x.id, x.person_id, x.entry_id, x.done into t from public.card_tasks x where x.id = p_task_id;
  if not found then
    perform agent_private.audit(c.connection_id, 'complete_card_task', v_args, 'refused: no such task among the visible ones');
    return jsonb_build_object('error', 'No such task among the cards you can see. Nothing was changed.');
  end if;
  v_board := case when t.person_id is not null then 'recruiting' else 'customer' end;
  v_card := coalesce(t.person_id, t.entry_id);
  if t.done is distinct from v_done then
    update public.card_tasks x set done = v_done where x.id = p_task_id;
  else
    v_note := 'That task was already ' || case when v_done then 'done' else 'open' end || '.';
  end if;
  select d into v_doc from agent_private.card_docs(array[v_board], array[v_card], c.person_id, c.workspace_id, 1) d;
  perform agent_private.audit(c.connection_id, 'complete_card_task', v_args,
                              case when t.done is not distinct from v_done
                                   then 'task already ' || case when v_done then 'done' else 'open' end
                                   else case when v_done then 'ticked' else 'unticked' end || ' task ' || p_task_id end,
                              null,
                              agent_private.card_stamp(v_board, v_card) || agent_private.task_stamp(p_task_id));
  return v_doc
         || jsonb_build_object('task', (select e from jsonb_array_elements(v_doc -> 'tasks') e where e ->> 'id' = p_task_id))
         || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
end
$$;

-- ---------------------------------------------------------------------------
-- add_card_note
-- ---------------------------------------------------------------------------

-- A note at the end of a card's log, as the caller. Returns the note and the card's notes_count.
create function public.agent_add_card_note(p_person_id text, p_body text, p_board text default 'recruiting') returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_board text := coalesce(nullif(btrim(coalesce(p_board, '')), ''), 'recruiting');
  v_args jsonb := jsonb_build_object('person_id', p_person_id, 'board', p_board, 'body', p_body);
  v_body text := btrim(coalesce(p_body, ''));
  v_id text := gen_random_uuid()::text;
  k record;
  v_problem text;
  v_name text;
  v_at timestamptz;
  v_count int;
begin
  select * into c from agent_private.ctx(true);
  if v_board not in ('recruiting', 'customer') then
    v_problem := 'board must be recruiting or customer.';
  elsif char_length(v_body) not between 1 and 2000 then
    v_problem := 'body must be 1 to 2000 characters.';
  else
    select * into k from agent_private.card_lookup(v_board, p_person_id);
    if not found then
      v_problem := 'No such card among the cards you can see on the ' || v_board || ' board.';
    end if;
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'add_card_note', v_args, left('refused: ' || v_problem, 500));
    return jsonb_build_object('error', v_problem || ' Nothing was added.');
  end if;
  insert into public.card_notes (id, workspace_id, person_id, entry_id, body)
  values (v_id, c.workspace_id, k.person_id, k.entry_id, v_body);
  select n.created_at into v_at from public.card_notes n where n.id = v_id;
  select p.name into v_name from public.people p where p.id = c.person_id;
  select count(*)::int into v_count from public.card_notes n where n.person_id = k.person_id or n.entry_id = k.entry_id;
  perform agent_private.audit(c.connection_id, 'add_card_note', v_args, 'added note ' || v_id, null,
                              agent_private.card_stamp(v_board, k.card_id) || jsonb_build_object('note_id', v_id));
  return jsonb_build_object(
    'card', jsonb_build_object('board', v_board, 'person', jsonb_build_object('id', k.card_id, 'full_name', k.name)),
    'note', jsonb_build_object('id', v_id, 'author', jsonb_build_object('id', c.person_id, 'full_name', v_name),
                               'body', v_body, 'created_at', agent_private.fmt_utc(v_at)),
    'notes_count', v_count);
end
$$;

-- Only the signed-in role may run the tools (the connector switches to it); each is refused by agent_private.ctx()
-- unless it was reached through the connector.
revoke all on function
  public.agent_list_cards(text, text, boolean, boolean, date, date, boolean, text, int, int),
  public.agent_get_card(text, text),
  public.agent_list_card_tasks(text, date, date, boolean, text, text, timestamptz, int, int),
  public.agent_add_card_task(text, text, text, date, time, text),
  public.agent_update_card_task(text, jsonb),
  public.agent_complete_card_task(text, boolean),
  public.agent_add_card_note(text, text, text)
  from public, anon, service_role;
grant execute on function
  public.agent_list_cards(text, text, boolean, boolean, date, date, boolean, text, int, int),
  public.agent_get_card(text, text),
  public.agent_list_card_tasks(text, date, date, boolean, text, text, timestamptz, int, int),
  public.agent_add_card_task(text, text, text, date, time, text),
  public.agent_update_card_task(text, jsonb),
  public.agent_complete_card_task(text, boolean),
  public.agent_add_card_note(text, text, text)
  to authenticated;
