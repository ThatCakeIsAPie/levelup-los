-- Agent connector, part 2: the whitelist. Everything an agent can do is a
-- function named `agent_*` in `public`, and this file is the one place that
-- defines them (each new tool is one function here, one entry in
-- supabase/functions/agent/tools.ts and its tests).
--
-- Every tool is SECURITY INVOKER: the Edge Function runs it as the person
-- (`set local role authenticated`, the person's login in request.jwt.claims),
-- so the existing row-level security decides what they may see and change.
-- Every tool starts with agent_private.ctx(), which refuses unless the call
-- comes through the connector for a live, matching connection that the team
-- switch still allows, and writes exactly one audit row (also when it refuses
-- a request it understood: it returns {"error": "..."} after auditing instead
-- of raising, because a raise would roll the audit row back).
--
-- Never available to an agent: deletes, stage, sponsor, IBO#/LTD#, business
-- start date, chat, anything outside this list.

-- Who the connected person is, and what this connection may do.
create function public.agent_whoami() returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_out jsonb;
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
           'access', c.access)
    into v_out
    from public.people p where p.id = c.person_id;
  perform agent_private.audit(c.connection_id, 'whoami', '{}'::jsonb, 'ok');
  return v_out;
end
$$;

-- Prospects the person can see (their own and their downline's).
create function public.agent_list_prospects(p_limit int default 50) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name, x.id), '[]'::jsonb) into v_out
    from (select p.id, p.name, p.phone, p.email, p.location, p.notes, p.sponsor_id
            from public.people p
           where p.biz_class = 'prospect'
           order by p.name, p.id
           limit v_limit) x;
  perform agent_private.audit(c.connection_id, 'list_prospects', jsonb_build_object('limit', v_limit),
                              jsonb_array_length(v_out) || ' rows');
  return v_out;
end
$$;

-- Add a prospect under the connected person.
create function public.agent_add_prospect(p_name text, p_phone text default null) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_id text := gen_random_uuid()::text;
  v_args jsonb := jsonb_build_object('name', p_name, 'phone', p_phone);
  v_out jsonb;
begin
  select * into c from agent_private.ctx(true);
  if p_name is null or btrim(p_name) = '' or char_length(p_name) > 120 or char_length(coalesce(p_phone, '')) > 40 then
    perform agent_private.audit(c.connection_id, 'add_prospect', v_args, 'refused: invalid name or phone');
    return jsonb_build_object('error', 'A name of 1 to 120 characters is required (phone at most 40).');
  end if;
  -- A chosen id and no RETURNING: RETURNING must pass the SELECT policy, which
  -- cannot see a row inserted by the same statement.
  insert into public.people (id, name, biz_class, pipeline_stage, sponsor_id, phone, stage_history)
  values (v_id, btrim(p_name), 'prospect', 'prospect', c.person_id, nullif(btrim(coalesce(p_phone, '')), ''),
          jsonb_build_array(jsonb_build_object('stage', 'prospect', 'at', now())));
  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'sponsor_id', p.sponsor_id)
    into v_out from public.people p where p.id = v_id;
  perform agent_private.audit(c.connection_id, 'add_prospect', v_args, 'created ' || v_id, null, v_out);
  return v_out;
end
$$;

-- Change a prospect's name, phone, email, location or notes. Any other key in
-- the patch is rejected, not ignored. RLS decides which prospects the person
-- may change; an invisible one is "not found" and nothing changes.
create function public.agent_update_prospect(p_id text, p_patch jsonb) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('id', p_id, 'patch', p_patch);
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_max int;
  v_allowed constant text[] := array['name', 'phone', 'email', 'location', 'notes'];
