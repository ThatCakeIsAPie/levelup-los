-- What the app needs to run on this database in "supabase" mode
-- (src/data/remote). New migration on top of 20261012*; never edit those.
--
--  1. conversations.pinned_message_id: the pinned message per chat (was the
--     browser store's `pins`), with who may pin.
--  2. A removed (soft-deleted) message also loses its attachments, reactions,
--     mentions and pin, like the browser store.
--  3. Notifications the browser demo creates that the database didn't:
--     announcement_posted to the whole chat for every announcement, and
--     event_post when someone answers an event card (answer_event_post RPC).
--     Muted chats don't notify replies, wins and reactions.
--  4. When a group's last admin leaves, the longest-standing moderator (else
--     member) becomes admin.
--  5. Client-chosen ids for create_dm and approve_announcement, so the app can
--     show the DM / approved post before the server answers.
--  6. event_rsvp_counts(): team-wide totals for event cards (no identities).
--  7. Realtime also publishes conversations, attachments, mentions, reports.

-- ---------------------------------------------------------------------------
-- 1. Pinned message per conversation
-- ---------------------------------------------------------------------------

alter table public.conversations
  add column pinned_message_id text references public.messages (id) on delete set null;
comment on column public.conversations.pinned_message_id is
  'The message pinned to the top of this chat (null = none). DM members, chat admins/moderators and workspace leaders/moderators pin.';

