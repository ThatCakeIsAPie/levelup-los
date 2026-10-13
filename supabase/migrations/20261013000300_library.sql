-- Library: the "All talks" catalog, team topics, channels (ordered, sectioned
-- selections of catalog items) and per-person progress. Replaces chat's
-- placeholder `library_items` table. Client contract: src/data/library/types.ts.
--
--  * Visibility (library_can_see): the creator; everyone for 'team'; IBOs,
--    leaders and moderators for 'ibos'; the creator's business downline for
--    'downline'. Mirror of canSeeLibrary in src/data/library/rules.ts.
--  * Creating: leaders and moderators for any audience; anyone else with a
--    business downline (not candidates) for 'downline' only.
--  * Editing / deleting: the creator, or a leader / moderator.
--  * Progress: each person reads and writes only their own rows. Finishing an
--    item logs it to `learning` once (trigger; the client mirrors the row with
--    the same id and never writes it itself).
--  * Locked "IBOs and leaders" channels are listed to others through
--    library_channel_teasers() (title, icon, lesson count; no lessons).
--  * Files: private `library` bucket, "<workspace_id>/<item_id>/<uuid>.<ext>".

-- ---------------------------------------------------------------------------
-- Drop the placeholder
-- ---------------------------------------------------------------------------

drop policy if exists "library: members read" on storage.objects;
drop policy if exists "library: moderators upload" on storage.objects;
drop policy if exists "library: moderators update" on storage.objects;
drop policy if exists "library: moderators remove" on storage.objects;
drop table if exists public.library_items cascade;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.library_topics (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index library_topics_name_idx on public.library_topics (workspace_id, lower(name));
comment on table public.library_topics is 'Team-managed topic list (leaders and moderators edit it).';

create table public.library_items (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  kind text not null check (kind in ('audio', 'video', 'slides', 'document')),
  source text not null check (source in ('upload', 'link')),
  -- Uploads: object path in the `library` bucket ("<workspace_id>/<item_id>/<file>"),
  -- or a "seed:" path the client synthesises (demo seed only).
  storage_path text,
  mime text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  file_name text,
  -- Links: the URL as pasted and the recognised host.
  link_url text,
  link_provider text check (link_provider in ('youtube', 'vimeo', 'google_slides', 'other')),
  duration_sec integer check (duration_sec is null or duration_sec >= 0),
  page_count integer check (page_count is null or page_count > 0),
  format text not null default 'talk'
    check (format in ('talk', 'panel', 'q_and_a', 'workshop', 'interview')),
  event_id text references public.events (id) on delete set null,
  recorded_on date,
  created_by text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  permission_confirmed boolean not null check (permission_confirmed),
  visibility text not null default 'team' check (visibility in ('team', 'ibos', 'downline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'upload' or (storage_path is not null and link_url is null)),
  check (source <> 'link' or (link_url is not null and storage_path is null))
);
create index library_items_workspace_idx on public.library_items (workspace_id, created_at desc);
create index library_items_creator_idx on public.library_items (created_by);
comment on table public.library_items is 'All talks: each talk, panel, workshop, slide deck or document, uploaded or linked once.';

create table public.library_item_speakers (
  item_id text not null references public.library_items (id) on delete cascade,
  position smallint not null check (position >= 0),
  person_id text references public.people (id) on delete cascade,
  name text,
  primary key (item_id, position),
  check ((person_id is null) <> (name is null)),
  check (name is null or length(trim(name)) > 0)
);
comment on table public.library_item_speakers is 'Speakers of an item, in order: a team person or an outside guest (name).';

create table public.library_item_topics (
  item_id text not null references public.library_items (id) on delete cascade,
  topic_id text not null references public.library_topics (id) on delete cascade,
  primary key (item_id, topic_id)
);
create index library_item_topics_topic_idx on public.library_item_topics (topic_id);

create table public.library_channels (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  description text,
  icon text not null default 'book-open',
  color text not null default 'teal' check (color in ('navy', 'teal', 'amber', 'green', 'sky', 'mist')),
  created_by text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  visibility text not null default 'team' check (visibility in ('team', 'ibos', 'downline')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index library_channels_workspace_idx on public.library_channels (workspace_id, created_at);
comment on table public.library_channels is 'Hand-picked, ordered selections of catalog items (short courses).';

create table public.library_channel_sections (
  id text primary key default gen_random_uuid()::text,
  channel_id text not null references public.library_channels (id) on delete cascade,
  position smallint not null check (position >= 0),
  title text
);
create index library_channel_sections_channel_idx on public.library_channel_sections (channel_id, position);

create table public.library_channel_items (
  section_id text not null references public.library_channel_sections (id) on delete cascade,
  item_id text not null references public.library_items (id) on delete cascade,
  -- Denormalised for policies and lookups.
  channel_id text not null references public.library_channels (id) on delete cascade,
  position smallint not null check (position >= 0),
  primary key (section_id, item_id)
);
create index library_channel_items_channel_idx on public.library_channel_items (channel_id);
create index library_channel_items_item_idx on public.library_channel_items (item_id);

create table public.library_progress (
  person_id text not null default public.current_person_id()
    references public.people (id) on delete cascade,
  item_id text not null references public.library_items (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  position_sec numeric(10, 1) not null default 0 check (position_sec >= 0),
  completed_at timestamptz,
  -- Set by the database the first time the item is finished (learning logged).
  logged_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (person_id, item_id)
);
create index library_progress_item_idx on public.library_progress (item_id);
comment on table public.library_progress is 'Where each person is in each item; finishing logs learning once.';

-- ---------------------------------------------------------------------------
-- Helpers (SECURITY DEFINER: they read people/members without recursing RLS)
-- ---------------------------------------------------------------------------

-- Everyone above the caller on the sponsor line.
create function public.library_upline_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  with recursive up (id, depth) as (
    select p.sponsor_id, 1 from public.people p
    where p.id = public.current_person_id() and p.sponsor_id is not null
    union
    select p.sponsor_id, up.depth + 1 from public.people p join up on p.id = up.id
    where p.sponsor_id is not null and up.depth < 100
  )
  select id from up
$$;

-- IBOs (effective stage), leaders and moderators.
create function public.library_is_ibo_or_leader() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_moderator_or_leader() or exists (
    select 1 from public.people p
    where p.id = public.current_person_id()
      and public.effective_biz_class(p.biz_class, p.business_start_date) = 'ibo'
  )
$$;

-- The caller has at least one person in their business downline.
create function public.library_has_downline() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.people c
    where c.sponsor_id = public.current_person_id() and c.biz_class <> 'customer'
  )
$$;

-- May the caller open something with this creator / audience in this workspace?
create function public.library_can_see(p_workspace_id text, p_created_by text, p_visibility text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_workspace_id = public.current_workspace_id() and (
    p_created_by = public.current_person_id()
    or p_visibility = 'team'
    or (p_visibility = 'ibos' and public.library_is_ibo_or_leader())
    or (p_visibility = 'downline' and p_created_by in (select public.library_upline_ids()))
  )
$$;

-- May the caller share with this audience? (Mirror of allowedVisibilities.)
create function public.library_can_share(p_visibility text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_person_id() is not null and (
    public.is_moderator_or_leader()
    or (p_visibility = 'downline' and not public.is_candidate() and public.library_has_downline())
  )
$$;

-- May the caller edit / delete something they or someone else created?
create function public.library_can_edit(p_workspace_id text, p_created_by text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_workspace_id = public.current_workspace_id() and (
    public.is_moderator_or_leader()
    or (p_created_by = public.current_person_id() and not public.is_candidate()
        and public.library_has_downline())
  )
$$;

create function public.library_item_visible(p_item_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.library_can_see(i.workspace_id, i.created_by, i.visibility)
                   from public.library_items i where i.id = p_item_id), false)
$$;

create function public.library_item_editable(p_item_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.library_can_edit(i.workspace_id, i.created_by)
                   from public.library_items i where i.id = p_item_id), false)
$$;

create function public.library_channel_visible(p_channel_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.library_can_see(c.workspace_id, c.created_by, c.visibility)
                   from public.library_channels c where c.id = p_channel_id), false)
$$;

create function public.library_channel_editable(p_channel_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select public.library_can_edit(c.workspace_id, c.created_by)
                   from public.library_channels c where c.id = p_channel_id), false)
$$;

-- ---------------------------------------------------------------------------
-- Guards: who created something and where it lives never change; a new
-- audience must be one the editor may share with (keeping it is always fine).
-- ---------------------------------------------------------------------------

create function public.library_guard_owned() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.created_by is distinct from old.created_by or new.workspace_id is distinct from old.workspace_id
     or new.created_at is distinct from old.created_at then
    raise exception 'The creator, workspace and creation time can''t change' using errcode = '42501';
  end if;
  if new.visibility is distinct from old.visibility and not public.library_can_share(new.visibility) then
    raise exception 'You can''t share with that audience' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger library_items_guard before update on public.library_items
  for each row execute function public.library_guard_owned();
create trigger library_channels_guard before update on public.library_channels
  for each row execute function public.library_guard_owned();

-- A channel's sections and lessons stay in that channel.
create function public.library_guard_channel_items() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.channel_id is distinct from (select s.channel_id from public.library_channel_sections s
                                      where s.id = new.section_id) then
    raise exception 'Section and channel don''t match' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger library_channel_items_guard before insert or update on public.library_channel_items
  for each row execute function public.library_guard_channel_items();

-- ---------------------------------------------------------------------------
-- Progress -> learning (once per person and item)
-- ---------------------------------------------------------------------------

-- Mirror of learningFor (src/data/library/rules.ts).
create function public.library_learning_kind(p_kind text, p_format text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_kind = 'document' then 'pages'
    when p_format = 'workshop' then 'workshop'
    when p_kind in ('audio', 'video') then 'podcast'
    else 'pages'
  end
$$;

-- The learning row's id: the client shows the same row before the server confirms it.
create function public.library_learning_id(p_person_id text, p_item_id text) returns text
language sql immutable set search_path = ''
as $$ select 'library:' || p_item_id || ':' || p_person_id $$;

create function public.library_progress_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_item public.library_items;
  v_kind text;
  v_log boolean;
begin
  new.updated_at := coalesce(new.updated_at, now());
  if tg_op = 'INSERT' then
    -- Clients never decide that something was logged; the seed may.
    if auth.uid() is not null then
      new.logged_at := null;
    end if;
    v_log := new.completed_at is not null and new.logged_at is null;
  else
    if new.person_id <> old.person_id or new.item_id <> old.item_id then
      raise exception 'Progress belongs to one person and item' using errcode = '42501';
    end if;
    new.logged_at := old.logged_at;
    v_log := new.completed_at is not null and old.completed_at is null and old.logged_at is null;
  end if;
  if v_log then
    select * into v_item from public.library_items where id = new.item_id;
    v_kind := public.library_learning_kind(v_item.kind, v_item.format);
    insert into public.learning (id, workspace_id, person_id, kind, title, amount, date)
    values (public.library_learning_id(new.person_id, new.item_id), v_item.workspace_id,
            new.person_id, v_kind, v_item.title,
            case when v_kind = 'pages' then greatest(coalesce(v_item.page_count, 1), 1) else 1 end,
            public.workspace_today(v_item.workspace_id))
    on conflict (id) do nothing;
    new.logged_at := now();
  end if;
  return new;
end $$;

create trigger library_progress_log before insert or update on public.library_progress
  for each row execute function public.library_progress_log();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.library_topics enable row level security;
alter table public.library_items enable row level security;
alter table public.library_item_speakers enable row level security;
alter table public.library_item_topics enable row level security;
alter table public.library_channels enable row level security;
alter table public.library_channel_sections enable row level security;
alter table public.library_channel_items enable row level security;
alter table public.library_progress enable row level security;

-- topics ---------------------------------------------------------------------
create policy "members read topics" on public.library_topics
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));
create policy "moderators manage topics" on public.library_topics
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_moderator_or_leader()))
  with check (workspace_id = (select public.current_workspace_id()) and (select public.is_moderator_or_leader()));

-- items ----------------------------------------------------------------------
create policy "read visible items" on public.library_items
  for select to authenticated
  using (public.library_can_see(workspace_id, created_by, visibility));
create policy "share items" on public.library_items
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and created_by = (select public.current_person_id())
              and public.library_can_share(visibility));
