-- Row-level security for the chat tables.
--  * You only read conversations, members, messages, reactions, mentions and
--    attachments of conversations you belong to, and only while you are chat
--    eligible (apprentice/IBO or leader). Leaders included: nobody reads a DM
--    they are not in.
--  * Column-level rules (who may change a role, edit vs delete a message, ...)
--    live in the guard triggers (20261012000800_triggers.sql).

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.reactions enable row level security;
alter table public.mentions enable row level security;
alter table public.announcement_drafts enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;
alter table public.library_items enable row level security;

-- conversations ---------------------------------------------------------------

-- Your conversations, plus the team chats you could (re)join, plus groups you
-- created (needed so INSERT ... RETURNING works before the admin row exists).
create policy "read your conversations" on public.conversations
  for select to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and (select public.chat_eligible(public.current_person_id()))
    and (id in (select public.my_conversation_ids())
         or (kind <> 'dm' and (kind <> 'group' or pinned))
         or (kind = 'group' and created_by = (select public.current_person_id())))
  );

-- Any eligible member creates a group (the creator becomes admin by trigger).
-- Leaders create the announcements/main chats; only moderators/leaders pin.
-- DMs are created with create_dm() only (it checks can_dm).
create policy "create groups" on public.conversations
  for insert to authenticated
  with check (
    workspace_id = (select public.current_workspace_id())
    and (select public.chat_eligible(public.current_person_id()))
    and created_by = (select public.current_person_id())
    and (kind = 'group' or (kind in ('announcements', 'main') and (select public.is_leader())))
    and (not pinned or (select public.is_moderator_or_leader()))
  );

-- Group admins edit their group; moderators/leaders edit team chats; either
-- DM participant may set the DM's retention.
create policy "edit conversations" on public.conversations
  for update to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and id in (select public.my_conversation_ids())
    and (kind = 'dm'
         or public.conversation_role(id) = 'admin'
         or (public.is_team_chat(id) and (select public.is_moderator_or_leader())))
  )
  with check (workspace_id = (select public.current_workspace_id()));

create policy "delete groups" on public.conversations
  for delete to authenticated
  using (
    workspace_id = (select public.current_workspace_id())
    and kind = 'group'
    and id in (select public.my_conversation_ids())
    and (public.conversation_role(id) = 'admin' or (select public.is_leader()))
  );

-- conversation_members ----------------------------------------------------------

create policy "read members of your conversations" on public.conversation_members
  for select to authenticated
  using (conversation_id in (select public.my_conversation_ids()));

-- Join a team chat yourself; group admins add people (as any role) and
-- group moderators add plain members. Only eligible people of the same
-- workspace; never into a DM.
create policy "add conversation members" on public.conversation_members
  for insert to authenticated
  with check (
    (select public.chat_eligible(public.current_person_id()))
    and public.chat_eligible(person_id)
    and public.conversation_kind(conversation_id) <> 'dm'
    and public.conversation_workspace(conversation_id) = (select public.current_workspace_id())
    and public.person_workspace(person_id) = (select public.current_workspace_id())
    and (
      (person_id = (select public.current_person_id()) and role = 'member' and public.is_team_chat(conversation_id))
      or public.conversation_role(conversation_id) = 'admin'
      or (public.conversation_role(conversation_id) = 'moderator' and role = 'member')
    )
  );

-- Your own row (last_read_at, muted) or, as a group admin, others' roles.
create policy "update conversation members" on public.conversation_members
  for update to authenticated
  using (
    conversation_id in (select public.my_conversation_ids())
    and (person_id = (select public.current_person_id())
         or public.conversation_role(conversation_id) = 'admin'
         or (public.is_team_chat(conversation_id) and (select public.is_moderator_or_leader())))
  )
  with check (conversation_id in (select public.my_conversation_ids()));

-- Leave a group (not announcements/main/DMs); admins remove anyone from their
-- group, group moderators remove plain members.
create policy "leave or remove" on public.conversation_members
  for delete to authenticated
  using (
    conversation_id in (select public.my_conversation_ids())
    and public.conversation_kind(conversation_id) = 'group'
    and (person_id = (select public.current_person_id())
         or public.conversation_role(conversation_id) = 'admin'
         or (public.conversation_role(conversation_id) = 'moderator' and role = 'member'))
  );

-- messages ------------------------------------------------------------------

create policy "read messages of your conversations" on public.messages
  for select to authenticated
  using (conversation_id in (select public.my_conversation_ids()));

-- Post as yourself in your conversations. Announcements: only workspace
-- moderators/leaders post directly (others create announcement_drafts).
-- DMs: not when either side blocked the other.
create policy "post messages" on public.messages
  for insert to authenticated
  with check (
    author_id = (select public.current_person_id())
    and conversation_id in (select public.my_conversation_ids())
    and (public.conversation_kind(conversation_id) <> 'announcements'
         or (select public.is_moderator_or_leader()))
    and public.dm_open(conversation_id)
  );

-- Authors edit (and soft-delete) their own messages; conversation admins /
-- moderators and workspace moderators/leaders may soft-delete others' (the
-- guard trigger allows them to change deleted_at only).
create policy "edit or remove messages" on public.messages
  for update to authenticated
  using (
    conversation_id in (select public.my_conversation_ids())
    and (author_id = (select public.current_person_id())
         or public.can_moderate_conversation(conversation_id))
  )
  with check (conversation_id in (select public.my_conversation_ids()));

create policy "hard delete messages" on public.messages
  for delete to authenticated
  using (
    conversation_id in (select public.my_conversation_ids())
    and (author_id = (select public.current_person_id())
         or public.can_moderate_conversation(conversation_id))
  );

-- attachments, reactions, mentions -------------------------------------------------

