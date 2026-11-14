-- Agent connector, part 3a: people and personal tools (plan: docs/plans/agent-connector-2026-11-14.md).
--
-- New tools (each one `agent_*` function here, one entry in supabase/functions/agent/tools.ts, tests in
-- pgTAP 047-049 and the vitest files):
--   list_team         the caller's registered downline, with levels and sponsors
--   list_customers    the caller's customers
--   get_person        one person the caller can see
--   update_my_profile the caller's own full_name, phone, email, location
--   log_learning      one learning entry for the caller
--   list_learning     the caller's own entries in a window, with totals per kind
-- Changed tools: list_prospects (search, offset, total, sponsor name, vCard field names, a note when empty;
-- the old one-argument signature is dropped) and whoami (`can`, `team_size`).
--
-- Every tool is SECURITY INVOKER and starts with agent_private.ctx(), like the first seven: they run as the
-- person, so row-level security decides what they see and change. Contact fields use the names of vCard
-- (RFC 6350): full_name (FN), phone (TEL), email (EMAIL), location (ADR locality and region as one text),
-- notes (NOTE). Never read or written by any tool here: IBO#, LTD#. Never written: stage, sponsor, owner,
-- business start date, pipeline stage, stage history, tags, monthly volume. No deletes.

-- ---------------------------------------------------------------------------
-- The caller's registered downline
-- ---------------------------------------------------------------------------

-- Everyone below p_me on the sponsor line whose effective stage is apprentice or IBO: their contact fields,
-- their sponsor and how many steps below p_me they are (1 = sponsored by p_me). It reads public.people as the
-- caller, so a person the caller cannot see (row-level security) is not in it and is not walked through; for
-- a person's own downline that is nobody, since the caller sees their whole downline. Customers have no
-- sponsor and are never on the line. ONE recursive query, however big the team, with the columns carried
-- along so nothing is joined back afterwards (the depth guard only stops corrupt cyclic data).
create function agent_private.team(p_me text)
returns table (id text, level integer, name text, stage text, sponsor_id text, phone text, email text,
               location text, business_start_date date)
language sql
stable
security invoker
set search_path = ''
as $$
  with recursive down (id, level, name, biz_class, business_start_date, sponsor_id, phone, email, location) as (
    select p.id, 1, p.name, p.biz_class, p.business_start_date, p.sponsor_id, p.phone, p.email, p.location
      from public.people p
     where p.sponsor_id = p_me and p.biz_class <> 'customer' and p.id <> p_me
    union all
    select p.id, d.level + 1, p.name, p.biz_class, p.business_start_date, p.sponsor_id, p.phone, p.email, p.location
      from public.people p
      join down d on p.sponsor_id = d.id
     where p.biz_class <> 'customer' and p.id <> p_me and d.level < 100
  )
  select d.id, d.level, d.name, public.effective_biz_class(d.biz_class, d.business_start_date), d.sponsor_id,
         d.phone, d.email, d.location, d.business_start_date
    from down d
   where public.effective_biz_class(d.biz_class, d.business_start_date) in ('apprentice', 'ibo')
$$;

-- Text for an `ilike` that matches the search as plain text (no % or _ wildcards of its own).
create function agent_private.like_pattern(p_search text) returns text
language sql
immutable
set search_path = ''
as $$
  select '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%'
$$;

-- ---------------------------------------------------------------------------
-- whoami: what this connection can call, and how big the team is
-- ---------------------------------------------------------------------------

create or replace function public.agent_whoami() returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_out jsonb;
  v_read constant text[] := array['whoami', 'list_prospects', 'list_team', 'list_customers', 'get_person',
                                  'list_upcoming_events', 'export_events_ics', 'list_learning'];
  v_write constant text[] := array['add_prospect', 'update_prospect', 'update_my_profile', 'log_learning',
                                   'set_event_answer'];
begin
  select * into c from agent_private.ctx(false);
  select jsonb_build_object(
           'person', jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'stage', public.effective_biz_class(p.biz_class, p.business_start_date)),
           'team_role', (select m.role from public.members m
                          where m.user_id = auth.uid() and m.person_id = c.person_id limit 1),
           'team', (select w.name from public.workspaces w where w.id = c.workspace_id),
           'today', public.workspace_today(c.workspace_id),
           'access', c.access,
           'can', to_jsonb(case when c.access = 'write' then v_read || v_write else v_read end),
           'team_size', (select count(*)::int from agent_private.team(c.person_id)))
    into v_out
    from public.people p where p.id = c.person_id;
  perform agent_private.audit(c.connection_id, 'whoami', '{}'::jsonb, 'ok');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- list_team
