-- Helper functions used by row-level security, RPCs and triggers.
-- All are STABLE; the ones that read other people's rows are SECURITY DEFINER
-- (owned by postgres, which bypasses RLS) so policies never recurse. Functions
-- that take arbitrary person ids only answer about pairs that include the
-- caller when called by a signed-in user, so they can't be used to probe
-- other people's memberships or blocks.

-- ---------------------------------------------------------------------------
-- Business stage
-- ---------------------------------------------------------------------------

-- Mirror of effectiveBizClass (src/stores/peopleStore.ts): an apprentice whose
-- first contract year has elapsed is treated as an IBO.
create function public.effective_biz_class(p_biz_class text, p_business_start_date date)
returns text
language sql stable set search_path = ''
as $$
  select case
    when p_biz_class = 'apprentice' and p_business_start_date is not null
      and (p_business_start_date + interval '1 year')::date <= current_date
    then 'ibo'
    else p_biz_class
  end
$$;

-- "Today" in a workspace's own time zone.
create function public.workspace_today(p_workspace_id text) returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone coalesce(
    (select w.timezone from public.workspaces w where w.id = p_workspace_id), 'UTC'))::date
$$;

-- Chat eligibility: a workspace member whose effective stage is apprentice or
-- IBO, or a workspace leader. Prospects, customers and candidates: no chat.
create function public.chat_eligible(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.people p on p.id = m.person_id
    where m.person_id = p_person_id
      and (m.role = 'leader'
        or public.effective_biz_class(p.biz_class, p.business_start_date) in ('apprentice', 'ibo'))
  )
$$;

-- access.ts "candidate": a signed-in member without a team (not a leader, not
-- an apprentice/IBO). Candidates only ever see themselves.
create function public.is_candidate() returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.current_person_id() is not null
     and not public.chat_eligible(public.current_person_id())
$$;

-- ---------------------------------------------------------------------------
-- Business visibility (mirror of src/data/access.ts visibleIdSet)
--   leaders, IBOs, apprentices: themselves + business downline (walks
--   sponsor_id, never through customers) + ONLY the customers they own.
--   candidates: only themselves. Nobody signed in: nothing.
-- ---------------------------------------------------------------------------

create function public.visible_person_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  with recursive me as (
    select m.person_id, m.workspace_id, public.chat_eligible(m.person_id) as has_team
    from public.members m
    where m.user_id = auth.uid()
    order by m.joined_at, m.workspace_id
    limit 1
  ),
  team (id) as (
    select me.person_id from me where me.has_team
    union
    select c.id
    from public.people c
    join team t on c.sponsor_id = t.id
    where c.biz_class <> 'customer'
      and c.workspace_id = (select me.workspace_id from me)
  )
  select me.person_id from me where not me.has_team
  union
  select team.id from team
  union
  select c.id
  from public.people c, me
  where me.has_team
    and c.biz_class = 'customer'
    and c.owner_id = me.person_id
    and c.workspace_id = me.workspace_id
$$;

create function public.can_see_person(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_person_id in (select public.visible_person_ids()) $$;

-- Business downline of a person (including them), any viewer. Used for
-- re-sponsoring checks (no cycles).
create function public.downline_ids(p_root text) returns setof text
language sql stable security definer set search_path = ''
as $$
  with recursive team (id) as (
    select p_root
    union
    select c.id from public.people c join team t on c.sponsor_id = t.id
    where c.biz_class <> 'customer'
  )
  select id from team
$$;

create function public.person_workspace(p_person_id text) returns text
language sql stable security definer set search_path = ''
as $$ select p.workspace_id from public.people p where p.id = p_person_id $$;

-- ---------------------------------------------------------------------------
-- Conversations
-- ---------------------------------------------------------------------------

-- Conversations the caller belongs to (empty unless they are chat eligible).
create function public.my_conversation_ids() returns setof text
language sql stable security definer set search_path = ''
as $$
  select cm.conversation_id
  from public.conversation_members cm
  where cm.person_id = public.current_person_id()
    and public.chat_eligible(cm.person_id)
$$;

create function public.is_conversation_member(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_conversation_id in (select public.my_conversation_ids()) $$;

-- The caller's role in a conversation (null if not a member).
create function public.conversation_role(p_conversation_id text) returns text
language sql stable security definer set search_path = ''
as $$
  select cm.role from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.person_id = public.current_person_id()
    and public.chat_eligible(cm.person_id)
$$;

create function public.conversation_kind(p_conversation_id text) returns text
language sql stable security definer set search_path = ''
as $$ select c.kind from public.conversations c where c.id = p_conversation_id $$;

create function public.conversation_workspace(p_conversation_id text) returns text
language sql stable security definer set search_path = ''
as $$ select c.workspace_id from public.conversations c where c.id = p_conversation_id $$;

-- Team chats: announcements, main, and the pinned team groups.
create function public.is_team_chat(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select c.kind in ('announcements', 'main') or (c.kind = 'group' and c.pinned)
                   from public.conversations c where c.id = p_conversation_id), false)
$$;

-- May the caller remove other people's messages here? Conversation admins and
-- moderators, plus workspace moderators/leaders, in any chat they belong to
-- except DMs (nobody moderates a DM they are in; nobody else can see it).
create function public.can_moderate_conversation(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.is_conversation_member(p_conversation_id)
     and public.conversation_kind(p_conversation_id) <> 'dm'
     and (public.conversation_role(p_conversation_id) in ('admin', 'moderator')
          or public.is_moderator_or_leader())
$$;

create function public.message_conversation_id(p_message_id text) returns text
language sql stable security definer set search_path = ''
as $$ select m.conversation_id from public.messages m where m.id = p_message_id $$;

create function public.message_author_id(p_message_id text) returns text
language sql stable security definer set search_path = ''
as $$ select m.author_id from public.messages m where m.id = p_message_id $$;

-- ---------------------------------------------------------------------------
-- DM rules
-- ---------------------------------------------------------------------------

-- Signed-in callers may only ask about pairs that include themselves (with no
-- signed-in user, e.g. the seed or a service job, any pair may be asked).
create function public.pair_includes_caller(a text, b text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() is null
      or public.current_person_id() in (a, b)
$$;

create function public.is_blocked_between(a text, b text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.pair_includes_caller(a, b) and exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = a and bl.blocked_id = b)
       or (bl.blocker_id = b and bl.blocked_id = a)
  )
$$;

create function public.shares_conversation(a text, b text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select a <> b and public.pair_includes_caller(a, b) and exists (
    select 1
    from public.conversation_members x
    join public.conversation_members y on y.conversation_id = x.conversation_id
    where x.person_id = a and y.person_id = b
  )
$$;

-- Both eligible, same workspace, share a conversation, no block either way.
create function public.can_dm(a text, b text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select a is not null and b is not null and a <> b
     and public.pair_includes_caller(a, b)
     and public.chat_eligible(a) and public.chat_eligible(b)
     and public.person_workspace(a) = public.person_workspace(b)
     and public.shares_conversation(a, b)
     and not public.is_blocked_between(a, b)
$$;

-- The other participant of a DM, seen from the caller.
create function public.dm_other_person(p_conversation_id text) returns text
language sql stable security definer set search_path = ''
as $$
  select cm.person_id from public.conversation_members cm
  where cm.conversation_id = p_conversation_id
    and cm.person_id <> public.current_person_id()
  limit 1
$$;

-- May the caller post in this conversation's DM? (no block either way)
create function public.dm_open(p_conversation_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.conversation_kind(p_conversation_id) <> 'dm'
      or not public.is_blocked_between(public.current_person_id(), public.dm_other_person(p_conversation_id))
$$;