create policy "edit items" on public.library_items
  for update to authenticated
  using (public.library_can_edit(workspace_id, created_by))
  with check (public.library_can_edit(workspace_id, created_by));
create policy "delete items" on public.library_items
  for delete to authenticated
  using (public.library_can_edit(workspace_id, created_by));

create policy "read speakers of visible items" on public.library_item_speakers
  for select to authenticated using (public.library_item_visible(item_id));
create policy "edit speakers" on public.library_item_speakers
  for all to authenticated
  using (public.library_item_editable(item_id)) with check (public.library_item_editable(item_id));

create policy "read topics of visible items" on public.library_item_topics
  for select to authenticated using (public.library_item_visible(item_id));
create policy "edit item topics" on public.library_item_topics
  for all to authenticated
  using (public.library_item_editable(item_id)) with check (public.library_item_editable(item_id));

-- channels -------------------------------------------------------------------
create policy "read visible channels" on public.library_channels
  for select to authenticated
  using (public.library_can_see(workspace_id, created_by, visibility));
create policy "create channels" on public.library_channels
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and created_by = (select public.current_person_id())
              and public.library_can_share(visibility));
create policy "edit channels" on public.library_channels
  for update to authenticated
  using (public.library_can_edit(workspace_id, created_by))
  with check (public.library_can_edit(workspace_id, created_by));
