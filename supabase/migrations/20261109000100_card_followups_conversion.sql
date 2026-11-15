-- The app no longer books a "next step" on a card or keeps a single note: a card has tasks and a notes
-- log (migration 20261108000100_card_tasks). This converts what is already stored, so nothing is lost:
--
--   * every card (recruiting or customer) with a booked next step becomes ONE open task on that card:
--     title = the booked column's name on the card owner's board (board_columns(); a step that is hidden
--     for the owner is still named by its step row; a column that no longer exists is 'Next step'),
--     due_date and due_time from the booking (a booking without a day is a task without a due date),
--     assignee = the card's owner (the prospect's sponsor, the list entry's owner), created_at = the
--     card's updated_at;
--   * every card with a non-empty note becomes ONE note: body = the note, author = the card's owner,
--     created_at = the card's updated_at.
--
-- Nothing is deleted or altered in pipeline_cards / customer_cards / pipeline_step_cancellations: the
-- columns stay (the app just stops reading and writing them; the move functions keep their booking
-- parameters and keep or clear a stored booking by the same rule as before). The conversion is a function
-- so the pgTAP tests can run it a second time: it never makes a task or a note that the card already has
-- with the same content, so a second run creates nothing. It is safe on a database with no bookings and no
-- notes (it creates nothing). It runs once, here.

create function public.convert_card_followups() returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_tasks integer := 0;
  v_notes integer := 0;
  n integer;
begin
  -- Recruiting board: the prospect's card; the owner is the sponsor.
  with t as (
    select c.workspace_id, c.person_id, p.sponsor_id, c.updated_at, c.next_step_date,
           case when c.next_step_date is not null then c.next_step_time end as next_step_time,
           left(btrim(coalesce(
             (select b.label from public.board_columns('recruiting', coalesce(p.sponsor_id, p.id)) b
               where b.id = c.next_column),
             (select s.label from public.pipeline_steps s where s.id = c.next_column),
             'Next step')), 200) as title
      from public.pipeline_cards c
      join public.people p on p.id = c.person_id
     where nullif(btrim(c.next_column), '') is not null
  ), ins as (
    insert into public.card_tasks (workspace_id, person_id, title, due_date, due_time, assignee_id,
                                   position, created_at, updated_at)
    select t.workspace_id, t.person_id, t.title, t.next_step_date, t.next_step_time, t.sponsor_id,
           (select coalesce(max(x.position) + 1, 0) from public.card_tasks x where x.person_id = t.person_id),
           t.updated_at, t.updated_at
      from t
     where not exists (
       select 1 from public.card_tasks x
        where x.person_id = t.person_id and x.title = t.title
          and x.due_date is not distinct from t.next_step_date
          and x.due_time is not distinct from t.next_step_time)
    returning 1
  )
  select count(*) into n from ins;
  v_tasks := v_tasks + n;

  -- Customer board: the list name's card; the owner is the list's owner.
  with t as (
    select c.workspace_id, c.entry_id, e.owner_id, c.updated_at, c.next_step_date,
           case when c.next_step_date is not null then c.next_step_time end as next_step_time,
           left(btrim(coalesce(
             (select b.label from public.board_columns('customer', e.owner_id) b where b.id = c.next_column),
             (select s.label from public.customer_steps s where s.id = c.next_column),
             'Next step')), 200) as title
      from public.customer_cards c
      join public.list_entries e on e.id = c.entry_id
     where nullif(btrim(c.next_column), '') is not null
  ), ins as (
    insert into public.card_tasks (workspace_id, entry_id, title, due_date, due_time, assignee_id,
                                   position, created_at, updated_at)
    select t.workspace_id, t.entry_id, t.title, t.next_step_date, t.next_step_time, t.owner_id,
           (select coalesce(max(x.position) + 1, 0) from public.card_tasks x where x.entry_id = t.entry_id),
           t.updated_at, t.updated_at
      from t
     where not exists (
       select 1 from public.card_tasks x
        where x.entry_id = t.entry_id and x.title = t.title
          and x.due_date is not distinct from t.next_step_date
          and x.due_time is not distinct from t.next_step_time)
    returning 1
  )
  select count(*) into n from ins;
  v_tasks := v_tasks + n;

  -- Notes.
  with t as (
    select c.workspace_id, c.person_id, p.sponsor_id, c.updated_at, left(btrim(c.note), 2000) as body
      from public.pipeline_cards c
      join public.people p on p.id = c.person_id
     where nullif(btrim(c.note), '') is not null
  ), ins as (
    insert into public.card_notes (workspace_id, person_id, author_id, body, created_at)
    select t.workspace_id, t.person_id, t.sponsor_id, t.body, t.updated_at
      from t
     where not exists (select 1 from public.card_notes x where x.person_id = t.person_id and x.body = t.body)
    returning 1
  )
  select count(*) into n from ins;
  v_notes := v_notes + n;

  with t as (
    select c.workspace_id, c.entry_id, e.owner_id, c.updated_at, left(btrim(c.note), 2000) as body
      from public.customer_cards c
      join public.list_entries e on e.id = c.entry_id
     where nullif(btrim(c.note), '') is not null
  ), ins as (
    insert into public.card_notes (workspace_id, entry_id, author_id, body, created_at)
    select t.workspace_id, t.entry_id, t.owner_id, t.body, t.updated_at
      from t
     where not exists (select 1 from public.card_notes x where x.entry_id = t.entry_id and x.body = t.body)
    returning 1
  )
  select count(*) into n from ins;
  v_notes := v_notes + n;

  return jsonb_build_object('tasks', v_tasks, 'notes', v_notes);
end;
$$;
comment on function public.convert_card_followups() is
  'One-time conversion of booked next steps and card notes into card tasks and card notes (never makes a duplicate); the old columns are left untouched.';

-- Only the database's own roles run it (the migration, tests); never a client.
revoke execute on function public.convert_card_followups() from public, anon, authenticated;

select public.convert_card_followups();
