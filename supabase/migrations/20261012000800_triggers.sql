-- Triggers: column guards for direct client writes, cascades, team-chat
-- membership, notifications and the automatic conversation check-in.
--
-- Guards only apply to direct client writes (current_user = 'authenticated').
-- RPCs and triggers run as the definer (postgres) and the seed runs as
-- postgres, so they skip the guards and do their own checks.

create function public.is_client_write() returns boolean
language sql stable set search_path = ''
as $$ select current_user in ('authenticated', 'anon') $$;

-- ---------------------------------------------------------------------------
-- updated-at stamps
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger attendances_touch before update on public.attendances
  for each row execute function public.touch_updated_at();
create trigger logistics_touch before update on public.logistics
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- people: guard, cascade on delete, team-chat sync on stage changes
-- ---------------------------------------------------------------------------

create function public.people_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_me text;
begin
  if tg_op = 'UPDATE' then
    new.last_updated_at := now();
  end if;
  if not public.is_client_write() then
    return new;
  end if;
  v_me := public.current_person_id();

  if tg_op = 'INSERT' and public.is_candidate() then
    raise exception 'Candidates cannot add people' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.workspace_id <> old.workspace_id then
      raise exception 'id and workspace_id cannot change' using errcode = '42501';
    end if;
    -- Nobody promotes or re-sponsors themselves (leaders excepted).
    if new.id = v_me and not public.is_leader()
       and (new.biz_class is distinct from old.biz_class or new.sponsor_id is distinct from old.sponsor_id) then
      raise exception 'You cannot change your own stage or sponsor' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'INSERT' or new.sponsor_id is distinct from old.sponsor_id then
    if new.sponsor_id is null then
      if not public.is_leader() and new.biz_class <> 'customer' then
        raise exception 'Only leaders can add someone without a sponsor' using errcode = '42501';
      end if;
    else
      if not public.can_see_person(new.sponsor_id) then
        raise exception 'Sponsor not found' using errcode = '42501';
      end if;
      if not exists (select 1 from public.people s where s.id = new.sponsor_id and s.biz_class in ('apprentice', 'ibo')) then
        raise exception 'A sponsor must be an apprentice or IBO' using errcode = '23514';
      end if;
      if tg_op = 'UPDATE' and new.sponsor_id in (select public.downline_ids(new.id)) then
        raise exception 'Someone cannot be sponsored by their own downline' using errcode = '23514';
      end if;
    end if;
  end if;

  if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
    if not public.can_see_person(new.owner_id) then
      raise exception 'Owner not found' using errcode = '42501';
    end if;
    if not exists (select 1 from public.people o where o.id = new.owner_id and o.biz_class in ('apprentice', 'ibo')) then
      raise exception 'A customer belongs to an apprentice or IBO' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger people_guard before insert or update on public.people
  for each row execute function public.people_guard();

-- Mirror of rosterWithout/opsWithoutPerson (src/data/cascade.ts): the direct
-- downline and owned customers move to the deleted person's sponsor, costs
-- they organized pass to that sponsor (not opted in). Attendance, travel,
-- cost memberships, overrides and payments go by FK cascade. Activity rows
-- are written here (the client should not log the delete itself).
create function public.people_before_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_heir text := case when old.biz_class = 'customer' then null else old.sponsor_id end;
  v_heir_name text;
  v_actor text := public.current_person_id();
  v_actor_name text;
  r record;
begin
  select p.name into v_heir_name from public.people p where p.id = v_heir;
  select coalesce((select p.name from public.people p where p.id = v_actor), 'System') into v_actor_name;

  for r in
    update public.people p set sponsor_id = v_heir
     where p.sponsor_id = old.id and p.biz_class <> 'customer'
    returning p.id
  loop
    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id, related_person_id, kind, summary)
    values (old.workspace_id, v_actor_name, v_actor, 'person', r.id, r.id, 'updated',
            case when v_heir_name is not null
                 then format('Moved under %s (%s was removed)', v_heir_name, old.name)
                 else format('Sponsor %s was removed', old.name) end);
  end loop;

  update public.people p set owner_id = v_heir
   where p.owner_id = old.id and p.biz_class = 'customer';

  if v_heir is not null then
    update public.shared_costs c set owner_id = v_heir where c.owner_id = old.id;
  end if;

  insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id, related_person_id, kind, summary)
  values (old.workspace_id, v_actor_name, v_actor, 'person', old.id, old.id, 'deleted', format('Removed %s', old.name));
  return old;