create policy "delete channels" on public.library_channels
  for delete to authenticated
  using (public.library_can_edit(workspace_id, created_by));

create policy "read sections of visible channels" on public.library_channel_sections
  for select to authenticated using (public.library_channel_visible(channel_id));
create policy "edit sections" on public.library_channel_sections
  for all to authenticated
  using (public.library_channel_editable(channel_id)) with check (public.library_channel_editable(channel_id));

create policy "read lessons of visible channels" on public.library_channel_items
  for select to authenticated using (public.library_channel_visible(channel_id));
create policy "edit lessons" on public.library_channel_items
  for all to authenticated
  using (public.library_channel_editable(channel_id))
  with check (public.library_channel_editable(channel_id) and public.library_item_visible(item_id));

-- progress: your own rows only -------------------------------------------------
create policy "read your progress" on public.library_progress
  for select to authenticated
  using (person_id = (select public.current_person_id()));
create policy "save your progress" on public.library_progress
  for insert to authenticated
  with check (person_id = (select public.current_person_id())
              and workspace_id = (select public.current_workspace_id())
              and public.library_item_visible(item_id));
create policy "update your progress" on public.library_progress
  for update to authenticated
  using (person_id = (select public.current_person_id()))
  with check (person_id = (select public.current_person_id()));
