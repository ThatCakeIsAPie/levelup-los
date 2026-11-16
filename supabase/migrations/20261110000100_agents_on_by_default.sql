-- AI agents are on by default: a team with no `feature_switches` row for `agents` has the
-- feature on. An explicit row decides: `enabled = false` keeps it off (and flipping the switch
-- writes the row as before); every other feature is still off without a row.
--
-- The only reader of the `agents` switch is agent_private.access_for(). Everything else asks
-- it: my_agent_access() (the Settings card), create_agent_pairing(), the pairing redemption
-- and the guard of every tool call, so redefining that one function is the whole change. It is
-- the 20261105000100_agent_connector.sql body with one expression changed: `switch_on` is the
-- stored value, and true when there is no row. The owner, `security definer`, the empty
-- search_path and the revoked grants are what they were (create or replace keeps the owner and
-- the privileges; the revoke is repeated so this file states them).
--
-- Switching the feature off for a team (an explicit `false` row) still refuses a non-admin on
-- their next call and still lets an app admin through as a preview, exactly as before.

create or replace function agent_private.access_for(p_uid uuid)
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

  switch_on := coalesce((select f.enabled from public.feature_switches f
                          where f.workspace_id = v_ws and f.feature = 'agents'), true);
  preview := exists (select 1 from public.app_admins a where a.user_id = p_uid);
  allowed := switch_on or preview;
  reason := case when allowed then null else 'switched_off' end;
  return next;
end
$$;
revoke all on function agent_private.access_for(uuid) from public, anon, authenticated, service_role;
