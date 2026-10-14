-- Unlocks support (docs/plans/mvp-plan-2026-10-13.md "Feature switches and
-- the admin login" and "What each person sees"):
--
--  * app_admins: the admin ("experimental") login sees every feature
--    regardless of the team's switches. Nobody can make themselves admin:
--    there is no client write policy or grant; rows come from the seed or the
--    service role.
--  * feature_switches: phase 2 and 3 features (chats, library, campaigns),
--    off unless a row says otherwise. Members read their team's switches;
--    leaders and their deputies flip them (who and when is stamped).
--  * deputies: a leader names people on their team who see everything the
--    leader sees and edit on the leader's behalf. visible_person_ids() (the
--    core visibility helper every policy uses) now unions the leader's view
--    in; customers stay private to their owner.
--
-- Client mirror: src/data/team (rules, store) and src/data/access.ts
-- (`visibleIdSet` with `viewer.deputyOf`). Unlocks by growth milestone run in
-- the app (src/data/unlocks.ts), like the milestone rules themselves.

-- ---------------------------------------------------------------------------
-- Admin flag
-- ---------------------------------------------------------------------------

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);
comment on table public.app_admins is
  'Accounts that see every feature regardless of the team''s switches (testing phase 2/3 against real data). Written only by the database owner or service role.';

alter table public.app_admins enable row level security;

create policy "read your own admin flag" on public.app_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- No insert/update/delete policy, and no write grant either.
revoke insert, update, delete, truncate on public.app_admins from public, anon, authenticated;

create function public.is_app_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.app_admins a where a.user_id = auth.uid()) $$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Deputies
-- ---------------------------------------------------------------------------

create table public.deputies (
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  leader_id text not null references public.people (id) on delete cascade,
  deputy_id text not null references public.people (id) on delete cascade,
  added_by text default public.current_person_id() references public.people (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (leader_id, deputy_id),
  check (leader_id <> deputy_id)
);
comment on table public.deputies is
  'A leader''s deputies: they see what the leader sees and edit on the leader''s behalf. Customers stay private.';
create index deputies_deputy_idx on public.deputies (deputy_id);

-- Leaders the caller is a deputy of (and who are still leaders).
create function public.deputy_leader_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  select d.leader_id
  from public.deputies d
  join public.members l
    on l.person_id = d.leader_id and l.workspace_id = d.workspace_id and l.role = 'leader'
  where d.deputy_id = public.current_person_id()
    and d.workspace_id = public.current_workspace_id()
$$;

create function public.is_deputy() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.deputy_leader_ids()) $$;

-- Team settings and leader-level edits: a leader, or a deputy acting for one.
create function public.acts_as_leader() returns boolean
language sql stable security definer set search_path = ''
as $$ select public.is_leader() or public.is_deputy() $$;

revoke execute on function public.deputy_leader_ids() from public, anon;
revoke execute on function public.is_deputy() from public, anon;
revoke execute on function public.acts_as_leader() from public, anon;
grant execute on function public.deputy_leader_ids() to authenticated;
grant execute on function public.is_deputy() to authenticated;
grant execute on function public.acts_as_leader() to authenticated;

-- Who added a deputy, and when, is the database's; a row never changes.
create function public.deputies_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    new.added_by := public.current_person_id();
    new.added_at := now();
  end if;
  return new;
end $$;
create trigger deputies_stamp before insert on public.deputies
  for each row execute function public.deputies_stamp();
revoke execute on function public.deputies_stamp() from public, anon, authenticated;

alter table public.deputies enable row level security;

-- The leader and the deputy see the row.
create policy "read your deputies" on public.deputies
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (leader_id = (select public.current_person_id())
              or deputy_id = (select public.current_person_id())));

-- Only a leader names their own deputies: an apprentice or IBO in their
-- business downline (not themselves).
create policy "leaders name deputies" on public.deputies
  for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and (select public.is_leader())
    and leader_id = (select public.current_person_id())
    and deputy_id <> leader_id
    and deputy_id in (select public.downline_ids(leader_id))
    and exists (select 1 from public.people p
                where p.id = deputy_id
                  and p.workspace_id = (select public.current_workspace_id())
                  and p.biz_class in ('apprentice', 'ibo'))
  );