create policy "clear your progress" on public.library_progress
  for delete to authenticated
  using (person_id = (select public.current_person_id()));

-- ---------------------------------------------------------------------------
-- Locked channels and names
-- ---------------------------------------------------------------------------

-- "IBOs and leaders" channels the caller can't open yet: shown locked, with
-- their lesson count but none of the lessons.
create function public.library_channel_teasers()
returns table (id text, title text, description text, icon text, color text, created_by text,
               lesson_count integer, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.title, c.description, c.icon, c.color, c.created_by,
         (select count(distinct ci.item_id)::integer from public.library_channel_items ci
          where ci.channel_id = c.id),
         c.created_at
  from public.library_channels c
  where c.workspace_id = public.current_workspace_id()
    and c.visibility = 'ibos'
    and not public.library_can_see(c.workspace_id, c.created_by, c.visibility)
  order by c.created_at
$$;
revoke all on function public.library_channel_teasers() from anon, public;
grant execute on function public.library_channel_teasers() to authenticated;

-- Names of the people behind what the caller can see (speakers, creators),
-- for viewers whose CRM view and chat directory don't include them (e.g.
-- candidates seeing their upline's talks).
create view public.library_people
with (security_barrier = true)
as
select distinct p.id as person_id, p.name
from public.people p
where p.workspace_id = public.current_workspace_id()
  and (
    p.id in (select s.person_id from public.library_item_speakers s
             where s.person_id is not null and public.library_item_visible(s.item_id))
    or p.id in (select i.created_by from public.library_items i
                where public.library_can_see(i.workspace_id, i.created_by, i.visibility))
    or p.id in (select c.created_by from public.library_channels c
                where public.library_can_see(c.workspace_id, c.created_by, c.visibility)
                   or c.visibility = 'ibos')
  );
comment on view public.library_people is 'Names of speakers and creators of library items and channels you can see.';
revoke all on public.library_people from anon;
grant select on public.library_people to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `library` bucket, "<workspace_id>/<item_id>/<file>"
-- ---------------------------------------------------------------------------

update storage.buckets set file_size_limit = 209715200,
  allowed_mime_types = array['audio/*', 'video/*', 'application/pdf']
where id = 'library';

-- Read: the file belongs to an item you can see (by the item id in the path).
create policy "library: read visible items" on storage.objects
  for select to authenticated
  using (bucket_id = 'library'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())
         and (public.library_item_visible((storage.foldername(name))[2])
              -- the uploader, until the item row exists
              or owner_id = (select auth.uid())::text));

-- Upload: anyone who may add to the library, into their workspace's folder.
create policy "library: sharers upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library'
              and (storage.foldername(name))[1] = (select public.current_workspace_id())
              and (select public.library_can_share('downline')));

-- Remove: the uploader, or whoever may edit the item.
create policy "library: uploader or editor removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'library'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())
         and (owner_id = (select auth.uid())::text
              or public.library_item_editable((storage.foldername(name))[2])));