-- ---------------------------------------------------------------------------

-- The caller's DOWNLINE: registered people (effective stage apprentice or IBO) below them that they can see,
-- never the caller. Per person: id, full_name, stage (apprentice or ibo, the effective one), sponsor_id,
-- sponsor_name (null when the caller cannot see the sponsor), level (1 = sponsored by the caller, 2 = their
-- downline, ...), phone, email, location, business_start_date. Ordered by level, then name.
-- Result: {total, limit, offset, team, note?}.
create function public.agent_list_team(
  p_search text default null, p_limit int default 50, p_offset int default 0) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_args jsonb := jsonb_build_object('search', p_search, 'limit', v_limit, 'offset', v_offset);
  v_res jsonb;
  v_total int;
  v_all int;
  v_note text;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  if char_length(coalesce(p_search, '')) > 100 then
    perform agent_private.audit(c.connection_id, 'list_team', v_args, 'refused: search is too long');
    return jsonb_build_object('error', 'search must be at most 100 characters.');
  end if;
  with t as (
    select d.id, d.name, d.stage, d.sponsor_id, d.phone, d.email, d.location, d.business_start_date, d.level
      from agent_private.team(c.person_id) d
  ), hits as (
    select * from t where v_search is null or t.name ilike agent_private.like_pattern(v_search)
  ), page as (
    select * from hits order by level, lower(name), name, id limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'total', (select count(*) from hits),
           'all', (select count(*) from t),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.id, 'full_name', g.name, 'stage', g.stage,
                      'sponsor_id', s.id, 'sponsor_name', s.name, 'level', g.level,
                      'phone', g.phone, 'email', g.email, 'location', g.location,
                      'business_start_date', g.business_start_date)
                    order by g.level, lower(g.name), g.name, g.id)
               from page g left join public.people s on s.id = g.sponsor_id), '[]'::jsonb))
    into v_res;
  v_total := (v_res ->> 'total')::int;
  v_all := (v_res ->> 'all')::int;
  v_note := case
    when v_all = 0 then 'You have no registered team members under you yet.'
    when v_total = 0 then 'No team member matches that search.'
    when jsonb_array_length(v_res -> 'rows') = 0 then 'offset is past the last team member (total ' || v_total || ').'
  end;
  v_out := jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'team', v_res -> 'rows')
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  perform agent_private.audit(c.connection_id, 'list_team', v_args,
                              jsonb_array_length(v_res -> 'rows') || ' of ' || v_total || ' rows');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- list_prospects (replaced: search, offset, total, sponsor, vCard names, a note when empty)
-- ---------------------------------------------------------------------------

drop function public.agent_list_prospects(int);

-- The prospects (people not registered yet) the caller can see: their own and their downline's. Per
-- prospect: id, full_name, phone, email, location, notes, sponsor_id and sponsor_name (whose prospect it is).
-- Ordered by name. Result: {total, limit, offset, prospects, note?}.
create function public.agent_list_prospects(
  p_limit int default 50, p_search text default null, p_offset int default 0) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_args jsonb := jsonb_build_object('limit', v_limit, 'search', p_search, 'offset', v_offset);
  v_res jsonb;
  v_total int;
  v_all int;
  v_note text;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  if char_length(coalesce(p_search, '')) > 100 then
    perform agent_private.audit(c.connection_id, 'list_prospects', v_args, 'refused: search is too long');
    return jsonb_build_object('error', 'search must be at most 100 characters.');
  end if;
  with t as (
    select p.id, p.name, p.phone, p.email, p.location, p.notes, p.sponsor_id
      from public.people p where p.biz_class = 'prospect'
  ), hits as (
    select * from t where v_search is null or t.name ilike agent_private.like_pattern(v_search)
  ), page as (
    select * from hits order by lower(name), name, id limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'total', (select count(*) from hits),
           'all', (select count(*) from t),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.id, 'full_name', g.name, 'phone', g.phone, 'email', g.email,
                      'location', g.location, 'notes', g.notes,
                      'sponsor_id', s.id, 'sponsor_name', s.name)
                    order by lower(g.name), g.name, g.id)
               from page g left join public.people s on s.id = g.sponsor_id), '[]'::jsonb))
    into v_res;
  v_total := (v_res ->> 'total')::int;
  v_all := (v_res ->> 'all')::int;
  v_note := case
    when v_all = 0 then 'No prospects yet. Use add_prospect to add one; registered team members are in list_team.'
    when v_total = 0 then 'No prospect matches that search.'
    when jsonb_array_length(v_res -> 'rows') = 0 then 'offset is past the last prospect (total ' || v_total || ').'
  end;
  v_out := jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'prospects', v_res -> 'rows')
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  perform agent_private.audit(c.connection_id, 'list_prospects', v_args,
                              jsonb_array_length(v_res -> 'rows') || ' of ' || v_total || ' rows');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- list_customers
