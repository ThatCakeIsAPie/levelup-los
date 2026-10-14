-- CRM entities that used to live in browser storage (src/stores/*.ts).
-- Column names are the snake_case of the TypeScript fields.

-- events (CrmEvent)
create table public.events (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  name text not null,
  type text not null check (type in ('conference', 'team_meeting')),
  date date not null,
  end_date date,
  location text,
  notes text,
  -- db only: who created it (creator, leaders and moderators may edit/delete)
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= date)
);
create index events_workspace_date_idx on public.events (workspace_id, date);

-- attendances (Attendance)
create table public.attendances (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  event_id text not null references public.events (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  desire_to_attend text check (desire_to_attend in ('yes', 'no', 'maybe')),
  follow_up_date date,
  has_ticket boolean not null default false,
  ticket_type text check (ticket_type in ('in_person', 'stream')),
  planned_purchase_date date,
  helper_id text references public.people (id) on delete set null,
  leadership_qualified boolean not null default false,
  special_event_qualified boolean not null default false,
  notes text,
  attended boolean,
  updated_at timestamptz not null default now(),
  unique (event_id, person_id)
);
create index attendances_person_idx on public.attendances (person_id);

-- logistics (Logistics; the store keys them "eventId:personId")
create table public.logistics (
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  event_id text not null references public.events (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  ticket text not null check (ticket in ('bought', 'planned')),
  plan_date date,
  mode text not null check (mode in ('fly', 'drive')),
  flight_booked boolean,
  carpool text not null check (carpool in ('teammate', 'other_team', 'solo', 'van')),
  van_paid text check (van_paid in ('yes', 'no', 'planned')),
  van_pay_date date,
  updated_at timestamptz not null default now(),
  primary key (event_id, person_id)
);
create index logistics_person_idx on public.logistics (person_id);

-- shared_costs (SharedCost without members/overrides, which are tables below)
create table public.shared_costs (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  event_id text not null references public.events (id) on delete cascade,
  name text not null,
  total numeric(12, 2) not null check (total >= 0),
  -- Organizer. Null only if they were deleted with no sponsor to inherit it.
  owner_id text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index shared_costs_event_idx on public.shared_costs (event_id);

-- SharedCost.members
create table public.shared_cost_members (
  cost_id text not null references public.shared_costs (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cost_id, person_id)
);
create index shared_cost_members_person_idx on public.shared_cost_members (person_id);

-- SharedCost.overrides
create table public.cost_overrides (
  cost_id text not null references public.shared_costs (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  primary key (cost_id, person_id)
);

-- Payment (sandbox only: never card or bank data). Keyed "costId:personId".
create table public.payments (
  cost_id text not null references public.shared_costs (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  paid_at timestamptz not null default now(),
  ref text not null,
  amount numeric(12, 2),
  cost_name text,
  primary key (cost_id, person_id)
);
create index payments_person_idx on public.payments (person_id);

-- contacts (Contact) + source
create table public.contacts (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  by_id text default public.current_person_id() references public.people (id) on delete set null,
  date date not null default current_date,
  note text,
  source text not null default 'manual' check (source in ('manual', 'message', 'event')),
  created_at timestamptz not null default now()
);
create index contacts_person_date_idx on public.contacts (person_id, date desc);
create index contacts_by_idx on public.contacts (by_id);
create index contacts_message_day_idx on public.contacts (date, person_id, by_id) where source = 'message';

-- sales (Sale)
create table public.sales (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  customer_id text not null references public.people (id) on delete cascade,
  product text not null,
  date date not null default current_date,
  amount numeric(12, 2),
  created_at timestamptz not null default now()
);
create index sales_customer_date_idx on public.sales (customer_id, date desc);

-- learning (Learning)
create table public.learning (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  person_id text not null default public.current_person_id() references public.people (id) on delete cascade,
  kind text not null check (kind in ('podcast', 'pages', 'workshop', 'conference')),
  title text not null,
  amount numeric(10, 2) not null default 1,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
create index learning_person_date_idx on public.learning (person_id, date desc);

-- learning_goals (LearningGoal per person; missing row = 60 / 3 / 1)
create table public.learning_goals (
  person_id text primary key references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  pages integer not null default 60 check (pages >= 0),
  podcasts integer not null default 3 check (podcasts >= 0),
  workshops integer not null default 1 check (workshops >= 0)
);

-- contact_settings (Settings: "due for contact" thresholds, per user)
create table public.contact_settings (
  person_id text primary key default public.current_person_id() references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  customer_days integer not null default 30 check (customer_days > 0),
  team_days integer not null default 14 check (team_days > 0)
);

-- activity (ActivityEvent)
create table public.activity (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  "timestamp" timestamptz not null default now(),
  actor_name text not null default 'You',
  -- db only: the acting person, when known
  actor_id text default public.current_person_id() references public.people (id) on delete set null,
  entity_type text not null check (entity_type in ('person', 'event', 'attendance')),
  entity_id text not null,
  -- No FKs: the timeline keeps entries about deleted people and events.
  related_person_id text,
  related_event_id text,
  kind text not null check (kind in (
    'created', 'updated', 'deleted', 'stage_changed', 'assigned_event',
    'ticket_purchased', 'marked_attended', 'marked_no_show', 'note'
  )),
  summary text not null,
  meta jsonb
);
create index activity_person_idx on public.activity (related_person_id, "timestamp" desc);
create index activity_event_idx on public.activity (related_event_id, "timestamp" desc);
create index activity_entity_idx on public.activity (entity_type, entity_id);

-- campaigns (Campaign)
create table public.campaigns (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  owner_id text not null default public.current_person_id() references public.people (id) on delete cascade,
  kind text not null check (kind in ('email', 'text', 'voice')),
  message text not null,
  recipients text[] not null default '{}',
  scheduled_for timestamptz,
  created_at timestamptz not null default now(),
  status text not null default 'pending_send' check (status in ('pending_send'))
);
create index campaigns_owner_idx on public.campaigns (owner_id);

-- report_schedules (ReportSchedule, one per owner)
create table public.report_schedules (
  owner_id text primary key default public.current_person_id() references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'monthly'))
);
