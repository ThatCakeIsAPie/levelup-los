-- Event types and missed-event follow-ups (docs/plans/mvp-plan-2026-10-13.md
-- "Events"; mirror of src/data/eventTypes):
--   * six event types, each in person, virtual or both (virtual only where
--     the type allows it); existing team meetings become monthly team meetings;
--   * attendance records how someone came (or holds a ticket): in person or
--     virtual (was ticket_type in_person / stream);
--   * "already handled" notes on a missed-event follow-up, written by an upline
--     of the person and read by everyone who can see them.
-- The follow-up rule itself runs in the app (src/data/eventTypes/missed.ts).

-- ---------------------------------------------------------------------------
-- Event types and format
-- ---------------------------------------------------------------------------

alter table public.events drop constraint events_type_check;
update public.events set type = 'monthly_meeting' where type = 'team_meeting';
alter table public.events add constraint events_type_check check (type in (
  'info_session', 'work_session', 'night_owls', 'training', 'monthly_meeting', 'conference'));

alter table public.events
  add column format text not null default 'in_person'
    check (format in ('in_person', 'virtual', 'both'));
comment on column public.events.format is
  'How people can join: in_person, virtual or both. Virtual only for info sessions, trainings, monthly team meetings and conferences.';

-- Existing meetings and conferences were offered both ways (stream tickets).
update public.events set format = 'both' where type in ('monthly_meeting', 'conference');

alter table public.events add constraint events_format_for_type check (
  format = 'in_person' or type in ('info_session', 'training', 'monthly_meeting', 'conference'));

-- ---------------------------------------------------------------------------
-- Attendance: in person or virtual
-- ---------------------------------------------------------------------------

alter table public.attendances drop constraint attendances_ticket_type_check;
alter table public.attendances rename column ticket_type to mode;
update public.attendances set mode = 'virtual' where mode = 'stream';
alter table public.attendances add constraint attendances_mode_check
  check (mode in ('in_person', 'virtual'));
comment on column public.attendances.mode is
  'In person or virtual: the ticket''s type, or how the person came.';

-- ---------------------------------------------------------------------------
-- "Already handled" notes (MissedEventNote)
-- ---------------------------------------------------------------------------

create table public.missed_event_notes (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  event_id text not null references public.events (id) on delete cascade,
  note text not null check (length(btrim(note)) between 1 and 1000),
  by_id text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.missed_event_notes is
  'An upline''s note that a missed-event follow-up was already handled (e.g. "talked at the gym, she was sick"). Clears the follow-up for every upline.';

create index missed_event_notes_person_idx on public.missed_event_notes (person_id);
create index missed_event_notes_event_idx on public.missed_event_notes (event_id);

-- Clients can't choose who wrote a note or when, and notes aren't edited
-- (remove and write a new one). The event must be one of the workspace's.
create function public.missed_event_notes_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    new.by_id := public.current_person_id();
    new.created_at := now();
  end if;
  if public.event_workspace(new.event_id) is distinct from new.workspace_id then
    raise exception 'The event isn''t in this workspace' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger missed_event_notes_stamp before insert on public.missed_event_notes
  for each row execute function public.missed_event_notes_stamp();

alter table public.missed_event_notes enable row level security;

-- Anyone who can see the person reads the notes about them.
create policy "missed event notes of visible people" on public.missed_event_notes
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));

-- Only an upline writes one: the person is in your business downline, not you.
create policy "uplines note a missed event" on public.missed_event_notes
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and public.is_upline_of(person_id));

-- The author removes their own note.
create policy "authors remove their note" on public.missed_event_notes
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and by_id = (select public.current_person_id()));

revoke execute on function public.missed_event_notes_stamp() from public, anon, authenticated;