-- ---------------------------------------------------------------------------

-- The customers the caller can see. Customers are private to their owner (the app and the database show a
-- person only their own, a leader's included), so that is the caller's own customers; mine_only = false
-- asks for "every customer I can see", which is the same list today and stays right if that ever changes.
-- Per customer: id, full_name, phone, email, location, owner_id, owner_name. Ordered by name.
-- Result: {total, limit, offset, customers, note?}.
create function public.agent_list_customers(
  p_mine_only boolean default true, p_search text default null, p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_mine boolean := coalesce(p_mine_only, true);
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_args jsonb := jsonb_build_object('mine_only', v_mine, 'search', p_search, 'limit', v_limit, 'offset', v_offset);
  v_res jsonb;
  v_total int;
  v_all int;
  v_note text;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  if char_length(coalesce(p_search, '')) > 100 then
    perform agent_private.audit(c.connection_id, 'list_customers', v_args, 'refused: search is too long');
    return jsonb_build_object('error', 'search must be at most 100 characters.');
  end if;
  with t as (
    select p.id, p.name, p.phone, p.email, p.location, p.owner_id
      from public.people p
     where p.biz_class = 'customer' and (not v_mine or p.owner_id = c.person_id)
  ), hits as (
    select * from t where v_search is null or t.name ilike agent_private.like_pattern(v_search)
  ), page as (
    select * from hits order by lower(name), name, id limit v_limit offset v_offset
  )
  select jsonb_build_object(
           'total', (select count(*) from hits),
           'all', (select count(*) from t),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', g.id, 'full_name', g.name, 'phone', g.phone, 'email', g.email,
                      'location', g.location, 'owner_id', o.id, 'owner_name', o.name)
                    order by lower(g.name), g.name, g.id)
               from page g left join public.people o on o.id = g.owner_id), '[]'::jsonb))
    into v_res;
  v_total := (v_res ->> 'total')::int;
  v_all := (v_res ->> 'all')::int;
  v_note := case
    when v_all = 0 then 'No customers yet.'
    when v_total = 0 then 'No customer matches that search.'
    when jsonb_array_length(v_res -> 'rows') = 0 then 'offset is past the last customer (total ' || v_total || ').'
  end;
  v_out := jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset, 'customers', v_res -> 'rows')
           || case when v_note is null then '{}'::jsonb else jsonb_build_object('note', v_note) end;
  perform agent_private.audit(c.connection_id, 'list_customers', v_args,
                              jsonb_array_length(v_res -> 'rows') || ' of ' || v_total || ' rows');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- get_person
-- ---------------------------------------------------------------------------

