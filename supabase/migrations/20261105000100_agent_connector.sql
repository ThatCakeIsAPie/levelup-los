-- Agent connector, part 1: connections, pairing, audit and the database role
-- the `agent` Edge Function connects as.
--
-- A person presses a button in the app and gets a one-time pairing code
-- (`create_agent_pairing`). Their AI agent sends that code to the Edge
-- Function, which redeems it and hands the agent an opaque connection key
-- (only its SHA-256 is stored). The key means something to that one function
-- only; it is not a JWT and no other Supabase endpoint accepts it.
--
-- The function connects as the NOLOGIN-by-default role `agent_connector`
-- (the password is set per deployment, outside this repository). That role
-- owns nothing and has no table privileges. It can only:
--   1. look a connection up by key hash and touch last_used_at,
--   2. redeem a pairing code and record failed attempts,
--   3. `set role authenticated`, to run one `agent_*` tool as the person.
-- Steps 1 and 2 are SECURITY DEFINER functions in the schema `agent_private`
-- (not exposed by the Data API) executable only by that role. Step 3 is what
-- makes row-level security decide, exactly as it does for the app.
--
-- The tools themselves are in the next migration. The feature stays off until
-- the team's `feature_switches` row 'agents' is on (an app admin may use it
-- earlier as a preview, like the other switched features).

-- ---------------------------------------------------------------------------
-- The feature switch gains a value
-- ---------------------------------------------------------------------------

alter table public.feature_switches drop constraint feature_switches_feature_check;
alter table public.feature_switches add constraint feature_switches_feature_check
  check (feature in ('chats', 'library', 'campaigns', 'agents'));

-- ---------------------------------------------------------------------------
-- The role the Edge Function connects as
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agent_connector') then
    -- NOINHERIT: membership of `authenticated` only lets it `set role`, it
    -- never gets that role's privileges while it is itself.
    create role agent_connector nologin noinherit nosuperuser nocreatedb nocreaterole noreplication;
  end if;
