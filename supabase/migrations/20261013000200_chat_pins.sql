-- Personal chat pins. New migration on top of the earlier ones; never edit those.
--
-- conversation_members.pinned_at: when this member pinned the chat to the top
-- of their own list (null = not pinned). Pins are personal: nobody else sees
-- them, and only the member changes their own. Team chats
-- (conversations.pinned = true: Announcements, Main chat, Daily wins, High
-- signal) start pinned for everyone, and each person may unpin them.
-- At most 10 pins per list tab (groups / direct messages), like the app.

alter table public.conversation_members add column pinned_at timestamptz;
comment on column public.conversation_members.pinned_at is
  'When this member pinned the chat to the top of their list (null = not pinned). Personal; team chats start pinned.';

-- Existing members of team chats: pinned since they joined.
update public.conversation_members cm
set pinned_at = cm.joined_at
from public.conversations c
where c.id = cm.conversation_id and c.pinned and cm.pinned_at is null;

-- The guard from 20261012000800_triggers, plus pinned_at:
--  * on insert, a member of a pinned team chat starts pinned (also when the
--    team-chat triggers add people); a client can't pin a chat for someone
--    else it adds (a group admin adding members);
--  * on update, pinned_at is personal like read state and mute, and a client
--    can pin at most 10 chats per tab.
create or replace function public.conversation_members_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_me text;
  v_pinned boolean;
  v_dm boolean;
begin
  if tg_op = 'INSERT' then
    new.last_read_at := coalesce(new.last_read_at, now());
    if public.is_client_write() then
      new.joined_at := now();
      if new.person_id is distinct from public.current_person_id() then
        new.pinned_at := null;
      end if;
    end if;
    if new.pinned_at is null then
      select c.pinned into v_pinned from public.conversations c where c.id = new.conversation_id;
      if coalesce(v_pinned, false) then
        new.pinned_at := now();
      end if;
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
     and (new.last_read_at is distinct from old.last_read_at
          or new.muted <> old.muted
          or new.pinned_at is distinct from old.pinned_at) then
    raise exception 'Read state, mute and pins are personal' using errcode = '42501';
  end if;
  if new.pinned_at is not null and old.pinned_at is null then
    v_dm := public.conversation_kind(new.conversation_id) = 'dm';
    if (select count(*) from public.conversation_members cm
        join public.conversations c on c.id = cm.conversation_id
        where cm.person_id = new.person_id
          and cm.pinned_at is not null
          and cm.conversation_id <> new.conversation_id
          and (c.kind = 'dm') = v_dm) >= 10 then
      raise exception 'You can pin up to 10 chats here' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
