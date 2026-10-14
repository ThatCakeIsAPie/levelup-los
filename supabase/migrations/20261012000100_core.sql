-- Core: workspaces, people (the CRM roster), members (auth user <-> person),
-- invites, and the identity helpers every policy builds on.
--
-- Conventions (see docs/backend.md):
--  * ids are text (`gen_random_uuid()::text` by default; seed rows keep
--    readable ids such as "1", "c8", "e1"), so client-generated UUIDs work.
--  * every CRM row carries workspace_id (defaults to the caller's workspace).
--  * snake_case columns mirror the camelCase TypeScript fields 1:1.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id text primary key default gen_random_uuid()::text,
  name text not null check (length(trim(name)) > 0),
  logo_url text,
  -- Per-team branding, e.g. {"navy":"#14284b","teal":"#0f9d8f","sky":"#7cc4ff"}.
  colors jsonb not null default '{}'::jsonb,
  -- IANA zone used for "local day" rules (check-ins: once per pair per day).
  timezone text not null default 'America/Chicago',
  created_at timestamptz not null default now()
);
comment on table public.workspaces is 'A team. Branding (name, logo, colors) is per workspace.';

-- ---------------------------------------------------------------------------
-- people (CrmPerson: business path prospect/apprentice/ibo + customers)
-- ---------------------------------------------------------------------------

create table public.people (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  biz_class text not null check (biz_class in ('prospect', 'apprentice', 'ibo', 'customer')),
  ibo_number text,
  ltd_number text,
  location text,
  sponsor_id text references public.people (id) on delete set null,
  business_start_date date,
  joined_date date,
  owner_id text references public.people (id) on delete set null,
  monthly_volume numeric(12, 2),
  notes text,
  pipeline_stage text check (pipeline_stage in ('prospect', 'apprentice', 'ibo')),
  -- StageChange[]: [{"stage":"prospect","at":"<iso>"}]
  stage_history jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  last_updated_at timestamptz not null default now(),
  los_uid text,
  created_at timestamptz not null default now(),
  check (sponsor_id is null or sponsor_id <> id),
  check (biz_class = 'customer' or owner_id is null),
  check (biz_class <> 'customer' or sponsor_id is null)
);
comment on table public.people is 'CRM roster (CrmPerson). Business path via sponsor_id; customers via owner_id.';
create index people_workspace_idx on public.people (workspace_id);
create index people_sponsor_idx on public.people (sponsor_id) where sponsor_id is not null;
create index people_owner_idx on public.people (owner_id) where owner_id is not null;
create unique index people_los_uid_idx on public.people (workspace_id, los_uid) where los_uid is not null;

-- ---------------------------------------------------------------------------
-- members (WorkspaceMember): who can sign in, and their team role
-- ---------------------------------------------------------------------------

create table public.members (
  workspace_id text not null references public.workspaces (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null default 'member' check (role in ('leader', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, person_id),
  unique (user_id, workspace_id)
);
comment on table public.members is 'Workspace membership: auth user <-> CRM person, with team role (separate from business stage).';
create index members_user_idx on public.members (user_id) where user_id is not null;
create index members_person_idx on public.members (person_id);

-- ---------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER so policies can call them without
-- recursing into RLS; they only ever describe the caller.
-- ---------------------------------------------------------------------------

-- The caller's member row (first workspace joined if they belong to several).
create function public.current_person_id() returns text
language sql stable security definer set search_path = ''
as $$
  select m.person_id from public.members m
  where m.user_id = auth.uid()
  order by m.joined_at, m.workspace_id
  limit 1
$$;

create function public.current_workspace_id() returns text
language sql stable security definer set search_path = ''
as $$
  select m.workspace_id from public.members m
  where m.user_id = auth.uid()
  order by m.joined_at, m.workspace_id
  limit 1
$$;

-- Named current_member_role() because CURRENT_ROLE is a reserved SQL keyword.
create function public.current_member_role() returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.members m
  where m.user_id = auth.uid()
  order by m.joined_at, m.workspace_id
  limit 1
$$;

create function public.is_leader() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_member_role() = 'leader', false) $$;

create function public.is_moderator_or_leader() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce(public.current_member_role() in ('leader', 'moderator'), false) $$;

alter table public.people alter column workspace_id set default public.current_workspace_id();
alter table public.members alter column workspace_id set default public.current_workspace_id();

-- ---------------------------------------------------------------------------
-- invites: a link that places a new person under their sponsor
-- ---------------------------------------------------------------------------

create table public.invites (
  id text primary key default gen_random_uuid()::text,
  token text not null unique default encode(extensions.gen_random_bytes(18), 'hex'),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  sponsor_person_id text not null references public.people (id) on delete cascade,
  -- Business stage the new person starts at.
  stage text not null default 'prospect' check (stage in ('prospect', 'apprentice', 'ibo')),
  name text,
  email text,
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.invites is 'Invite links. accept_invite(token) creates the person under sponsor_person_id and a member row.';
create index invites_workspace_idx on public.invites (workspace_id);