end $$;
grant authenticated to agent_connector;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.agent_pairings (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 (hex) of the normalised code; the code itself is never stored.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  access text not null check (access in ('read', 'write')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
comment on table public.agent_pairings is
  'One-time pairing codes (hashed). Created by create_agent_pairing(), redeemed once by the agent Edge Function. No client access.';
create index agent_pairings_user_idx on public.agent_pairings (user_id) where used_at is null;

create table public.agent_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id text not null references public.people (id) on delete cascade,
  workspace_id text not null references public.workspaces (id) on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  -- SHA-256 (hex) of the connection key; the key itself is never stored and
  -- the column is not granted to any API role.
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  access text not null check (access in ('read', 'write')),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
comment on table public.agent_connections is
  'An AI agent connected for one person. The person reads their own rows (never key_hash) and revokes through revoke_agent_connection().';
create index agent_connections_user_idx on public.agent_connections (user_id);

create table public.agent_audit (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.agent_connections (id) on delete cascade,
  person_id text not null,
  workspace_id text not null,
  tool text not null,
  arguments jsonb,
  result text,
  old_values jsonb,
  new_values jsonb,
  at timestamptz not null default now()
);
comment on table public.agent_audit is
  'One row per agent call (also refused ones). Holds details of the people the agent touched, so only the connected person reads it.';
create index agent_audit_person_idx on public.agent_audit (person_id, at desc);
create index agent_audit_connection_idx on public.agent_audit (connection_id, at desc);
create index agent_audit_at_idx on public.agent_audit (at);

-- Failed pairing attempts per (hashed) address, for throttling.
create table public.agent_pair_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  at timestamptz not null default now()
);
comment on table public.agent_pair_attempts is
  'Failed /pair attempts by hashed address (throttle). Written and read only by agent_private functions.';
create index agent_pair_attempts_idx on public.agent_pair_attempts (ip_hash, at);

alter table public.agent_pairings enable row level security;
alter table public.agent_connections enable row level security;
alter table public.agent_audit enable row level security;
alter table public.agent_pair_attempts enable row level security;

-- Supabase hands new public tables (and their sequences) to the API roles by
-- default. Take all of it back, then grant narrowly.
revoke all on public.agent_pairings, public.agent_connections, public.agent_audit, public.agent_pair_attempts
  from public, anon, authenticated, service_role;
revoke all on sequence public.agent_audit_id_seq, public.agent_pair_attempts_id_seq
  from public, anon, authenticated, service_role;

-- A person reads their own connections, never the key hash (a column grant:
-- the app must name the columns, `select *` is refused), and their own audit
-- rows. Nothing is client-writable: connections are made by the Edge
-- Function's redeem function and revoked by revoke_agent_connection().
grant select (id, user_id, person_id, workspace_id, label, access, created_at, last_used_at, revoked_at)
  on public.agent_connections to authenticated;
grant select on public.agent_audit to authenticated;

create policy "read your own agent connections" on public.agent_connections
  for select to authenticated
  using (user_id = (select auth.uid())
         and person_id = (select public.current_person_id())
         and workspace_id = (select public.current_workspace_id()));

create policy "read your own agent audit rows" on public.agent_audit
  for select to authenticated
  using (person_id = (select public.current_person_id())
         and workspace_id = (select public.current_workspace_id()));

-- agent_pairings and agent_pair_attempts: RLS on, no policy, no grant. Only the
-- definer functions below reach them.

-- ---------------------------------------------------------------------------
-- Private schema (not exposed by the Data API)
-- ---------------------------------------------------------------------------

create schema agent_private;
revoke all on schema agent_private from public, anon;
grant usage on schema agent_private to authenticated, agent_connector;

-- Was this session opened by the connector role? session_user is the login
-- role: it survives `set role` and security definer, and an ordinary app
-- session (PostgREST logs in as another role) never has it. Every connector
-- function and the guard ask here, so there is one place to look.
create function agent_private.via_connector() returns boolean
language sql
stable
set search_path = ''
as $$ select session_user = 'agent_connector' $$;
revoke all on function agent_private.via_connector() from public, anon, authenticated, service_role;

-- May this login use the connector right now? Used by pairing, redemption and
-- every tool call. Takes the login explicitly (not auth.uid()) so the
-- redemption, which runs before any role switch, can use it too. Reasons:
--   no_person       the login is not attached to a person record
--   not_registered  not an apprentice or IBO, and not the team's leader/deputy
--   switched_off    the team has not switched agents on (an app admin may
--                   still use it: the preview rule of every switched feature)
create function agent_private.access_for(p_uid uuid)
returns table (person_id text, workspace_id text, allowed boolean, reason text, switch_on boolean, preview boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person text;
  v_ws text;
  v_registered boolean;
begin
  select m.person_id, m.workspace_id into v_person, v_ws
    from public.members m
   where m.user_id = p_uid
   order by m.joined_at, m.workspace_id
   limit 1;

  person_id := v_person;
  workspace_id := v_ws;
  switch_on := false;
  preview := false;
  allowed := false;

  if v_person is null then
    reason := 'no_person';
    return next;
    return;
  end if;

  select exists (
           select 1
             from public.people p
             join public.members m on m.person_id = p.id and m.workspace_id = v_ws
            where p.id = v_person
              and p.workspace_id = v_ws
              and (m.role = 'leader'
                   or public.effective_biz_class(p.biz_class, p.business_start_date) in ('apprentice', 'ibo')
                   or exists (select 1 from public.deputies d
                               join public.members l on l.person_id = d.leader_id
                                                    and l.workspace_id = d.workspace_id and l.role = 'leader'
                              where d.deputy_id = p.id and d.workspace_id = v_ws)))
    into v_registered;
  if not v_registered then
    reason := 'not_registered';
    return next;
    return;
  end if;

  switch_on := exists (select 1 from public.feature_switches f
                        where f.workspace_id = v_ws and f.feature = 'agents' and f.enabled);
  preview := exists (select 1 from public.app_admins a where a.user_id = p_uid);
  allowed := switch_on or preview;
  reason := case when allowed then null else 'switched_off' end;
  return next;
end
$$;
revoke all on function agent_private.access_for(uuid) from public, anon, authenticated, service_role;

create function agent_private.access_message(p_reason text) returns text
language sql
immutable
set search_path = ''
as $$
  select case p_reason
    when 'no_person' then 'This login is not attached to a person record in a team'
    when 'not_registered' then 'Only registered team members (apprentices and IBOs) and the team''s leader can use an agent'
    when 'switched_off' then 'Agents are not switched on for this team'
    else 'Agents are not available for this login'
  end
$$;
revoke all on function agent_private.access_message(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- For the signed-in app
-- ---------------------------------------------------------------------------

-- Whether the caller may add an agent (for the Settings card).
create function public.my_agent_access() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a record;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  select * into a from agent_private.access_for(auth.uid());
  return jsonb_build_object(
    'allowed', coalesce(a.allowed, false),
    'reason', a.reason,
    'message', case when a.allowed then null else agent_private.access_message(a.reason) end,
    'switch_on', coalesce(a.switch_on, false),
    'preview', coalesce(a.preview and not a.switch_on, false));
end
$$;

-- A one-time pairing code for the caller: 10 minutes, single use.
create function public.create_agent_pairing(p_access text default 'write') returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  a record;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 symbols, no I, O, 0 or 1
  v_bytes bytea;
  v_code text := '';
  v_expires timestamptz := now() + interval '10 minutes';
  i int;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_access is null or p_access not in ('read', 'write') then
    raise exception 'access must be read or write' using errcode = '22023';
  end if;
  select * into a from agent_private.access_for(v_uid);
  if not coalesce(a.allowed, false) then
    raise exception '%', agent_private.access_message(a.reason) using errcode = '42501';
  end if;
  if (select count(*) from public.agent_pairings
       where user_id = v_uid and used_at is null and expires_at > now()) >= 5 then
    raise exception 'Too many unused pairing codes: use them or wait for them to expire' using errcode = '54000';
  end if;
  if (select count(*) from public.agent_connections
       where user_id = v_uid and revoked_at is null) >= 10 then
    raise exception 'Too many connected agents: disconnect one first' using errcode = '54000';
  end if;

  v_bytes := extensions.gen_random_bytes(16);  -- 16 symbols x 5 bits = 80 bits
  for i in 0..15 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) & 31) + 1, 1);
  end loop;

  insert into public.agent_pairings (code_hash, user_id, person_id, workspace_id, access, expires_at)
  values (encode(sha256(convert_to(v_code, 'utf8')), 'hex'), v_uid, a.person_id, a.workspace_id, p_access, v_expires);

  return jsonb_build_object(
    'code', substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4),
    'expires_at', v_expires,
    'access', p_access);
