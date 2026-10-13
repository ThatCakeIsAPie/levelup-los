-- Chat tables, exactly as in the "Chat data contract" of
-- docs/plans/messaging-and-backend-plan-2026-10-12.md (snake_case of the TS
-- fields). Child tables reach their workspace through their conversation /
-- person, so only conversations, members and library_items carry workspace_id.

create table public.conversations (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('announcements', 'main', 'group', 'dm')),
  title text,
  description text,
  icon text,
  pinned boolean not null default false,
  retention_days integer check (retention_days is null or retention_days > 0),
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((kind = 'dm') = (title is null)),
  check (kind <> 'dm' or not pinned)
);
create index conversations_workspace_idx on public.conversations (workspace_id, kind);
-- One announcements chat and one main chat per workspace.
create unique index conversations_one_announcements on public.conversations (workspace_id) where kind = 'announcements';
create unique index conversations_one_main on public.conversations (workspace_id) where kind = 'main';

create table public.conversation_members (
  conversation_id text not null references public.conversations (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'moderator', 'member')),
  last_read_at timestamptz,
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, person_id)
);
create index conversation_members_person_idx on public.conversation_members (person_id);

create table public.messages (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.conversations (id) on delete cascade,
  author_id text default public.current_person_id() references public.people (id) on delete set null,
  body text not null default '',
  reply_to_id text references public.messages (id) on delete set null,
  -- MessageCard: {"type":"event","eventId":..} | {"type":"win",..} | {"type":"learning",..} | {"type":"link",..}
  card jsonb check (card is null or card ->> 'type' in ('event', 'win', 'learning', 'link')),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc);
create index messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;
create index messages_author_idx on public.messages (author_id, conversation_id, created_at desc);

create table public.attachments (
  id text primary key default gen_random_uuid()::text,
  message_id text not null references public.messages (id) on delete cascade,
  kind text not null check (kind in ('image', 'voice', 'file')),
  -- Path in the chat-media bucket: "<conversation_id>/<message_id>/<file>"
  storage_path text not null,
  mime text,
  size bigint check (size is null or size >= 0),
  duration_ms integer,
  width integer,
  height integer
);
create index attachments_message_idx on public.attachments (message_id);

create table public.reactions (
  message_id text not null references public.messages (id) on delete cascade,
  person_id text not null default public.current_person_id() references public.people (id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  primary key (message_id, person_id, emoji)
);
create index reactions_person_idx on public.reactions (person_id);

create table public.mentions (
  message_id text not null references public.messages (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  primary key (message_id, person_id)
);
create index mentions_person_idx on public.mentions (person_id);

create table public.announcement_drafts (
  id text primary key default gen_random_uuid()::text,
  conversation_id text not null references public.conversations (id) on delete cascade,
  author_id text default public.current_person_id() references public.people (id) on delete cascade,
  body text not null default '',
  card jsonb check (card is null or card ->> 'type' in ('event', 'win', 'learning', 'link')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewer_id text references public.people (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index announcement_drafts_status_idx on public.announcement_drafts (conversation_id, status, created_at desc);
create index announcement_drafts_author_idx on public.announcement_drafts (author_id);

create table public.notifications (
  id text primary key default gen_random_uuid()::text,
  recipient_id text not null references public.people (id) on delete cascade,
  type text not null check (type in (
    'mention', 'reply', 'announcement_draft', 'announcement_posted', 'report',
    'event_post', 'win', 'checkin_logged', 'reaction'
  )),
  actor_id text references public.people (id) on delete set null,
  conversation_id text references public.conversations (id) on delete cascade,
  message_id text references public.messages (id) on delete cascade,
  -- Draft id, report id, contact id, ... depending on type.
  ref_id text,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_recipient_idx on public.notifications (recipient_id, read_at, created_at desc);
create index notifications_ref_idx on public.notifications (ref_id) where ref_id is not null;

create table public.reports (
  id text primary key default gen_random_uuid()::text,
  message_id text not null references public.messages (id) on delete cascade,
  reporter_id text default public.current_person_id() references public.people (id) on delete set null,
  reason text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text references public.people (id) on delete set null
);
create index reports_message_idx on public.reports (message_id);
create index reports_open_idx on public.reports (created_at desc) where resolved_at is null;

create table public.blocks (
  blocker_id text not null default public.current_person_id() references public.people (id) on delete cascade,
  blocked_id text not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id);

create table public.library_items (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('audio', 'video', 'document')),
  title text not null,
  duration_sec integer,
  -- A path in the "library" bucket ("<workspace_id>/...") or an external URL.
  url text not null,
  created_by text default public.current_person_id() references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);
create index library_items_workspace_idx on public.library_items (workspace_id, created_at desc);