end;
$$;

create trigger people_before_delete before delete on public.people
  for each row execute function public.people_before_delete();

-- Team chats: every chat-eligible member belongs to announcements and main;
-- on joining the workspace they are also added to the pinned team groups.
create function public.sync_team_chats(p_person_id text, p_include_pinned boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.chat_eligible(p_person_id) then
    return;
  end if;
  insert into public.conversation_members (conversation_id, person_id, role)
  select c.id, p_person_id, 'member'
  from public.conversations c
  where c.workspace_id = public.person_workspace(p_person_id)
    and (c.kind in ('announcements', 'main') or (p_include_pinned and c.kind = 'group' and c.pinned))
  on conflict do nothing;
end;
$$;
revoke execute on function public.sync_team_chats(text, boolean) from public, anon, authenticated;

create function public.members_sync_chats() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.sync_team_chats(new.person_id, tg_op = 'INSERT');
  return new;
end;
$$;

create trigger members_sync_chats after insert or update of role on public.members
  for each row execute function public.members_sync_chats();

create function public.people_sync_chats() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.sync_team_chats(new.id, false);
  return new;
end;
$$;

create trigger people_sync_chats after update of biz_class, business_start_date on public.people
  for each row execute function public.people_sync_chats();

-- ---------------------------------------------------------------------------
-- shared costs: organizer is opted in; only leaders hand a cost to someone else
-- ---------------------------------------------------------------------------

create function public.shared_costs_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.shared_cost_members (cost_id, person_id) values (new.id, new.owner_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger shared_costs_after_insert after insert on public.shared_costs
  for each row execute function public.shared_costs_after_insert();

create function public.shared_costs_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if new.workspace_id <> old.workspace_id or new.event_id <> old.event_id then
      raise exception 'workspace_id and event_id cannot change' using errcode = '42501';
    end if;
    if new.owner_id is distinct from old.owner_id and not public.is_leader() then
      raise exception 'Only leaders can hand a cost to another organizer' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger shared_costs_guard before update on public.shared_costs
  for each row execute function public.shared_costs_guard();

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------

create function public.conversations_guard() returns trigger
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
  end if;
  return new;
end;
$$;

create trigger conversations_guard before update on public.conversations
  for each row execute function public.conversations_guard();

-- The creator becomes admin of a group; team chats get every eligible member.
create function public.conversations_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'dm' then
    return new; -- create_dm() adds both participants
  end if;
  if new.created_by is not null and public.chat_eligible(new.created_by) then
    insert into public.conversation_members (conversation_id, person_id, role)
    values (new.id, new.created_by, 'admin')
    on conflict (conversation_id, person_id) do update set role = 'admin';
  end if;
  if new.kind in ('announcements', 'main') or (new.kind = 'group' and new.pinned) then
    insert into public.conversation_members (conversation_id, person_id, role)
    select new.id, m.person_id, 'member'
    from public.members m
    where m.workspace_id = new.workspace_id and public.chat_eligible(m.person_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger conversations_after_insert after insert on public.conversations
  for each row execute function public.conversations_after_insert();

-- ---------------------------------------------------------------------------
-- conversation_members
-- ---------------------------------------------------------------------------

create function public.conversation_members_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_me text;
begin
  if tg_op = 'INSERT' then
    new.last_read_at := coalesce(new.last_read_at, now());
    if public.is_client_write() then
      new.joined_at := now();
    end if;
    return new;
  end if;

  if not public.is_client_write() then
    return new;
  end if;
  v_me := public.current_person_id();
  if new.conversation_id <> old.conversation_id or new.person_id <> old.person_id or new.joined_at <> old.joined_at then
    raise exception 'conversation_id, person_id and joined_at cannot change' using errcode = '42501';
  end if;
  if new.role <> old.role then
    if public.conversation_kind(new.conversation_id) = 'dm' then
      raise exception 'DMs have no roles' using errcode = '42501';
    end if;
    if not (public.conversation_role(new.conversation_id) = 'admin'
            or (public.is_team_chat(new.conversation_id) and public.is_moderator_or_leader())) then
      raise exception 'Only the chat admin changes roles' using errcode = '42501';
    end if;
  end if;
  if new.person_id <> v_me
     and (new.last_read_at is distinct from old.last_read_at or new.muted <> old.muted) then
    raise exception 'Read state and mute are personal' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger conversation_members_guard before insert or update on public.conversation_members
  for each row execute function public.conversation_members_guard();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create function public.messages_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_me text;
begin
  if tg_op = 'INSERT' then
    if new.reply_to_id is not null and public.message_conversation_id(new.reply_to_id) is distinct from new.conversation_id then
      raise exception 'A reply must quote a message from the same chat' using errcode = '23514';
    end if;
    if public.is_client_write() then
      new.created_at := now();
      new.edited_at := null;
      new.deleted_at := null;
    end if;
    return new;
  end if;

  -- UPDATE
  if public.is_client_write() then
    v_me := public.current_person_id();
    if new.id <> old.id or new.conversation_id <> old.conversation_id
       or new.author_id is distinct from old.author_id or new.created_at <> old.created_at
       or new.reply_to_id is distinct from old.reply_to_id then
      raise exception 'Only the text, card and deletion of a message can change' using errcode = '42501';
    end if;
    if old.deleted_at is not null then
      raise exception 'This message was deleted' using errcode = '42501';
    end if;
    if old.author_id is distinct from v_me then
      -- Moderators may only remove someone else's message.
      if new.deleted_at is null or new.body <> old.body or new.card is distinct from old.card
         or new.edited_at is distinct from old.edited_at then
        raise exception 'You can only remove other people''s messages' using errcode = '42501';
      end if;
    elsif new.deleted_at is null and (new.body <> old.body or new.card is distinct from old.card) then
      new.edited_at := now();
    elsif new.deleted_at is null then
      new.edited_at := old.edited_at;
    end if;
  end if;

  if new.deleted_at is not null and old.deleted_at is null then
    -- "Count that, never what": a removed message keeps no content.
    new.body := '';
    new.card := null;
    if public.is_client_write() then
      new.deleted_at := now();
    end if;
  end if;
  return new;
end;
$$;

create trigger messages_guard before insert or update on public.messages
  for each row execute function public.messages_guard();

-- Automatic check-in ("conversation counts as a contact"): when A posts in a
-- DM, or replies to B in a group, and B posted to A in that conversation in
-- the previous 24 hours (in a DM: any message; in a group: a reply to one of
-- A's messages), record one contact per direction with source 'message' at
-- most once per pair per local day, and notify both (checkin_logged).
create function public.record_conversation_checkin(p_message public.messages) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_kind text;
  v_ws text;
  v_tz text;
  v_a text := p_message.author_id;
  v_b text;
  v_day date;
  v_contact_b text;
  v_contact_a text;
begin
  if v_a is null or p_message.deleted_at is not null then
    return;
  end if;
  select c.kind, c.workspace_id, w.timezone into v_kind, v_ws, v_tz
  from public.conversations c join public.workspaces w on w.id = c.workspace_id
  where c.id = p_message.conversation_id;

  if v_kind = 'dm' then
    select cm.person_id into v_b from public.conversation_members cm
    where cm.conversation_id = p_message.conversation_id and cm.person_id <> v_a
    limit 1;
    if v_b is null or not exists (
      select 1 from public.messages m
      where m.conversation_id = p_message.conversation_id
        and m.author_id = v_b and m.deleted_at is null and m.id <> p_message.id
        and m.created_at <= p_message.created_at
        and m.created_at > p_message.created_at - interval '24 hours'
    ) then
      return;
    end if;
  elsif p_message.reply_to_id is not null then
    select m.author_id into v_b from public.messages m where m.id = p_message.reply_to_id;
    if v_b is null or v_b = v_a or not exists (
      select 1
      from public.messages m
      join public.messages r on r.id = m.reply_to_id
      where m.conversation_id = p_message.conversation_id
        and m.author_id = v_b and r.author_id = v_a
        and m.deleted_at is null and m.id <> p_message.id
        and m.created_at <= p_message.created_at
        and m.created_at > p_message.created_at - interval '24 hours'
    ) then
      return;
    end if;
  else
    return;
  end if;

  v_day := (p_message.created_at at time zone coalesce(v_tz, 'UTC'))::date;
  perform pg_advisory_xact_lock(hashtext('checkin:' || least(v_a, v_b) || ':' || greatest(v_a, v_b) || ':' || v_day));
  if exists (
    select 1 from public.contacts k
    where k.source = 'message' and k.date = v_day
      and ((k.person_id = v_a and k.by_id = v_b) or (k.person_id = v_b and k.by_id = v_a))
  ) then
    return;
  end if;

  insert into public.contacts (workspace_id, person_id, by_id, date, source, created_at)
  values (v_ws, v_b, v_a, v_day, 'message', p_message.created_at)
  returning id into v_contact_b;
  insert into public.contacts (workspace_id, person_id, by_id, date, source, created_at)
  values (v_ws, v_a, v_b, v_day, 'message', p_message.created_at)
  returning id into v_contact_a;

  -- Each person is told about the check-in with the other one.
  perform public.notify(v_a, 'checkin_logged', v_b, p_message.conversation_id, p_message.id, v_contact_b, p_message.created_at);
  perform public.notify(v_b, 'checkin_logged', v_a, p_message.conversation_id, p_message.id, v_contact_a, p_message.created_at);
end;
$$;
revoke execute on function public.record_conversation_checkin(public.messages) from public, anon, authenticated;

create function public.messages_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_replied_to text;
  v_sponsor text;
  v_seen text[] := array[]::text[];
begin
  -- Reply -> notify the quoted message's author (if they are in the chat).
  if new.reply_to_id is not null then
    select m.author_id into v_replied_to from public.messages m where m.id = new.reply_to_id;
    if v_replied_to is not null and exists (
      select 1 from public.conversation_members cm
      where cm.conversation_id = new.conversation_id and cm.person_id = v_replied_to
    ) then
      perform public.notify(v_replied_to, 'reply', new.author_id, new.conversation_id, new.id, null, new.created_at);
    end if;
  end if;

  -- Win card -> notify the author's upline (sponsor chain) who are in the chat.
  if new.card ->> 'type' = 'win' and new.author_id is not null then
    select p.sponsor_id into v_sponsor from public.people p where p.id = new.author_id;
    while v_sponsor is not null and not v_sponsor = any (v_seen) loop
      v_seen := v_seen || v_sponsor;
      if exists (select 1 from public.conversation_members cm
                 where cm.conversation_id = new.conversation_id and cm.person_id = v_sponsor) then
        perform public.notify(v_sponsor, 'win', new.author_id, new.conversation_id, new.id,
                              new.card ->> 'refId', new.created_at);
      end if;
      select p.sponsor_id into v_sponsor from public.people p where p.id = v_sponsor;
    end loop;
  end if;

  perform public.record_conversation_checkin(new);
  return new;
end;
$$;

create trigger messages_after_insert after insert on public.messages
  for each row execute function public.messages_after_insert();

-- ---------------------------------------------------------------------------
-- mentions, reactions
-- ---------------------------------------------------------------------------

-- Mention -> notify the mentioned member (a reply notification for the same
-- message becomes the mention, so nobody gets two).
create function public.mentions_after_insert() returns trigger
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
   where n.message_id = new.message_id and n.recipient_id = new.person_id and n.type = 'reply';
  if not found then
    perform public.notify(new.person_id, 'mention', v_msg.author_id, v_msg.conversation_id, v_msg.id, null, v_msg.created_at);
  end if;
  return new;
end;
$$;

create trigger mentions_after_insert after insert on public.mentions
  for each row execute function public.mentions_after_insert();

create function public.reactions_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    new.created_at := now();
  end if;
  return new;
end;
$$;

create trigger reactions_guard before insert on public.reactions
  for each row execute function public.reactions_guard();

-- Reaction -> notify the message author (ref_id = the emoji).
create function public.reactions_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_msg public.messages;
begin
  select * into v_msg from public.messages m where m.id = new.message_id;
  perform public.notify(v_msg.author_id, 'reaction', new.person_id, v_msg.conversation_id, v_msg.id, new.emoji, new.created_at);
  return new;
end;
$$;

create trigger reactions_after_insert after insert on public.reactions
  for each row execute function public.reactions_after_insert();

-- ---------------------------------------------------------------------------
-- announcement drafts, reports, notifications
-- ---------------------------------------------------------------------------

create function public.announcement_drafts_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'INSERT' then
      new.created_at := now();
    elsif new.conversation_id <> old.conversation_id or new.author_id is distinct from old.author_id
          or new.created_at <> old.created_at then
      raise exception 'Only the text and card of a draft can change' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger announcement_drafts_guard before insert or update on public.announcement_drafts
  for each row execute function public.announcement_drafts_guard();

-- New draft -> notify every leader and moderator of the workspace.
create function public.announcement_drafts_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select m.person_id from public.members m
    where m.workspace_id = public.conversation_workspace(new.conversation_id)
      and m.role in ('leader', 'moderator')
      and public.chat_eligible(m.person_id)
  loop
    perform public.notify(r.person_id, 'announcement_draft', new.author_id, new.conversation_id, null, new.id, new.created_at);
  end loop;
  return new;
end;
$$;

create trigger announcement_drafts_after_insert after insert on public.announcement_drafts
  for each row execute function public.announcement_drafts_after_insert();

create function public.reports_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'INSERT' then
      new.created_at := now();
    else
      if new.message_id <> old.message_id or new.reporter_id is distinct from old.reporter_id
         or new.reason <> old.reason or new.created_at <> old.created_at then
        raise exception 'Only resolving a report is allowed' using errcode = '42501';
      end if;
      if new.resolved_at is not null and old.resolved_at is null then
        new.resolved_by := public.current_person_id();
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger reports_guard before insert or update on public.reports
  for each row execute function public.reports_guard();

-- New report -> notify every leader of the workspace (they see the report,
-- not the message, if it is in a DM they are not part of).
create function public.reports_after_insert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_conv text := public.message_conversation_id(new.message_id);
  r record;
begin
  for r in
    select m.person_id from public.members m
    where m.workspace_id = public.conversation_workspace(v_conv) and m.role = 'leader'
  loop
    perform public.notify(r.person_id, 'report', new.reporter_id, v_conv, new.message_id, new.id, new.created_at);
  end loop;
  return new;
end;
$$;

create trigger reports_after_insert after insert on public.reports
  for each row execute function public.reports_after_insert();

create function public.notifications_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write()
     and (row(new.id, new.recipient_id, new.type, new.actor_id, new.conversation_id, new.message_id, new.ref_id, new.created_at)
          is distinct from
          row(old.id, old.recipient_id, old.type, old.actor_id, old.conversation_id, old.message_id, old.ref_id, old.created_at)) then
    raise exception 'Only read_at of a notification can change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger notifications_guard before update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------------
-- Retention: delete messages older than a conversation's retention_days.
-- ---------------------------------------------------------------------------

create function public.purge_expired_messages() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.messages m
  using public.conversations c
  where c.id = m.conversation_id
    and c.retention_days is not null
    and m.created_at < now() - make_interval(days => c.retention_days);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_messages() from public, anon, authenticated;
grant execute on function public.purge_expired_messages() to service_role;

-- Run it nightly with pg_cron when the extension is available (it is in the
-- local Supabase image and on hosted Supabase).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-expired-messages', '17 3 * * *', 'select public.purge_expired_messages()');
  else
    raise notice 'pg_cron not available: call public.purge_expired_messages() from a scheduler instead';
  end if;
end;
$$;

-- Trigger functions are never called directly.
revoke execute on function public.people_before_delete() from public, anon, authenticated;
revoke execute on function public.members_sync_chats() from public, anon, authenticated;
revoke execute on function public.people_sync_chats() from public, anon, authenticated;
revoke execute on function public.shared_costs_after_insert() from public, anon, authenticated;
revoke execute on function public.conversations_after_insert() from public, anon, authenticated;
revoke execute on function public.messages_after_insert() from public, anon, authenticated;
revoke execute on function public.mentions_after_insert() from public, anon, authenticated;
revoke execute on function public.reactions_after_insert() from public, anon, authenticated;
revoke execute on function public.announcement_drafts_after_insert() from public, anon, authenticated;
revoke execute on function public.reports_after_insert() from public, anon, authenticated;
