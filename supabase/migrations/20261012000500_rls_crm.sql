-- Row-level security for workspaces, members, invites and the CRM tables.
-- Every table: workspace isolation (workspace_id = the caller's workspace)
-- plus the business visibility rules of src/data/access.ts, now also
-- enforced on writes. Policies only target `authenticated`; anon sees nothing.
-- Helpers are wrapped in (select ...) so Postgres evaluates them once per query.

-- Small helpers specific to these policies --------------------------------

-- Leaders and (effective) IBOs may organize shared costs.
create function public.can_organize_costs() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_leader() or exists (
    select 1 from public.people p
    where p.id = public.current_person_id()
      and public.effective_biz_class(p.biz_class, p.business_start_date) = 'ibo'
  )
$$;

create function public.cost_owner(p_cost_id text) returns text
language sql stable security definer set search_path = ''
as $$ select c.owner_id from public.shared_costs c where c.id = p_cost_id $$;

create function public.cost_workspace(p_cost_id text) returns text
language sql stable security definer set search_path = ''
as $$ select c.workspace_id from public.shared_costs c where c.id = p_cost_id $$;

create function public.has_paid(p_cost_id text, p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.payments p where p.cost_id = p_cost_id and p.person_id = p_person_id) $$;

create function public.event_workspace(p_event_id text) returns text
language sql stable security definer set search_path = ''
as $$ select e.workspace_id from public.events e where e.id = p_event_id $$;

-- Enable RLS everywhere -----------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.people enable row level security;
alter table public.members enable row level security;
alter table public.invites enable row level security;
alter table public.events enable row level security;
alter table public.attendances enable row level security;
alter table public.logistics enable row level security;
alter table public.shared_costs enable row level security;
alter table public.shared_cost_members enable row level security;
alter table public.cost_overrides enable row level security;
alter table public.payments enable row level security;
alter table public.contacts enable row level security;
alter table public.sales enable row level security;
alter table public.learning enable row level security;
alter table public.learning_goals enable row level security;
alter table public.contact_settings enable row level security;
alter table public.activity enable row level security;
alter table public.campaigns enable row level security;
alter table public.report_schedules enable row level security;

-- workspaces ----------------------------------------------------------------

create policy "members read their workspace" on public.workspaces
  for select to authenticated
  using (id = (select public.current_workspace_id()));

create policy "leaders edit their workspace" on public.workspaces
  for update to authenticated
  using (id = (select public.current_workspace_id()) and (select public.is_leader()))
  with check (id = (select public.current_workspace_id()));

-- members -------------------------------------------------------------------

-- Your own row always; the member list if you use chat; leaders see all.
create policy "read members" on public.members
  for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (person_id = (select public.current_person_id())
         or (select public.chat_eligible(public.current_person_id()))
         or (select public.is_leader()))
  );

-- Leaders manage membership and designate moderators.
create policy "leaders add members" on public.members
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id()) and (select public.is_leader())
              and public.person_workspace(person_id) = workspace_id);

create policy "leaders change members" on public.members
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_leader()))
  with check (workspace_id = (select public.current_workspace_id()));

create policy "leaders remove members" on public.members
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_leader())
         and person_id <> (select public.current_person_id()));

-- invites -------------------------------------------------------------------

create policy "read own invites" on public.invites
  for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (created_by = (select public.current_person_id())
         or sponsor_person_id = (select public.current_person_id())
         or (select public.is_leader()))
  );

-- Invite someone under yourself or anyone in your downline (an apprentice/IBO).
create policy "invite into your team" on public.invites
  for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and not (select public.is_candidate())
    and created_by = (select public.current_person_id())
    and sponsor_person_id in (select public.visible_person_ids())
    and exists (select 1 from public.people p
                where p.id = sponsor_person_id and p.biz_class in ('apprentice', 'ibo'))
  );

create policy "withdraw own invites" on public.invites
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (created_by = (select public.current_person_id()) or (select public.is_leader())));

-- people --------------------------------------------------------------------

create policy "read visible people" on public.people
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and id in (select public.visible_person_ids()));

-- Add business people under someone you can see (leaders may add a new root),
-- and customers owned by someone you can see. Candidates add nobody.
create policy "add people to your team" on public.people
  for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and not (select public.is_candidate())
    and (
      (biz_class <> 'customer'
        and ((sponsor_id is null and (select public.is_leader()))
             or sponsor_id in (select public.visible_person_ids())))
      or (biz_class = 'customer' and owner_id in (select public.visible_person_ids()))
    )
  );

-- Sponsor/owner/stage changes are checked by the people_guard trigger.
create policy "edit visible people" on public.people
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id()));

-- Delete anyone visible except yourself; their downline and customers move to
-- their sponsor (people_before_delete trigger, like src/data/cascade.ts).
create policy "remove visible people" on public.people
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and id in (select public.visible_person_ids())
         and id <> (select public.current_person_id())
         and not (select public.is_candidate()));