-- The leader removes a deputy; a deputy may also step down.
create policy "leaders remove deputies" on public.deputies
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and ((leader_id = (select public.current_person_id()) and (select public.is_leader()))
              or deputy_id = (select public.current_person_id())));

revoke update on public.deputies from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Visibility: a deputy also sees what their leader sees (mirror of
-- visibleIdSet with viewer.deputyOf in src/data/access.ts). The leader and
-- the leader's business downline are added; the leader's customers are not
-- (customers stay private to their owner).
-- ---------------------------------------------------------------------------

create or replace function public.visible_person_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  with recursive me as (
    select m.person_id, m.workspace_id, public.chat_eligible(m.person_id) as has_team
    from public.members m
    where m.user_id = auth.uid()
    order by m.joined_at, m.workspace_id
    limit 1
  ),
  roots (id) as (
    select me.person_id from me where me.has_team
    union
    select d.leader_id
    from public.deputies d
    join me on d.deputy_id = me.person_id and d.workspace_id = me.workspace_id
    join public.members l
      on l.person_id = d.leader_id and l.workspace_id = d.workspace_id and l.role = 'leader'
    where me.has_team
  ),
  team (id) as (
    select roots.id from roots
    union
    select c.id
    from public.people c
    join team t on c.sponsor_id = t.id
    where c.biz_class <> 'customer'
      and c.workspace_id = (select me.workspace_id from me)
  )
  select me.person_id from me where not me.has_team
  union
  select team.id from team
  union
  select c.id
  from public.people c, me
  where me.has_team
    and c.biz_class = 'customer'
    and c.owner_id = me.person_id
    and c.workspace_id = me.workspace_id
$$;

-- Coaching (monthly PV, hand marks): a deputy coaches the leader's team, but
-- not the leader they act for (nobody sets their own numbers).
create or replace function public.is_upline_of(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_person_id is distinct from public.current_person_id()
     and p_person_id in (select public.visible_person_ids())
     and p_person_id not in (select public.deputy_leader_ids())
     and exists (select 1 from public.people p
                  where p.id = p_person_id
                    and p.biz_class <> 'customer'
                    and p.workspace_id = public.current_workspace_id())
$$;

-- Events: deputies edit and delete events like their leader can.
create policy "deputies edit events for their leader" on public.events
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_deputy()))
  with check (workspace_id = (select public.current_workspace_id()));

create policy "deputies delete events for their leader" on public.events
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_deputy()));

-- ---------------------------------------------------------------------------
-- Feature switches
-- ---------------------------------------------------------------------------

create table public.feature_switches (
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  feature text not null check (feature in ('chats', 'library', 'campaigns')),
  enabled boolean not null default false,
  updated_by text default public.current_person_id() references public.people (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, feature)
);
comment on table public.feature_switches is
  'Phase 2/3 features switched on or off for a whole team (no row = off). Admin accounts see them regardless.';

create function public.feature_switches_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'UPDATE' and (new.workspace_id is distinct from old.workspace_id
        or new.feature is distinct from old.feature) then
      raise exception 'A switch can''t move to another team or feature' using errcode = '42501';
    end if;
    new.updated_by := public.current_person_id();
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger feature_switches_stamp before insert or update on public.feature_switches
  for each row execute function public.feature_switches_stamp();
revoke execute on function public.feature_switches_stamp() from public, anon, authenticated;

alter table public.feature_switches enable row level security;

create policy "members read their team's switches" on public.feature_switches
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

create policy "leaders and deputies add switches" on public.feature_switches
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and (select public.acts_as_leader()));

create policy "leaders and deputies flip switches" on public.feature_switches
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.acts_as_leader()))
  with check (workspace_id = (select public.current_workspace_id()));

create policy "leaders and deputies clear switches" on public.feature_switches
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.acts_as_leader()));