-- One person the caller can see, by id. kind: self, team (registered), prospect or customer. Fields: id,
-- kind, full_name, phone, email, location, notes; for self and team also stage (effective) and
-- business_start_date; for team their level below the caller (when they are in the caller's downline);
-- sponsor {id, name} (customers: owner {id, name}), null when the caller cannot see that person. A person
-- the caller cannot see, or an id that does not exist, gives the same refusal: no hint which.
create function public.agent_get_person(p_id text) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('id', p_id);
  r record;
  v_kind text;
  v_level int;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select p.id, p.name, p.phone, p.email, p.location, p.notes, p.biz_class, p.business_start_date,
         public.effective_biz_class(p.biz_class, p.business_start_date) as stage,
         (select jsonb_build_object('id', s.id, 'name', s.name) from public.people s
           where s.id = case when p.biz_class = 'customer' then p.owner_id else p.sponsor_id end) as related
    into r
    from public.people p where p.id = p_id;
  if not found then
    perform agent_private.audit(c.connection_id, 'get_person', v_args, 'refused: no such person among the visible ones');
    return jsonb_build_object('error', 'No such person among the people you can see.');
  end if;
  v_kind := case when r.id = c.person_id then 'self' when r.biz_class = 'prospect' then 'prospect'
                 when r.biz_class = 'customer' then 'customer' else 'team' end;
  v_out := jsonb_build_object('id', r.id, 'kind', v_kind, 'full_name', r.name, 'phone', r.phone,
                              'email', r.email, 'location', r.location, 'notes', r.notes);
  if v_kind in ('self', 'team') then
    v_out := v_out || jsonb_build_object('stage', r.stage, 'business_start_date', r.business_start_date);
  end if;
  if v_kind = 'team' then
    select t.level into v_level from agent_private.team(c.person_id) t where t.id = r.id;
    if v_level is not null then
      v_out := v_out || jsonb_build_object('level', v_level);
    end if;
  end if;
  v_out := v_out || jsonb_build_object(case when v_kind = 'customer' then 'owner' else 'sponsor' end, r.related);
  -- The person looked up, recorded where add_prospect records its person (new_values), so the app's activity
  -- list can show the name.
  perform agent_private.audit(c.connection_id, 'get_person', v_args, 'viewed ' || v_kind, null,
                              jsonb_build_object('id', r.id, 'name', r.name));
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- update_my_profile
-- ---------------------------------------------------------------------------

-- The caller's OWN record: full_name, phone, email, location. Anything else in the patch is refused, naming
-- the field, and nothing changes. The e-mail is contact information and does not change the sign-in address.
create function public.agent_update_my_profile(p_patch jsonb) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('patch', p_patch);
  v_key text;
  v_bad text;
  v_max int;
  v_old jsonb;
  v_new jsonb;
  v_allowed constant text[] := array['full_name', 'phone', 'email', 'location'];
begin
  select * into c from agent_private.ctx(true);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    perform agent_private.audit(c.connection_id, 'update_my_profile', v_args, 'refused: empty patch');
    return jsonb_build_object('error', 'Nothing to change: give at least one of full_name, phone, email, location.');
  end if;
  select string_agg('"' || left(k, 40) || '"', ', ' order by k) into v_bad
    from jsonb_object_keys(p_patch) k where not (k = any (v_allowed));
  if v_bad is not null then
    perform agent_private.audit(c.connection_id, 'update_my_profile', v_args,
                                left('refused: field ' || v_bad || ' is not allowed', 500));
    return jsonb_build_object('error',
      'Only full_name, phone, email and location can be changed here; ' || v_bad || ' cannot. Nothing was changed.');
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    v_max := case v_key when 'full_name' then 120 when 'phone' then 40 else 200 end;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null')
       or (v_key = 'full_name' and (jsonb_typeof(p_patch -> 'full_name') <> 'string' or btrim(p_patch ->> 'full_name') = ''))
       or char_length(coalesce(p_patch ->> v_key, '')) > v_max then
      perform agent_private.audit(c.connection_id, 'update_my_profile', v_args, 'refused: bad value for ' || v_key);
      return jsonb_build_object('error',
        '"' || v_key || '" must be text of at most ' || v_max || ' characters or null (full_name cannot be empty or null). Nothing was changed.');
    end if;
  end loop;

  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email, 'location', p.location)
    into v_old from public.people p where p.id = c.person_id;
  if v_old is null then
    perform agent_private.audit(c.connection_id, 'update_my_profile', v_args, 'refused: own record not found');
    return jsonb_build_object('error', 'Your record could not be found. Nothing was changed.');
  end if;
  update public.people p set
    name = case when p_patch ? 'full_name' then btrim(p_patch ->> 'full_name') else p.name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else p.phone end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else p.email end,
    location = case when p_patch ? 'location' then nullif(btrim(p_patch ->> 'location'), '') else p.location end,
    last_updated_at = now()
   where p.id = c.person_id
  returning jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email, 'location', p.location)
    into v_new;
  if v_new is null then
    perform agent_private.audit(c.connection_id, 'update_my_profile', v_args, 'refused: not allowed to change that record');
    return jsonb_build_object('error', 'You are not allowed to change that record. Nothing was changed.');
  end if;
  perform agent_private.audit(c.connection_id, 'update_my_profile', v_args, 'updated own profile', v_old, v_new);
  return jsonb_build_object('id', v_new ->> 'id', 'full_name', v_new ->> 'name', 'phone', v_new ->> 'phone',
                            'email', v_new ->> 'email', 'location', v_new ->> 'location');