begin
  select * into c from agent_private.ctx(true);
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: empty patch');
    return jsonb_build_object('error', 'Nothing to change: give at least one of name, phone, email, location, notes.');
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: field ' || left(v_key, 40) || ' is not allowed');
      return jsonb_build_object('error',
        'Only name, phone, email, location and notes can be changed; "' || left(v_key, 40) || '" cannot. Nothing was changed.');
    end if;
    v_max := case v_key when 'name' then 120 when 'phone' then 40 when 'email' then 200
                        when 'location' then 200 else 4000 end;
    if jsonb_typeof(p_patch -> v_key) not in ('string', 'null')
       or (v_key = 'name' and (jsonb_typeof(p_patch -> 'name') <> 'string' or btrim(p_patch ->> 'name') = ''))
       or char_length(coalesce(p_patch ->> v_key, '')) > v_max then
      perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: bad value for ' || v_key);
      return jsonb_build_object('error',
        '"' || v_key || '" must be text of at most ' || v_max || ' characters or null (a name cannot be empty or null). Nothing was changed.');
    end if;
  end loop;

  select jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email,
                            'location', p.location, 'notes', p.notes)
    into v_old from public.people p where p.id = p_id and p.biz_class = 'prospect';
  if v_old is null then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: no such prospect among the visible ones');
    return jsonb_build_object('error', 'No such prospect among the people you can see. Nothing was changed.');
  end if;

  update public.people p set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else p.name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(p_patch ->> 'phone'), '') else p.phone end,
    email = case when p_patch ? 'email' then nullif(btrim(p_patch ->> 'email'), '') else p.email end,
    location = case when p_patch ? 'location' then nullif(btrim(p_patch ->> 'location'), '') else p.location end,
    notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else p.notes end,
    last_updated_at = now()
   where p.id = p_id and p.biz_class = 'prospect'
  returning jsonb_build_object('id', p.id, 'name', p.name, 'phone', p.phone, 'email', p.email,
                               'location', p.location, 'notes', p.notes)
    into v_new;
  if v_new is null then
    perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'refused: not allowed to change that prospect');
    return jsonb_build_object('error', 'You are not allowed to change that prospect. Nothing was changed.');
  end if;
  perform agent_private.audit(c.connection_id, 'update_prospect', v_args, 'updated ' || p_id, v_old, v_new);
  return v_new;
end
$$;

-- Events that have not ended, with the caller's own answer.
create function public.agent_list_upcoming_events() returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_today date;
  v_out jsonb;
begin
  select * into c from agent_private.ctx(false);
  v_today := public.workspace_today(c.workspace_id);
  select coalesce(jsonb_agg(to_jsonb(x) order by x.date, x.id), '[]'::jsonb) into v_out
    from (select e.id, e.name, e.date, e.end_date, k.name as category, e.location,
                 a.desire_to_attend as my_answer
            from public.events e
            left join public.event_categories k on k.id = e.category_id
            left join public.attendances a on a.event_id = e.id and a.person_id = c.person_id
           where coalesce(e.end_date, e.date) >= v_today
           order by e.date, e.id
           limit 200) x;
  perform agent_private.audit(c.connection_id, 'list_upcoming_events', '{}'::jsonb,
                              jsonb_array_length(v_out) || ' rows');
  return v_out;
end
$$;

-- The caller's own answer to an event: yes, no or maybe. Never anyone else's.
create function public.agent_set_event_answer(p_event_id text, p_answer text) returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  c record;
  v_args jsonb := jsonb_build_object('event_id', p_event_id, 'answer', p_answer);
  v_old jsonb;
  v_new jsonb;
begin
  select * into c from agent_private.ctx(true);
  if p_answer is null or p_answer not in ('yes', 'no', 'maybe') then
    perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'refused: answer must be yes, no or maybe');
    return jsonb_build_object('error', 'The answer must be yes, no or maybe.');
  end if;
  if p_event_id is null or not exists (select 1 from public.events e where e.id = p_event_id) then
    perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'refused: no such event');
    return jsonb_build_object('error', 'No such event.');
  end if;
  select jsonb_build_object('event_id', a.event_id, 'answer', a.desire_to_attend) into v_old
    from public.attendances a where a.event_id = p_event_id and a.person_id = c.person_id;
  insert into public.attendances (event_id, person_id, desire_to_attend)
  values (p_event_id, c.person_id, p_answer)
  on conflict (event_id, person_id) do update set desire_to_attend = excluded.desire_to_attend;
  select jsonb_build_object('event_id', a.event_id, 'answer', a.desire_to_attend) into v_new
    from public.attendances a where a.event_id = p_event_id and a.person_id = c.person_id;
  perform agent_private.audit(c.connection_id, 'set_event_answer', v_args, 'set ' || p_answer, v_old, v_new);
  return v_new;
end
$$;

-- Only the signed-in role may run them (the connector switches to it), and
-- every one of them is refused by agent_private.ctx() unless it was reached
-- through the connector.
revoke all on function
  public.agent_whoami(), public.agent_list_prospects(int), public.agent_add_prospect(text, text),
  public.agent_update_prospect(text, jsonb), public.agent_list_upcoming_events(),
  public.agent_set_event_answer(text, text)
  from public, anon, service_role;
grant execute on function
  public.agent_whoami(), public.agent_list_prospects(int), public.agent_add_prospect(text, text),
  public.agent_update_prospect(text, jsonb), public.agent_list_upcoming_events(),
  public.agent_set_event_answer(text, text)
  to authenticated;
