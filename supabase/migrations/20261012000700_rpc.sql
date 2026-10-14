-- RPCs (call with supabase.rpc(name, args)). All SECURITY DEFINER with explicit
-- permission checks, because they write rows the caller could not write
-- directly (e.g. a message authored by the draft's author).

-- Internal: create a notification unless it would go to the actor or the
-- recipient has blocked the actor. Not callable by clients.
create function public.notify(
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
  insert into public.notifications (recipient_id, type, actor_id, conversation_id, message_id, ref_id, created_at)
  values (p_recipient, p_type, p_actor, p_conversation, p_message, p_ref, coalesce(p_at, now()))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.notify(text, text, text, text, text, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Session
-- ---------------------------------------------------------------------------

-- Who am I? app_role mirrors the demo Role: leader | ibo | apprentice | candidate.
create function public.get_session()
returns table (
  person_id text,
  workspace_id text,
  name text,
  member_role text,
  biz_class text,
  effective_stage text,
  app_role text,
  is_chat_eligible boolean
)
language sql stable security definer set search_path = ''
as $$
  select m.person_id,
         m.workspace_id,
         p.name,
         m.role,
         p.biz_class,
         public.effective_biz_class(p.biz_class, p.business_start_date),
         case
           when m.role = 'leader' then 'leader'
           when public.effective_biz_class(p.biz_class, p.business_start_date) in ('ibo', 'apprentice')
             then public.effective_biz_class(p.biz_class, p.business_start_date)
           else 'candidate'
         end,
         public.chat_eligible(m.person_id)
  from public.members m
  join public.people p on p.id = m.person_id
  where m.user_id = auth.uid()
  order by m.joined_at, m.workspace_id
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Invites
-- ---------------------------------------------------------------------------

-- Preview an invite before signing in (anon may call this).
create function public.get_invite(p_token text)
returns table (
  workspace_id text,
  workspace_name text,
  sponsor_name text,
  stage text,
  name text,
  email text,
  expires_at timestamptz,
  is_valid boolean
)
language sql stable security definer set search_path = ''
as $$
  select i.workspace_id, w.name, s.name, i.stage, i.name, i.email, i.expires_at,
         i.used_at is null and i.expires_at > now()
  from public.invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.people s on s.id = i.sponsor_person_id
  where i.token = p_token
$$;

-- Accept an invite as the signed-in user: creates their person under the
-- sponsor (stage from the invite) and a member row. Returns the person id.
create function public.accept_invite(p_token text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inv public.invites;
  v_email text;
  v_meta jsonb;
  v_name text;
  v_today date;
  v_person text;
begin
  if v_uid is null then
    raise exception 'Sign in before accepting an invite' using errcode = '28000';
  end if;

  select * into v_inv from public.invites i where i.token = p_token for update;
  if not found then
    raise exception 'Invite not found' using errcode = 'P0002';
  end if;
  if v_inv.used_at is not null then
    raise exception 'This invite has already been used' using errcode = '22023';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'This invite has expired' using errcode = '22023';
  end if;
  if exists (select 1 from public.members m where m.user_id = v_uid and m.workspace_id = v_inv.workspace_id) then
    raise exception 'You are already a member of this team' using errcode = '23505';
  end if;

  select u.email, u.raw_user_meta_data into v_email, v_meta from auth.users u where u.id = v_uid;
  v_name := coalesce(nullif(trim(v_inv.name), ''), nullif(trim(v_meta ->> 'name'), ''),
                     nullif(trim(v_meta ->> 'full_name'), ''), split_part(coalesce(v_email, 'New member'), '@', 1));
  v_today := public.workspace_today(v_inv.workspace_id);

  insert into public.people (workspace_id, name, email, biz_class, pipeline_stage, sponsor_id,
                             joined_date, business_start_date, stage_history)
  values (v_inv.workspace_id, v_name, coalesce(v_inv.email, v_email), v_inv.stage, v_inv.stage,
          v_inv.sponsor_person_id, v_today,
          case when v_inv.stage <> 'prospect' then v_today end,
          jsonb_build_array(jsonb_build_object('stage', v_inv.stage, 'at', now())))
  returning id into v_person;

  insert into public.members (workspace_id, person_id, user_id, role)
  values (v_inv.workspace_id, v_person, v_uid, 'member');

  update public.invites set used_at = now(), used_by = v_uid where id = v_inv.id;

  insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                               related_person_id, kind, summary)
  values (v_inv.workspace_id, v_name, v_person, 'person', v_person, v_person, 'created',
          'Joined from an invite link');

  return v_person;
end;
$$;

-- ---------------------------------------------------------------------------
-- Direct messages
-- ---------------------------------------------------------------------------

-- The DM between the caller and another person: the existing one, or a new
-- one when can_dm() allows it.
create function public.create_dm(p_other_person_id text) returns text
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

  insert into public.conversations (workspace_id, kind, title, created_by)
  values (v_ws, 'dm', null, v_me)
  returning id into v_id;
  insert into public.conversation_members (conversation_id, person_id, role)
  values (v_id, v_me, 'member'), (v_id, p_other_person_id, 'member');
  return v_id;
end;
$$;

-- Mark a conversation read up to now (drives unread counts).
create function public.mark_conversation_read(p_conversation_id text) returns timestamptz
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_at timestamptz;
begin
  if v_me is null or not public.chat_eligible(v_me) then
    raise exception 'Chat is not available for your account' using errcode = '42501';
  end if;
  update public.conversation_members
     set last_read_at = now()
   where conversation_id = p_conversation_id and person_id = v_me
  returning last_read_at into v_at;
  if v_at is null then
    raise exception 'You are not in this conversation' using errcode = '42501';
  end if;
  return v_at;
end;
$$;

-- Unread messages (from others, not deleted, after last_read_at) and the
-- latest message time for each of the caller's conversations.
create function public.unread_counts()
returns table (conversation_id text, unread bigint, last_message_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cm.conversation_id,
         count(m.id) filter (
           where m.author_id is distinct from cm.person_id
             and m.deleted_at is null
             and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
         ),
         max(m.created_at)
  from public.conversation_members cm
  left join public.messages m on m.conversation_id = cm.conversation_id
  where cm.person_id = public.current_person_id()
    and public.chat_eligible(cm.person_id)
  group by cm.conversation_id
$$;

-- ---------------------------------------------------------------------------
-- Announcements
-- ---------------------------------------------------------------------------

-- Approve a pending draft: posts it to the announcements chat as its author,
-- clears the reviewers' draft notifications and notifies the author.
create function public.approve_announcement(p_draft_id text) returns text
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

  insert into public.messages (conversation_id, author_id, body, card)
  values (v_d.conversation_id, v_d.author_id, v_d.body, v_d.card)
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

create function public.reject_announcement(p_draft_id text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_d public.announcement_drafts;
begin
  if not public.is_moderator_or_leader() or not public.chat_eligible(v_me) then
    raise exception 'Only leaders and moderators review announcements' using errcode = '42501';
  end if;
  select * into v_d from public.announcement_drafts d where d.id = p_draft_id for update;
  if not found or public.conversation_workspace(v_d.conversation_id) is distinct from public.current_workspace_id() then
    raise exception 'Draft not found' using errcode = 'P0002';
  end if;
  if v_d.status <> 'pending' then
    raise exception 'This draft was already reviewed' using errcode = '22023';
  end if;
  update public.announcement_drafts
     set status = 'rejected', reviewer_id = v_me, reviewed_at = now()
   where id = p_draft_id;
  update public.notifications
     set read_at = now()
   where type = 'announcement_draft' and ref_id = p_draft_id and read_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Wallet (sandbox payments)
-- ---------------------------------------------------------------------------

-- Pay your own share of a cost (sandbox: no card data). The amount follows
-- splitCost() in src/stores/opsStore.ts: paid shares fixed, then the
-- organizer's overrides, then an even split of the rest. Amount and cost name
-- are frozen on the payment row.
create function public.pay_sandbox(p_cost_id text) returns public.payments
language plpgsql security definer set search_path = ''
as $$
declare
  v_me text := public.current_person_id();
  v_cost public.shared_costs;
  v_fixed_sum numeric;
  v_rest integer;
  v_mine numeric;
  v_amount numeric;
  v_row public.payments;
begin
  select * into v_cost from public.shared_costs c where c.id = p_cost_id for update;
  if not found or v_cost.workspace_id is distinct from public.current_workspace_id() then
    raise exception 'Cost not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.shared_cost_members m where m.cost_id = p_cost_id and m.person_id = v_me) then
    raise exception 'Opt in to this cost before paying' using errcode = '22023';
  end if;
  if public.has_paid(p_cost_id, v_me) then
    raise exception 'Already paid' using errcode = '22023';
  end if;

  with shares as (
    select m.person_id, coalesce(p.amount, o.amount) as fixed
    from public.shared_cost_members m
    left join public.payments p on p.cost_id = m.cost_id and p.person_id = m.person_id
    left join public.cost_overrides o on o.cost_id = m.cost_id and o.person_id = m.person_id
    where m.cost_id = p_cost_id
  )
  select coalesce(sum(fixed), 0),
         count(*) filter (where fixed is null),
         max(fixed) filter (where person_id = v_me)
    into v_fixed_sum, v_rest, v_mine
  from shares;

  v_amount := coalesce(v_mine,
                       case when v_rest > 0 then round((v_cost.total - v_fixed_sum) / v_rest, 2) else 0 end);

  insert into public.payments (cost_id, person_id, paid_at, ref, amount, cost_name)
  values (p_cost_id, v_me, now(), 'sandbox-' || substr(md5(random()::text), 1, 8), v_amount, v_cost.name)
  returning * into v_row;
  return v_row;
end;
$$;

-- Only signed-in users call the RPCs (EXECUTE is granted to PUBLIC by default,
-- which anon inherits); anyone may preview an invite.
revoke execute on function public.get_session() from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.create_dm(text) from public, anon;
revoke execute on function public.mark_conversation_read(text) from public, anon;
revoke execute on function public.unread_counts() from public, anon;
revoke execute on function public.approve_announcement(text) from public, anon;
revoke execute on function public.reject_announcement(text) from public, anon;
revoke execute on function public.pay_sandbox(text) from public, anon;
grant execute on function public.get_session() to authenticated;
grant execute on function public.accept_invite(text) to authenticated;
grant execute on function public.create_dm(text) to authenticated;
grant execute on function public.mark_conversation_read(text) to authenticated;
grant execute on function public.unread_counts() to authenticated;
grant execute on function public.approve_announcement(text) to authenticated;
grant execute on function public.reject_announcement(text) to authenticated;
grant execute on function public.pay_sandbox(text) to authenticated;
grant execute on function public.get_invite(text) to anon, authenticated;
