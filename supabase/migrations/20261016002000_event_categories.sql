-- Event categories replace the six fixed event types
-- (docs/plans/mvp-plan-2026-10-13.md "Events", Jay's requests 2026-10-16;
-- mirror of src/data/eventCategories):
--   * each team keeps its own list of kinds of event: a name, an icon and a
--     color from small curated sets, and yes/no settings that used to come
--     from the type (online, tickets, travel, missed-event reminders,
--     customers welcome), in the team's order;
--   * every workspace starts with the six old types as categories (ids
--     '<workspace>-<old type>'), and every event points at one
--     (events.category_id; events.type is gone);
--   * anyone who may add events adds a category; leaders and their deputies
--     rename, change, reorder, archive and merge them. Merging moves every
--     event over and archives the old category in one step
--     (merge_event_categories). Categories are never deleted: archived ones
--     stay readable for old events and can't be picked for new ones;
--   * customers' missed events: the customer's owner (and the owner's
--     uplines) may leave the "already handled" note.

-- ---------------------------------------------------------------------------
-- event_categories (EventCategory)
-- ---------------------------------------------------------------------------

create table public.event_categories (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 40),
  -- A key from the app's curated lucide set (unknown keys show a calendar).
  icon text not null default 'calendar' check (icon ~ '^[a-z0-9-]{1,32}$'),
  -- A color token key (src/data/eventCategories/types.ts CATEGORY_TONES).
  tone text not null default 'neutral'
    check (tone in ('neutral', 'green', 'blue', 'amber', 'rose')),
  allows_virtual boolean not null default false,
  uses_tickets boolean not null default false,
  uses_travel boolean not null default false,
  counts_for_missed_followups boolean not null default true,
  welcomes_customers boolean not null default false,
  -- Display order (lowest first); a new one without it goes last.
  position integer not null,
  archived_at timestamptz,
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
comment on table public.event_categories is
  'A team''s kinds of event (Night Owls, Conference, …) and what each one uses: online, tickets, travel, missed-event reminders, customers welcome. Archived, never deleted.';
comment on column public.event_categories.counts_for_missed_followups is
  'Someone who came to the last one and misses the next one gets a follow-up from their uplines.';
comment on column public.event_categories.welcomes_customers is
  'Home suggests inviting your customers to the next ones.';

create index event_categories_workspace_idx on public.event_categories (workspace_id, position);
-- One active category per name in a team (archived ones may repeat a name).
create unique index event_categories_active_name_idx
  on public.event_categories (workspace_id, lower(btrim(name)))
  where archived_at is null;

-- The six starting categories (the old event types), same as
-- STARTING_CATEGORIES in src/data/eventCategories/rules.ts. Their ids are
-- '<workspace>-<old type>', so the demo, the seed and old links agree.
create function public.add_starting_event_categories(p_workspace_id text) returns void
language sql security definer set search_path = ''
as $$
  insert into public.event_categories
    (id, workspace_id, name, icon, tone, allows_virtual, uses_tickets, uses_travel,
     counts_for_missed_followups, welcomes_customers, position, created_by)
  select p_workspace_id || '-' || s.key, p_workspace_id, s.name, s.icon, 'neutral',
         s.virtual, s.tickets, s.travel, true, s.customers, s.position, null
  from (values
    ('night_owls',      'Night Owls',           'moon',       false, false, false, false, 0),
    ('work_session',    'Work session',         'briefcase',  false, false, false, false, 1),
    ('info_session',    'Info session',         'lightbulb',  true,  false, false, true,  2),
    ('training',        'Training',             'graduation', true,  false, false, true,  3),
    ('monthly_meeting', 'Monthly team meeting', 'users',      true,  true,  false, true,  4),
    ('conference',      'Conference',           'ticket',     true,  true,  true,  false, 5)
  ) as s(key, name, icon, virtual, tickets, travel, customers, position)
  on conflict do nothing
$$;
revoke execute on function public.add_starting_event_categories(text) from public, anon, authenticated;

-- A new workspace starts with them too.
create function public.workspaces_starting_categories() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.add_starting_event_categories(new.id);
  return new;
end $$;
revoke execute on function public.workspaces_starting_categories() from public, anon, authenticated;

create trigger workspaces_starting_categories after insert on public.workspaces
  for each row execute function public.workspaces_starting_categories();

select public.add_starting_event_categories(w.id) from public.workspaces w;

-- Who made a category and when are the database's, and never change. A new
-- category without a position goes after the others.
create function public.event_categories_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.position is null then
    select coalesce(max(c.position) + 1, 0) into new.position
      from public.event_categories c where c.workspace_id = new.workspace_id;
  end if;
  if public.is_client_write() then
    if tg_op = 'INSERT' then
      new.created_by := public.current_person_id();
      new.created_at := now();
      new.archived_at := null;
    else
      if new.workspace_id <> old.workspace_id then
        raise exception 'A category stays in its workspace' using errcode = '42501';
      end if;
      new.created_by := old.created_by;
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.event_categories_stamp() from public, anon, authenticated;