end
$$;

-- ---------------------------------------------------------------------------
-- log_learning, list_learning
-- ---------------------------------------------------------------------------

-- One learning entry for the caller, validated the way the app's form and the table do:
--   kind    pages (reading), podcast, workshop or conference;
--   unit    reading: minutes, pages (default) or chapters; podcast: minutes or episodes (default); none for a
--           workshop or conference (the app logs those as one entry: amount is 1 or left out);
--   amount  a whole number from 1 for reading and podcasts (required there);
--   title   optional; empty is stored as 'Unnamed', as the app does;
--   date    default the team's today; not in the future; not before 2000-01-01 (the app's form has no limit,
--           the bound only catches a typo such as a year 0026).
-- Returns the stored entry: {id, kind, title, amount, unit, date, created_at}.
create function public.agent_log_learning(
  p_kind text, p_title text default null, p_amount int default null, p_unit text default null,
  p_date date default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('kind', p_kind, 'title', p_title, 'amount', p_amount, 'unit', p_unit, 'date', p_date);
  v_today date;
  v_date date;
  v_title text := coalesce(nullif(btrim(coalesce(p_title, '')), ''), 'Unnamed');
  v_unit text;
  v_amount int;
  v_id text := gen_random_uuid()::text;
  v_out jsonb;
  v_problem text;
begin
  select * into c from agent_private.ctx(true);
  v_today := public.workspace_today(c.workspace_id);
  v_date := coalesce(p_date, v_today);
  if p_kind is null or p_kind not in ('pages', 'podcast', 'workshop', 'conference') then
    v_problem := 'kind must be one of pages (reading), podcast, workshop, conference.';
  elsif char_length(coalesce(p_title, '')) > 200 then
    v_problem := 'title must be at most 200 characters.';
  elsif v_date > v_today then
    v_problem := 'date must not be in the future (the team''s today is ' || v_today || ').';
  elsif v_date < date '2000-01-01' then
    v_problem := 'date must be 2000-01-01 or later.';
  elsif p_kind in ('workshop', 'conference') then
    if p_unit is not null then
      v_problem := 'a ' || p_kind || ' takes no unit.';
    elsif p_amount is not null and p_amount <> 1 then
      v_problem := 'a ' || p_kind || ' is logged as one entry: leave amount out (or 1).';
    end if;
    v_unit := null;
    v_amount := 1;
  else
    v_unit := coalesce(p_unit, case p_kind when 'pages' then 'pages' else 'episodes' end);
    if p_kind = 'pages' and v_unit not in ('minutes', 'pages', 'chapters') then
      v_problem := 'for reading (pages) the unit must be minutes, pages or chapters.';
    elsif p_kind = 'podcast' and v_unit not in ('minutes', 'episodes') then
      v_problem := 'for a podcast the unit must be minutes or episodes.';
    elsif p_amount is null or p_amount < 1 or p_amount > 100000 then
      v_problem := 'amount is required: a whole number of ' || v_unit || ' from 1 to 100000.';
    end if;
    v_amount := p_amount;
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'log_learning', v_args, left('refused: ' || v_problem, 500));
    return jsonb_build_object('error', v_problem || ' Nothing was logged.');
  end if;
  -- A chosen id and no RETURNING, as add_prospect does.
  insert into public.learning (id, workspace_id, person_id, kind, title, amount, unit, date)
  values (v_id, c.workspace_id, c.person_id, p_kind, v_title, v_amount, v_unit, v_date);
  select jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title, 'amount', trim_scale(l.amount),
                            'unit', l.unit, 'date', l.date, 'created_at', l.created_at)
    into v_out from public.learning l where l.id = v_id;
  perform agent_private.audit(c.connection_id, 'log_learning', v_args, 'logged ' || p_kind || ' ' || v_id, null, v_out);
  return v_out;
