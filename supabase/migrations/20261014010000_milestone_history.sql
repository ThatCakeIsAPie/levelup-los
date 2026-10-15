-- Growth path: milestone history (client: MilestoneHistory, store
-- `milestoneHistory`, src/data/growth).
--
-- Milestones are no longer "first reached stays reached": the headcount ones
-- (3/10, 6/25, 6/50, 12/100) count only while the numbers meet them now, and
-- the volume ones for the month they're met and the month after. The first
-- day each was ever reached is still history, and unlocks go by it (dropping
-- below 3/10 keeps event planning). The volume milestones' history comes
-- from the PV on record; the ones counted from the sponsor tree (First
-- sponsor and the headcount milestones) would be forgotten when the tree
-- shrinks, so the app records them here while the data shows them: the first
-- day reached and the last day seen met (refreshed at most monthly).
--
-- The rules run in the app; the database keeps a row per person and
-- milestone, lets the person and their uplines write it, never moves the
-- first day later or the last day earlier, and records who wrote it. Nobody
-- deletes history from the app (the row goes with the person).

create table public.milestone_history (
  person_id text not null references public.people (id) on delete cascade,
  code text not null check (code in ('new_apprentice', 'first_sale', 'core_150', 'core_300',
    'first_sponsor', 'bronze_foundation', '3_10', 'bronze_builder', '6_25', '6_50',
    'platinum', 'ruby', '12_100')),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  first_reached_on date not null,
  last_met_on date not null,
  recorded_by text default public.current_person_id() references public.people (id) on delete set null,
  recorded_at timestamptz not null default now(),
  primary key (person_id, code),
  check (last_met_on >= first_reached_on)
);
comment on table public.milestone_history is
  'The first day a growth milestone was reached and the last day it was seen met, recorded by the app (count milestones; the PV ones come from the PV on record).';

-- Clients can't choose who recorded a row or when, move it to another person
-- or milestone, or date it in the future (a day of slack for time zones). An
-- update keeps the earlier first day and the later last day, so two people
-- recording at once can't lose history.
create function public.milestone_history_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'UPDATE' then
      if new.person_id is distinct from old.person_id or new.code is distinct from old.code
          or new.workspace_id is distinct from old.workspace_id then
        raise exception 'Milestone history can''t move to another person or milestone'
          using errcode = '42501';
      end if;
      new.first_reached_on := least(old.first_reached_on, new.first_reached_on);
      new.last_met_on := greatest(old.last_met_on, new.last_met_on);
    end if;
    if new.first_reached_on > current_date + 1 or new.last_met_on > current_date + 1 then
      raise exception 'Milestone history can''t be in the future' using errcode = '23514';
    end if;
    new.recorded_by := public.current_person_id();
    new.recorded_at := now();
  end if;
  return new;
end $$;
create trigger milestone_history_stamp before insert or update on public.milestone_history
  for each row execute function public.milestone_history_stamp();
revoke execute on function public.milestone_history_stamp() from public, anon, authenticated;

-- RLS: anyone who can see the person reads; the person and their uplines
-- record (candidates never); nobody deletes.
alter table public.milestone_history enable row level security;

create policy "milestone history of visible people" on public.milestone_history
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));
create policy "the person and their uplines record history" on public.milestone_history
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and not public.is_candidate()
              and (person_id = public.current_person_id() or public.is_upline_of(person_id)));
create policy "the person and their uplines update history" on public.milestone_history
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and not public.is_candidate()
         and (person_id = public.current_person_id() or public.is_upline_of(person_id)))
  with check (workspace_id = (select public.current_workspace_id())
              and not public.is_candidate()
              and (person_id = public.current_person_id() or public.is_upline_of(person_id)));

grant select, insert, update on public.milestone_history to authenticated;
