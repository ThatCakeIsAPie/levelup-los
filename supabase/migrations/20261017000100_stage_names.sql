-- Custom names for the pipelines' major stages (client: src/data/stageNames,
-- store `stageNames`, binding `stageNamesBinding`).
--
-- Each pipeline has four fixed top-level stages, known by key:
--   recruiting: contact, first_meeting, first_plan, registered
--   customer:   contact, first_meeting, first_sale, on_ditto
-- Their meaning, order and behaviour never change; only the name a person
-- sees can. Anyone who has a pipeline (not a candidate) names stages for
-- themselves, and their downline sees those names unless they set their own.
--
-- `stage_names` holds one row per person, pipeline and stage that the person
-- named. No row = "not set by me". The name a viewer sees for a stage is,
-- per pipeline and per stage independently:
--   1. their own row, if they have one; else
--   2. the row of the NEAREST person above them in the sponsor line
--      (sponsor by sponsor) who has one; else
--   3. the app's built-in name (the client's; the database stores none).
--
-- A person reads and writes only their own rows. Because a viewer must learn
-- the names set above them, by people whose rows (and sometimes whose profiles)
-- they can't read, `effective_stage_names()` walks the sponsor line for the
-- caller and returns the winning name per stage with who it comes from.

create table public.stage_names (
  person_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  pipeline text not null,
  stage_key text not null,
  name text not null,
  updated_at timestamptz not null default now(),
  primary key (person_id, pipeline, stage_key),
  -- The stage key must be one of that pipeline's four.
  constraint stage_names_stage_valid check (
    (pipeline = 'recruiting' and stage_key in ('contact', 'first_meeting', 'first_plan', 'registered'))
    or (pipeline = 'customer' and stage_key in ('contact', 'first_meeting', 'first_sale', 'on_ditto'))),
  -- Trimmed, 1 to 30 characters, no control characters (line breaks, tabs).
  constraint stage_names_name_valid check (
    name = btrim(name) and char_length(name) between 1 and 30 and name !~ '[[:cntrl:]]')
);
comment on table public.stage_names is
  'A person''s own names for the major stages of the recruiting and customer pipelines; no row = not set by them.';
comment on column public.stage_names.stage_key is
  'The stage''s internal key (the milestone code): recruiting contact, first_meeting, first_plan, registered; customer contact, first_meeting, first_sale, on_ditto.';

create trigger stage_names_touch before update on public.stage_names
  for each row execute function public.touch_updated_at();

alter table public.stage_names enable row level security;

create policy "read own stage names" on public.stage_names
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()));
create policy "add own stage names" on public.stage_names
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id())
              and not (select public.is_candidate()));
create policy "change own stage names" on public.stage_names
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id()));
create policy "delete own stage names" on public.stage_names
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()));

grant select, insert, update, delete on public.stage_names to authenticated;

-- The names the caller sees, one row per pipeline and stage that has a custom
-- name anywhere in their sponsor line: the caller's own, else the nearest
-- upline's. `p_include_own = false` leaves the caller's own rows out (what
-- they would inherit if they cleared theirs; the app uses it for the
-- placeholders in its rename dialog and combines it with the caller's own
-- rows). depth is 0 for the caller, 1 for their sponsor, and so on. The walk
-- stays in the caller's workspace, never visits a person twice (a sponsor
-- cycle ends it) and stops after 50 people.
create function public.effective_stage_names(p_include_own boolean default true)
returns table (
  pipeline text,
  stage_key text,
  name text,
  from_person_id text,
  from_person_name text,
  depth integer
)
language sql stable security definer set search_path = ''
as $$
  with recursive line (person_id, sponsor_id, d, seen) as (
    select p.id, p.sponsor_id, 0, array[p.id]
    from public.people p
    where p.id = public.current_person_id()
      and p.workspace_id = public.current_workspace_id()
    union all
    select s.id, s.sponsor_id, line.d + 1, line.seen || s.id
    from public.people s
    join line on s.id = line.sponsor_id
    where line.d < 49
      and s.workspace_id = public.current_workspace_id()
      and not s.id = any (line.seen)
  )
  select distinct on (n.pipeline, n.stage_key)
         n.pipeline, n.stage_key, n.name, line.person_id, who.name, line.d
  from line
  join public.stage_names n
    on n.person_id = line.person_id and n.workspace_id = public.current_workspace_id()
  join public.people who on who.id = line.person_id
  where p_include_own or line.d > 0
  order by n.pipeline, n.stage_key, line.d
$$;
comment on function public.effective_stage_names(boolean) is
  'For the caller: per pipeline and stage, the custom name they see (their own, else the nearest upline''s) and who set it. false leaves their own out.';

revoke execute on function public.effective_stage_names(boolean) from public, anon;
grant execute on function public.effective_stage_names(boolean) to authenticated;