end
$$;

-- Disconnect one of the caller's agents. Always allowed for your own
-- connection (also while the team switch is off); no delete, the row stays.
create function public.revoke_agent_connection(p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  update public.agent_connections c set revoked_at = now()
   where c.id = p_id and c.user_id = auth.uid() and c.revoked_at is null
  returning c.revoked_at into v_at;
  if v_at is null then
    raise exception 'No such connection' using errcode = 'PT404'; -- PostgREST answers 404
  end if;
  return jsonb_build_object('revoked_at', v_at);
end
$$;

revoke all on function public.my_agent_access(), public.create_agent_pairing(text), public.revoke_agent_connection(uuid)
  from public, anon, service_role;
grant execute on function public.my_agent_access(), public.create_agent_pairing(text), public.revoke_agent_connection(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- For the Edge Function (agent_connector only)
-- ---------------------------------------------------------------------------

-- Key hash -> the live connection, and touch last_used_at (at most once a minute).
create function agent_private.connector_lookup(p_key_hash text)
returns table (id uuid, user_id uuid, person_id text, workspace_id text, workspace_name text, label text, access text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not agent_private.via_connector() then
    raise exception 'only the connector role may call this' using errcode = '42501';
  end if;
  update public.agent_connections c set last_used_at = now()
   where c.key_hash = p_key_hash and c.revoked_at is null
     and (c.last_used_at is null or c.last_used_at < now() - interval '1 minute');
  return query
    select c.id, c.user_id, c.person_id, c.workspace_id, w.name, c.label, c.access
      from public.agent_connections c
      join public.workspaces w on w.id = c.workspace_id
     where c.key_hash = p_key_hash and c.revoked_at is null;
end
$$;

-- Redeem a pairing code (by hash) and create the connection, in one
-- transaction. No rows when the code is wrong, used, expired, or its owner may
-- no longer use the connector; the caller cannot tell these apart.
create function agent_private.connector_redeem(p_code_hash text, p_key_hash text, p_label text)
returns table (connection_id uuid, access text, person_name text, workspace_name text, created_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v public.agent_pairings;
  a record;
  v_conn public.agent_connections;
begin
  if not agent_private.via_connector() then
    raise exception 'only the connector role may call this' using errcode = '42501';
  end if;
  -- Locked: of two simultaneous redemptions the second waits, then finds the
  -- row used and gets nothing.
  select * into v from public.agent_pairings p
   where p.code_hash = p_code_hash and p.used_at is null and p.expires_at > now()
   for update;
  if not found then
    return;
  end if;
  select * into a from agent_private.access_for(v.user_id);
  if not coalesce(a.allowed, false) or a.person_id is distinct from v.person_id
     or a.workspace_id is distinct from v.workspace_id then
    return;
  end if;
  update public.agent_pairings p set used_at = now() where p.id = v.id;
  insert into public.agent_connections (user_id, person_id, workspace_id, label, key_hash, access)
  values (v.user_id, v.person_id, v.workspace_id, p_label, p_key_hash, v.access)
  returning * into v_conn;
  return query
    select v_conn.id, v_conn.access,
           (select p.name from public.people p where p.id = v_conn.person_id),
           (select w.name from public.workspaces w where w.id = v_conn.workspace_id),
           v_conn.created_at;
end
$$;

-- Throttling of /pair by hashed address: 8 failures per address, 100 in all,
-- in 10 minutes.
create function agent_private.connector_pair_blocked(p_ip_hash text) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mine int;
  v_all int;
begin
  if not agent_private.via_connector() then
    raise exception 'only the connector role may call this' using errcode = '42501';
  end if;
  select count(*) filter (where t.ip_hash = p_ip_hash), count(*) into v_mine, v_all
    from public.agent_pair_attempts t where t.at > now() - interval '10 minutes';
  return v_mine >= 8 or v_all >= 100;
end
$$;

create function agent_private.connector_pair_failed(p_ip_hash text) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not agent_private.via_connector() then
    raise exception 'only the connector role may call this' using errcode = '42501';
  end if;
  if p_ip_hash is null or char_length(p_ip_hash) not between 8 and 64 then
    raise exception 'bad address hash' using errcode = '22023';
  end if;
  insert into public.agent_pair_attempts (ip_hash) values (p_ip_hash);
end
$$;

-- A tool that raises rolls back its own audit row, so the function records
-- the refusal (or failure) here, in the words it wants the person to read
-- ("refused: ...", "failed: ..."), for any connection that exists, whatever
-- its state.
create function agent_private.connector_refusal(p_conn uuid, p_tool text, p_args jsonb, p_reason text) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not agent_private.via_connector() then
    raise exception 'only the connector role may call this' using errcode = '42501';
  end if;
  insert into public.agent_audit (connection_id, person_id, workspace_id, tool, arguments, result)
  select c.id, c.person_id, c.workspace_id, left(coalesce(p_tool, '?'), 80), p_args, left(coalesce(p_reason, ''), 500)
    from public.agent_connections c where c.id = p_conn;
end
$$;

revoke all on function
  agent_private.connector_lookup(text), agent_private.connector_redeem(text, text, text),
  agent_private.connector_pair_blocked(text), agent_private.connector_pair_failed(text),
  agent_private.connector_refusal(uuid, text, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function
  agent_private.connector_lookup(text), agent_private.connector_redeem(text, text, text),
  agent_private.connector_pair_blocked(text), agent_private.connector_pair_failed(text),
  agent_private.connector_refusal(uuid, text, jsonb, text)
  to agent_connector;

-- ---------------------------------------------------------------------------
-- The guard every agent_* tool starts with
-- ---------------------------------------------------------------------------

-- The Edge Function opens a transaction as agent_connector, sets
-- app.agent_connection_id and request.jwt.claims (the person's login), does
-- `set local role authenticated` and calls one tool. The database re-checks
-- everything itself:
--   * the session was opened by agent_connector (see via_connector()), and the
--     connection id was set,
--   * the connection is unrevoked and belongs to the acting login,
--   * it still matches that login's person and workspace,
--   * the team switch (or the app-admin preview) still allows agents, and the
--     person is still registered,
--   * the connection's access allows the tool (write tools need 'write').
-- So switching the team off, revoking or demoting someone cuts an agent off on
-- its very next call.
create function agent_private.ctx(p_write boolean)
returns table (connection_id uuid, person_id text, workspace_id text, access text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  c public.agent_connections;
  a record;
begin
  if not agent_private.via_connector() then
    raise exception 'agent functions can only be called through the connector' using errcode = '42501';
  end if;
  begin
    v_id := nullif(current_setting('app.agent_connection_id', true), '')::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is null then
    raise exception 'agent functions can only be called through the connector' using errcode = '42501';
  end if;
  select * into c from public.agent_connections k
   where k.id = v_id and k.user_id = auth.uid() and k.revoked_at is null;
  if not found then
    raise exception 'agent connection is not active' using errcode = '28000';
  end if;
  select * into a from agent_private.access_for(auth.uid());
  if a.person_id is distinct from c.person_id or a.workspace_id is distinct from c.workspace_id then
    raise exception 'agent connection no longer matches this login''s person' using errcode = '42501';
  end if;
  if not coalesce(a.allowed, false) then
    raise exception '%', agent_private.access_message(a.reason) using errcode = '42501';
  end if;
  if p_write and c.access <> 'write' then
    raise exception 'this connection is read-only' using errcode = '42501';
  end if;
  connection_id := c.id;
  person_id := c.person_id;
  workspace_id := c.workspace_id;
  access := c.access;
  return next;
end
$$;

-- One audit row for the call in progress. Only for the connection the
-- transaction was opened for, and only for its own login.
create function agent_private.audit(
  p_conn uuid, p_tool text, p_args jsonb, p_result text,
  p_old jsonb default null, p_new jsonb default null) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not agent_private.via_connector()
     or p_conn is distinct from nullif(current_setting('app.agent_connection_id', true), '')::uuid then
    raise exception 'audit refused' using errcode = '42501';
  end if;
  insert into public.agent_audit (connection_id, person_id, workspace_id, tool, arguments, result, old_values, new_values)
  select c.id, c.person_id, c.workspace_id, p_tool, p_args, left(p_result, 500), p_old, p_new
    from public.agent_connections c
   where c.id = p_conn and c.user_id = auth.uid();
  if not found then
    raise exception 'audit refused' using errcode = '42501';
  end if;
end
$$;

revoke all on function agent_private.ctx(boolean), agent_private.audit(uuid, text, jsonb, text, jsonb, jsonb)
  from public, anon, service_role;
grant execute on function agent_private.ctx(boolean), agent_private.audit(uuid, text, jsonb, text, jsonb, jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Housekeeping: used or expired pairings and old attempts go after a day,
-- audit rows after 180 days.
-- ---------------------------------------------------------------------------

create function public.purge_agent_housekeeping() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pairings int;
  v_attempts int;
  v_audit int;
begin
  delete from public.agent_pairings p
   where coalesce(p.used_at, p.expires_at) < now() - interval '1 day';
  get diagnostics v_pairings = row_count;
  delete from public.agent_pair_attempts t where t.at < now() - interval '1 day';
  get diagnostics v_attempts = row_count;
  delete from public.agent_audit x where x.at < now() - interval '180 days';
  get diagnostics v_audit = row_count;
  return jsonb_build_object('pairings', v_pairings, 'attempts', v_attempts, 'audit', v_audit);
end
$$;
revoke execute on function public.purge_agent_housekeeping() from public, anon, authenticated;
grant execute on function public.purge_agent_housekeeping() to service_role;

-- Nightly with pg_cron when the extension is available (as the chat retention).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('purge-agent-housekeeping', '37 3 * * *', 'select public.purge_agent_housekeeping()');
  else
    raise notice 'pg_cron not available: call public.purge_agent_housekeeping() from a scheduler instead';
  end if;
end;
$$;