-- May the caller pin a message here? Either member of a DM; in other chats
-- whoever may moderate it (chat admins/moderators, workspace leaders/moderators).
create function public.can_pin_conversation(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_conversation_member(p_conversation_id)
     and (public.conversation_kind(p_conversation_id) = 'dm'
          or public.can_moderate_conversation(p_conversation_id))
$$;

-- Mirror of the "edit conversations" policy (title, description, icon,
-- retention): group admins, team chats by moderators/leaders, DM members.
create function public.can_edit_conversation(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_conversation_member(p_conversation_id)
     and (public.conversation_kind(p_conversation_id) = 'dm'
          or public.conversation_role(p_conversation_id) = 'admin'
          or (public.is_team_chat(p_conversation_id) and public.is_moderator_or_leader()))
$$;

-- Group moderators may update a conversation too, but the guard below only
-- lets them change the pin.
create policy "pin messages" on public.conversations
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and public.can_pin_conversation(id))
  with check (workspace_id = (select public.current_workspace_id()));

create or replace function public.conversations_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if new.kind <> old.kind or new.workspace_id <> old.workspace_id
       or new.created_by is distinct from old.created_by or new.created_at <> old.created_at then
      raise exception 'kind, workspace_id, created_by and created_at cannot change' using errcode = '42501';
    end if;
    if new.pinned <> old.pinned and not public.is_moderator_or_leader() then
      raise exception 'Only moderators and leaders pin team chats' using errcode = '42501';
    end if;
    if (new.title, new.description, new.icon, new.retention_days)
       is distinct from (old.title, old.description, old.icon, old.retention_days)
       and not public.can_edit_conversation(new.id) then
      raise exception 'Only the chat admin edits this chat' using errcode = '42501';
    end if;
    if new.pinned_message_id is distinct from old.pinned_message_id then
      if not public.can_pin_conversation(new.id) then
        raise exception 'Only moderators pin messages in this chat' using errcode = '42501';
      end if;
      if new.pinned_message_id is not null and not exists (
        select 1 from public.messages m
        where m.id = new.pinned_message_id and m.conversation_id = new.id and m.deleted_at is null
      ) then
        raise exception 'Pin a message from this chat' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Removing a message removes its content everywhere
-- ---------------------------------------------------------------------------

create function public.messages_after_remove() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.attachments a where a.message_id = new.id;
    delete from public.reactions r where r.message_id = new.id;
    delete from public.mentions x where x.message_id = new.id;
    update public.conversations c set pinned_message_id = null where c.pinned_message_id = new.id;
  end if;
  return new;
end;
$$;

create trigger messages_after_remove after update of deleted_at on public.messages
  for each row execute function public.messages_after_remove();

-- ---------------------------------------------------------------------------
-- 3. Notifications
-- ---------------------------------------------------------------------------

-- Same as before, plus: muted chats ("Mentions only") don't notify replies,
-- wins and reactions.
create or replace function public.notify(
  p_recipient text,
  p_type text,
  p_actor text,
  p_conversation text,
  p_message text,
  p_ref text,
  p_at timestamptz default now()
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text;
begin
  if p_recipient is null or p_recipient = p_actor then
    return null;
  end if;
  if p_actor is not null and exists (
    select 1 from public.blocks b where b.blocker_id = p_recipient and b.blocked_id = p_actor
  ) then
    return null;
  end if;
  if p_type in ('reply', 'win', 'reaction') and p_conversation is not null and exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = p_conversation and cm.person_id = p_recipient and cm.muted
  ) then
    return null;
  end if;
  insert into public.notifications (recipient_id, type, actor_id, conversation_id, message_id, ref_id, created_at)
  values (p_recipient, p_type, p_actor, p_conversation, p_message, p_ref, coalesce(p_at, now()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.notify(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- A new announcement notifies everyone in the announcements chat (the author
-- of an approved draft is told separately by approve_announcement).
create function public.messages_announce() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  if public.conversation_kind(new.conversation_id) <> 'announcements' or new.author_id is null then
    return new;
  end if;
  for r in
    select cm.person_id from public.conversation_members cm
    where cm.conversation_id = new.conversation_id and cm.person_id <> new.author_id
  loop
    perform public.notify(r.person_id, 'announcement_posted', new.author_id, new.conversation_id,
                          new.id, null, new.created_at);
  end loop;
  return new;
end;
$$;

create trigger messages_announce after insert on public.messages
  for each row execute function public.messages_announce();

-- A mention replaces a reply or announcement notification for the same
-- message, so nobody gets two.
create or replace function public.mentions_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages m where m.id = new.message_id;
  if v_msg.deleted_at is not null or not exists (
    select 1 from public.conversation_members cm
    where cm.conversation_id = v_msg.conversation_id and cm.person_id = new.person_id
  ) then
    return new;
  end if;
  update public.notifications n set type = 'mention'
   where n.message_id = new.message_id and n.recipient_id = new.person_id
     and (n.type = 'reply' or (n.type = 'announcement_posted' and n.ref_id is null));
  if not found then
    perform public.notify(new.person_id, 'mention', v_msg.author_id, v_msg.conversation_id, v_msg.id, null, v_msg.created_at);
  end if;
  return new;
end;
$$;

-- Someone answered an event card (Going / Maybe / Bought my ticket; the
-- attendance row itself is written directly). Tells the card's author, one
-- notification per person per post (a new answer replaces the old one).
create function public.answer_event_post(p_message_id text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_msg public.messages;
begin
  select * into v_msg from public.messages m where m.id = p_message_id;
  if not found or not public.is_conversation_member(v_msg.conversation_id) then
    raise exception 'Message not found' using errcode = 'P0002';
  end if;
  if v_msg.card ->> 'type' is distinct from 'event' or v_msg.deleted_at is not null then
    raise exception 'That message is not an event post' using errcode = '22023';
  end if;
  delete from public.notifications n
   where n.type = 'event_post' and n.message_id = p_message_id and n.actor_id = v_me;
  return public.notify(v_msg.author_id, 'event_post', v_me, v_msg.conversation_id, v_msg.id,
                       v_msg.card ->> 'eventId');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. A group never ends up without an admin
-- ---------------------------------------------------------------------------

create function public.conversation_members_after_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_heir text;
begin
  if old.role <> 'admin' or public.conversation_kind(old.conversation_id) is distinct from 'group' then
    return old;
  end if;
  if exists (select 1 from public.conversation_members cm
             where cm.conversation_id = old.conversation_id and cm.role = 'admin') then
    return old;
  end if;
  select cm.person_id into v_heir from public.conversation_members cm
  where cm.conversation_id = old.conversation_id
  order by (cm.role = 'moderator') desc, cm.joined_at, cm.person_id
  limit 1;
  if v_heir is not null then
    update public.conversation_members set role = 'admin'
     where conversation_id = old.conversation_id and person_id = v_heir;
  end if;
  return old;
end;
$$;

create trigger conversation_members_after_delete after delete on public.conversation_members
  for each row execute function public.conversation_members_after_delete();

-- ---------------------------------------------------------------------------
-- 5. Client-chosen ids
-- ---------------------------------------------------------------------------

-- create_dm with the id the app already shows ("dm-<a>-<b>"); an existing DM
-- between the two keeps its id (the app switches to it).
create function public.create_dm(p_other_person_id text, p_conversation_id text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_ws text := public.current_workspace_id();
  v_id text;
begin
  if v_me is null or not public.chat_eligible(v_me) then
    raise exception 'Chat is not available for your account' using errcode = '42501';
  end if;
  if p_other_person_id is null or p_other_person_id = v_me then
    raise exception 'Pick someone else to message' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dm:' || least(v_me, p_other_person_id) || ':' || greatest(v_me, p_other_person_id)));

  select c.id into v_id
  from public.conversations c
  where c.kind = 'dm' and c.workspace_id = v_ws
    and exists (select 1 from public.conversation_members a where a.conversation_id = c.id and a.person_id = v_me)
    and exists (select 1 from public.conversation_members b where b.conversation_id = c.id and b.person_id = p_other_person_id)
  order by c.created_at
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if not public.can_dm(v_me, p_other_person_id) then
    raise exception 'You can only message people you share a chat with' using errcode = '42501';
  end if;

  insert into public.conversations (id, workspace_id, kind, title, created_by)
  values (coalesce(nullif(trim(p_conversation_id), ''), gen_random_uuid()::text), v_ws, 'dm', null, v_me)
  returning id into v_id;
  insert into public.conversation_members (conversation_id, person_id, role)
  values (v_id, v_me, 'member'), (v_id, p_other_person_id, 'member');
  return v_id;
end;
$$;

create or replace function public.create_dm(p_other_person_id text) returns text
language sql security definer set search_path = ''
as $$ select public.create_dm(p_other_person_id, null::text) $$;

-- approve_announcement with the id of the message the app already shows.
create function public.approve_announcement(p_draft_id text, p_message_id text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_d public.announcement_drafts;
  v_msg text;
begin
  if not public.is_moderator_or_leader() or not public.chat_eligible(v_me) then
    raise exception 'Only leaders and moderators approve announcements' using errcode = '42501';
  end if;
  select * into v_d from public.announcement_drafts d where d.id = p_draft_id for update;
  if not found or public.conversation_workspace(v_d.conversation_id) is distinct from public.current_workspace_id() then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_d.status <> 'pending' then
    raise exception 'This draft was already reviewed' using errcode = '22023';
  end if;

  insert into public.messages (id, conversation_id, author_id, body, card)
  values (coalesce(nullif(trim(p_message_id), ''), gen_random_uuid()::text),
          v_d.conversation_id, v_d.author_id, v_d.body, v_d.card)
  returning id into v_msg;

  update public.announcement_drafts
     set status = 'approved', reviewer_id = v_me, reviewed_at = now()
   where id = p_draft_id;
  update public.notifications
     set read_at = now()
   where type = 'announcement_draft' and ref_id = p_draft_id and read_at is null;
  perform public.notify(v_d.author_id, 'announcement_posted', v_me, v_d.conversation_id, v_msg, p_draft_id);
  return v_msg;
end;
$$;

create or replace function public.approve_announcement(p_draft_id text) returns text
language sql security definer set search_path = ''
as $$ select public.approve_announcement(p_draft_id, null::text) $$;

-- ---------------------------------------------------------------------------
-- 6. Event card totals for the whole team (no identities)
-- ---------------------------------------------------------------------------

create function public.event_rsvp_counts()
returns table (event_id text, bought bigint, going bigint, maybe bigint)
language sql stable security definer set search_path = ''
as $$
  select a.event_id,
         count(*) filter (where a.has_ticket),
         count(*) filter (where not a.has_ticket and a.desire_to_attend = 'yes'),
         count(*) filter (where not a.has_ticket and a.desire_to_attend = 'maybe')
  from public.attendances a
  where a.workspace_id = public.current_workspace_id()
    and public.current_person_id() is not null
  group by a.event_id
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.messages_after_remove() from public, anon, authenticated;
revoke execute on function public.messages_announce() from public, anon, authenticated;
revoke execute on function public.conversation_members_after_delete() from public, anon, authenticated;
revoke execute on function public.answer_event_post(text) from public, anon;
revoke execute on function public.create_dm(text, text) from public, anon;
revoke execute on function public.approve_announcement(text, text) from public, anon;
revoke execute on function public.event_rsvp_counts() from public, anon;
revoke execute on function public.can_pin_conversation(text) from anon;
revoke execute on function public.can_edit_conversation(text) from anon;
grant execute on function public.answer_event_post(text) to authenticated;
grant execute on function public.create_dm(text, text) to authenticated;
grant execute on function public.approve_announcement(text, text) to authenticated;
grant execute on function public.event_rsvp_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table
  public.conversations,
  public.attachments,
  public.mentions,
  public.reports;