-- events: everyone in the workspace sees the list -----------------------------

create policy "read events" on public.events
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

create policy "add events" on public.events
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and not (select public.is_candidate()));

create policy "edit own events or as moderator" on public.events
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (created_by = (select public.current_person_id()) or (select public.is_moderator_or_leader())))
  with check (workspace_id = (select public.current_workspace_id()));

create policy "delete own events or as moderator" on public.events
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (created_by = (select public.current_person_id()) or (select public.is_moderator_or_leader())));

-- attendances + logistics: rows of visible people -------------------------------

create policy "attendance of visible people" on public.attendances
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids())
              and public.event_workspace(event_id) = workspace_id);

create policy "travel plans of visible people" on public.logistics
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids())
              and public.event_workspace(event_id) = workspace_id);

-- shared costs ----------------------------------------------------------------
-- Everyone sees the cost list, memberships, overrides and payments (needed to
-- compute each share). Only leaders and IBOs organize costs; only the
-- organizer edits shares; paid shares are frozen; payments go through
-- pay_sandbox().

create policy "read shared costs" on public.shared_costs
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

create policy "leaders and IBOs organize costs" on public.shared_costs
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id())
              and (select public.can_organize_costs())
              and public.event_workspace(event_id) = workspace_id);

create policy "organizer edits cost" on public.shared_costs
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (owner_id = (select public.current_person_id()) or (select public.is_leader())))
  with check (workspace_id = (select public.current_workspace_id()));

create policy "organizer deletes cost" on public.shared_costs
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (owner_id = (select public.current_person_id()) or (select public.is_leader())));

create policy "read cost members" on public.shared_cost_members
  for select to authenticated
  using (public.cost_workspace(cost_id) = (select public.current_workspace_id()));

-- Opt yourself in, or the organizer opts in someone they can see.
create policy "opt in" on public.shared_cost_members
  for insert to authenticated
  with check (
    public.cost_workspace(cost_id) = (select public.current_workspace_id())
    and (person_id = (select public.current_person_id())
         or (public.cost_owner(cost_id) = (select public.current_person_id())
             and person_id in (select public.visible_person_ids())))
  );

-- Opt out (yourself, or the organizer for anyone) unless already paid.
create policy "opt out unless paid" on public.shared_cost_members
  for delete to authenticated
  using (
    public.cost_workspace(cost_id) = (select public.current_workspace_id())
    and (person_id = (select public.current_person_id())
         or public.cost_owner(cost_id) = (select public.current_person_id()))
    and not public.has_paid(cost_id, person_id)
  );

create policy "read cost overrides" on public.cost_overrides
  for select to authenticated
  using (public.cost_workspace(cost_id) = (select public.current_workspace_id()));

create policy "organizer sets overrides" on public.cost_overrides
  for all to authenticated
  using (public.cost_owner(cost_id) = (select public.current_person_id())
         and not public.has_paid(cost_id, person_id))
  with check (public.cost_owner(cost_id) = (select public.current_person_id())
              and public.cost_workspace(cost_id) = (select public.current_workspace_id())
              and not public.has_paid(cost_id, person_id));

create policy "read payments" on public.payments
  for select to authenticated
  using (public.cost_workspace(cost_id) = (select public.current_workspace_id()));

-- contacts, sales, learning, goals -------------------------------------------

create policy "contacts with visible people" on public.contacts
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));

create policy "log contacts with visible people" on public.contacts
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids())
              and (by_id = (select public.current_person_id())
                   or by_id in (select public.visible_person_ids())));

create policy "edit contacts with visible people" on public.contacts
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids()));

create policy "delete contacts with visible people" on public.contacts
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));

create policy "sales of visible customers" on public.sales
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and customer_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and customer_id in (select public.visible_person_ids()));

create policy "learning of visible people" on public.learning
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids()));

create policy "learning goals of visible people" on public.learning_goals
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id in (select public.visible_person_ids()));

create policy "own contact settings" on public.contact_settings
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id()));

-- activity: timeline rows about visible people (or about no person) -----------

create policy "read activity" on public.activity
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (related_person_id is null or related_person_id in (select public.visible_person_ids())));

create policy "log activity" on public.activity
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and (related_person_id is null or related_person_id in (select public.visible_person_ids())));

-- campaigns + report schedules: your own ----------------------------------------

create policy "own campaigns" on public.campaigns
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and owner_id = (select public.current_person_id()))
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id())
              and recipients <@ array(select public.visible_person_ids()));

create policy "own report schedule" on public.report_schedules
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and owner_id = (select public.current_person_id()))
  with check (workspace_id = (select public.current_workspace_id())
              and owner_id = (select public.current_person_id()));