create trigger event_categories_stamp before insert or update on public.event_categories
  for each row execute function public.event_categories_stamp();

alter table public.event_categories enable row level security;

-- Everyone on the team reads the list (archived ones too: old events use them).
create policy "read event categories" on public.event_categories
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

-- Anyone who may add events adds a category (same rule as "add events").
create policy "add event categories" on public.event_categories
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and not (select public.is_candidate()));

-- Renaming, settings, order and archiving: leaders and their deputies.
create policy "leaders edit event categories" on public.event_categories
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.acts_as_leader()))
  with check (workspace_id = (select public.current_workspace_id()));

-- No delete policy: categories are archived, never deleted.

-- ---------------------------------------------------------------------------
-- events.category_id replaces events.type
-- ---------------------------------------------------------------------------

alter table public.events add column category_id text
  references public.event_categories (id) on delete restrict;
update public.events set category_id = workspace_id || '-' || type;
alter table public.events alter column category_id set not null;
create index events_category_idx on public.events (category_id);
comment on column public.events.category_id is
  'The team''s event category (what kind of event; its settings decide tickets, travel and online).';

alter table public.events drop constraint events_format_for_type;
alter table public.events drop constraint events_type_check;
alter table public.events drop column type;
comment on column public.events.format is
  'How people can join: in_person, virtual or both. Virtual only when the category allows it (otherwise kept in person).';

-- An event's category: one of its workspace's, not archived when picked
-- (old events keep an archived one), the team's first one when left out.
-- A format the category doesn't allow becomes in person (the app does the
-- same before saving, and a merge relies on it).
create function public.events_category_check() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_cat public.event_categories;
begin
  if new.category_id is null then
    select c.id into new.category_id from public.event_categories c
     where c.workspace_id = new.workspace_id and c.archived_at is null
     order by c.position, c.created_at, c.id limit 1;
  end if;
  select * into v_cat from public.event_categories c where c.id = new.category_id;
  if v_cat.id is null or v_cat.workspace_id is distinct from new.workspace_id then
    raise exception 'The category isn''t in this workspace' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    if v_cat.archived_at is not null then
      raise exception 'That category is archived' using errcode = '23514';
    end if;
  end if;
  if not v_cat.allows_virtual and new.format <> 'in_person'
     and (tg_op = 'INSERT' or new.category_id is distinct from old.category_id
          or new.format is distinct from old.format) then
    new.format := 'in_person';
  end if;
  return new;
end $$;
revoke execute on function public.events_category_check() from public, anon, authenticated;

create trigger events_category_check before insert or update of category_id, format on public.events
  for each row execute function public.events_category_check();

-- ---------------------------------------------------------------------------
-- Merge: move every event of one category into another, then archive it
-- ---------------------------------------------------------------------------

create function public.merge_event_categories(p_from_id text, p_into_id text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_from public.event_categories;
  v_into public.event_categories;
  v_moved integer;
begin
  if not public.acts_as_leader() then
    raise exception 'Only your team''s leader and their deputies merge categories'
      using errcode = '42501';
  end if;
  select * into v_from from public.event_categories where id = p_from_id and workspace_id = v_ws;
  select * into v_into from public.event_categories where id = p_into_id and workspace_id = v_ws;
  if v_from.id is null or v_into.id is null then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if v_from.id = v_into.id then
    raise exception 'Pick a different category to merge into' using errcode = '22023';
  end if;
  if v_into.archived_at is not null then
    raise exception 'That category is archived' using errcode = '23514';
  end if;

  update public.events set category_id = v_into.id
   where category_id = v_from.id and workspace_id = v_ws;
  get diagnostics v_moved = row_count;

  update public.event_categories set archived_at = coalesce(archived_at, now())
   where id = v_from.id;
  return v_moved;
end $$;
comment on function public.merge_event_categories(text, text) is
  'Leaders and deputies: move every event of one category into another (in person if the other is in person only), then archive the first. Returns how many events moved.';
revoke execute on function public.merge_event_categories(text, text) from public, anon;
grant execute on function public.merge_event_categories(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Customers' missed events: their owner (and the owner's uplines) follow up
-- ---------------------------------------------------------------------------

-- The caller follows up this customer: they own them, or are an upline of
-- the owner (src/data/eventTypes/missed.ts missedAudience).
create function public.is_customer_upline(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.people p
     where p.id = p_person_id
       and p.biz_class = 'customer'
       and p.workspace_id = public.current_workspace_id()
       and p.owner_id is not null
       and (p.owner_id = public.current_person_id() or public.is_upline_of(p.owner_id)))
$$;
revoke execute on function public.is_customer_upline(text) from public, anon;
grant execute on function public.is_customer_upline(text) to authenticated;

drop policy "uplines note a missed event" on public.missed_event_notes;
create policy "uplines note a missed event" on public.missed_event_notes
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and (public.is_upline_of(person_id) or public.is_customer_upline(person_id)));