end
$$;

-- The caller's OWN learning entries (row-level security would also show their downline's) from `from` to
-- `until`, both dates inclusive (default: the last 30 days, ending on the team's today), newest first, with
-- totals per kind and unit over the whole window (units are never added together). An entry that has no unit
-- is shown in the one the app counts it in: pages for reading, episodes for podcasts. Entries are cut at
-- 500 (`truncated`); the totals are not. Result: {from, until, truncated, entries, totals}.
create function public.agent_list_learning(p_from date default null, p_until date default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('from', p_from, 'until', p_until);
  v_today date;
  v_until date;
  v_from date;
  v_problem text;
  v_entries jsonb;
  v_more boolean;
  v_totals jsonb;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  v_today := public.workspace_today(c.workspace_id);
  v_until := coalesce(p_until, case when p_from is null or p_from <= v_today then v_today else p_from end);
  v_from := coalesce(p_from, v_until - 29);
  if v_from < date '2000-01-01' or v_until > date '2100-01-01' then
    v_problem := 'from and until must be dates between 2000-01-01 and 2100-01-01.';
  elsif v_until < v_from then
    v_problem := 'until must not be before from.';
  elsif v_until - v_from > 366 then
    v_problem := 'the window can be at most 367 days.';
  end if;
  if v_problem is not null then
    perform agent_private.audit(c.connection_id, 'list_learning', v_args, 'refused: ' || v_problem);
    return jsonb_build_object('error', v_problem);
  end if;
  select coalesce(jsonb_agg(x.j order by x.rn) filter (where x.rn <= 500), '[]'::jsonb),
         coalesce(bool_or(x.rn > 500), false)
    into v_entries, v_more
    from (select row_number() over (order by l.date desc, l.created_at desc, l.id) as rn,
                 jsonb_build_object(
                   'id', l.id, 'kind', l.kind, 'title', l.title, 'amount', trim_scale(l.amount),
                   'unit', coalesce(l.unit, case l.kind when 'pages' then 'pages' when 'podcast' then 'episodes' end),
                   'date', l.date) as j
            from public.learning l
           where l.person_id = c.person_id and l.date between v_from and v_until
           order by l.date desc, l.created_at desc, l.id
           limit 501) x;
  select coalesce(jsonb_agg(jsonb_build_object('kind', y.kind, 'unit', y.unit, 'entries', y.n, 'amount', trim_scale(y.amount))
                            order by y.kind, y.unit), '[]'::jsonb)
    into v_totals
    from (select l.kind,
                 coalesce(l.unit, case l.kind when 'pages' then 'pages' when 'podcast' then 'episodes' end) as unit,
                 count(*)::int as n, sum(l.amount) as amount
            from public.learning l
           where l.person_id = c.person_id and l.date between v_from and v_until
           group by 1, 2) y;
  v_out := jsonb_build_object('from', v_from, 'until', v_until, 'truncated', v_more,
                              'entries', v_entries, 'totals', v_totals);
  perform agent_private.audit(c.connection_id, 'list_learning', v_args, jsonb_array_length(v_entries) || ' entries');
  return v_out;
end
$$;

-- ---------------------------------------------------------------------------
-- Who may run them: the signed-in role only (the connector switches to it); each is refused by
-- agent_private.ctx() unless reached through the connector.
-- ---------------------------------------------------------------------------

revoke all on function
  public.agent_list_team(text, int, int), public.agent_list_prospects(int, text, int),
  public.agent_list_customers(boolean, text, int, int), public.agent_get_person(text),
  public.agent_update_my_profile(jsonb),
  public.agent_log_learning(text, text, int, text, date), public.agent_list_learning(date, date)
  from public, anon, service_role;
grant execute on function
  public.agent_list_team(text, int, int), public.agent_list_prospects(int, text, int),
  public.agent_list_customers(boolean, text, int, int), public.agent_get_person(text),
  public.agent_update_my_profile(jsonb),
  public.agent_log_learning(text, text, int, text, date), public.agent_list_learning(date, date)
  to authenticated;

revoke all on function agent_private.team(text), agent_private.like_pattern(text) from public, anon, service_role;
grant execute on function agent_private.team(text), agent_private.like_pattern(text) to authenticated;