create policy "read attachments" on public.attachments
  for select to authenticated
  using (public.message_conversation_id(message_id) in (select public.my_conversation_ids()));

create policy "authors attach files" on public.attachments
  for insert to authenticated
  with check (public.message_author_id(message_id) = (select public.current_person_id())
              and public.message_conversation_id(message_id) in (select public.my_conversation_ids())
              and storage_path like public.message_conversation_id(message_id) || '/%');

create policy "authors remove attachments" on public.attachments
  for delete to authenticated
  using (public.message_author_id(message_id) = (select public.current_person_id()));

create policy "read reactions" on public.reactions
  for select to authenticated
  using (public.message_conversation_id(message_id) in (select public.my_conversation_ids()));

create policy "react as yourself" on public.reactions
  for insert to authenticated
  with check (person_id = (select public.current_person_id())
              and public.message_conversation_id(message_id) in (select public.my_conversation_ids()));

create policy "remove your reactions" on public.reactions
  for delete to authenticated
  using (person_id = (select public.current_person_id()));

create policy "read mentions" on public.mentions
  for select to authenticated
  using (public.message_conversation_id(message_id) in (select public.my_conversation_ids()));

create policy "authors mention people" on public.mentions
  for insert to authenticated
  with check (public.message_author_id(message_id) = (select public.current_person_id())
              and public.message_conversation_id(message_id) in (select public.my_conversation_ids()));

create policy "authors remove mentions" on public.mentions
  for delete to authenticated
  using (public.message_author_id(message_id) = (select public.current_person_id()));

-- announcement drafts ---------------------------------------------------------------
-- Anyone in the announcements chat drafts; leaders/moderators review with
-- approve_announcement() / reject_announcement().

create policy "read drafts" on public.announcement_drafts
  for select to authenticated
  using (
    public.conversation_workspace(conversation_id) = (select public.current_workspace_id())
    and (author_id = (select public.current_person_id())
         or ((select public.is_moderator_or_leader())
             and (select public.chat_eligible(public.current_person_id()))))
  );

create policy "draft announcements" on public.announcement_drafts
  for insert to authenticated
  with check (
    author_id = (select public.current_person_id())
    and conversation_id in (select public.my_conversation_ids())
    and public.conversation_kind(conversation_id) = 'announcements'
    and status = 'pending' and reviewer_id is null and reviewed_at is null
  );

create policy "edit pending drafts" on public.announcement_drafts
  for update to authenticated
  using (author_id = (select public.current_person_id()) and status = 'pending')
  with check (author_id = (select public.current_person_id()) and status = 'pending'
              and reviewer_id is null and reviewed_at is null);

create policy "withdraw or clear drafts" on public.announcement_drafts
  for delete to authenticated
  using (
    (author_id = (select public.current_person_id()) and status = 'pending')
    or ((select public.is_moderator_or_leader())
        and public.conversation_workspace(conversation_id) = (select public.current_workspace_id()))
  );

-- notifications: your own (created by triggers/RPCs only) -------------------------

create policy "read your notifications" on public.notifications
  for select to authenticated
  using (recipient_id = (select public.current_person_id()));

create policy "mark your notifications read" on public.notifications
  for update to authenticated
  using (recipient_id = (select public.current_person_id()))
  with check (recipient_id = (select public.current_person_id()));

create policy "clear your notifications" on public.notifications
  for delete to authenticated
  using (recipient_id = (select public.current_person_id()));

-- reports: reporter and workspace leaders ------------------------------------------

create policy "read reports" on public.reports
  for select to authenticated
  using (
    reporter_id = (select public.current_person_id())
    or ((select public.is_leader())
        and public.conversation_workspace(public.message_conversation_id(message_id))
            = (select public.current_workspace_id()))
  );

create policy "report messages you can see" on public.reports
  for insert to authenticated
  with check (reporter_id = (select public.current_person_id())
              and public.message_conversation_id(message_id) in (select public.my_conversation_ids())
              and resolved_at is null and resolved_by is null);

create policy "leaders resolve reports" on public.reports
  for update to authenticated
  using ((select public.is_leader())
         and public.conversation_workspace(public.message_conversation_id(message_id))
             = (select public.current_workspace_id()))
  with check ((select public.is_leader()));

-- blocks: your own list (the blocked person is never told) -------------------------

create policy "read your blocks" on public.blocks
  for select to authenticated
  using (blocker_id = (select public.current_person_id()));

create policy "block people" on public.blocks
  for insert to authenticated
  with check (blocker_id = (select public.current_person_id())
              and public.person_workspace(blocked_id) = (select public.current_workspace_id()));

create policy "unblock people" on public.blocks
  for delete to authenticated
  using (blocker_id = (select public.current_person_id()));

-- library ----------------------------------------------------------------------

create policy "members read the library" on public.library_items
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

create policy "moderators manage the library" on public.library_items
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id()) and (select public.is_moderator_or_leader()))
  with check (workspace_id = (select public.current_workspace_id()) and (select public.is_moderator_or_leader()));

-- Directory of chat members (names for message authors etc. even when the
-- person is outside your CRM visibility). Only chat-eligible viewers get rows.
create view public.chat_directory
with (security_barrier = true)
as
select p.id as person_id,
       p.workspace_id,
       p.name,
       public.effective_biz_class(p.biz_class, p.business_start_date) as stage,
       m.role
from public.people p
join public.members m on m.person_id = p.id and m.workspace_id = p.workspace_id
where p.workspace_id = public.current_workspace_id()
  and public.chat_eligible(p.id)
  and public.chat_eligible(public.current_person_id());

comment on view public.chat_directory is 'Names and roles of chat-eligible members of your workspace (for chat UIs). Empty for non-chat users.';
revoke all on public.chat_directory from anon;
grant select on public.chat_directory to authenticated;
