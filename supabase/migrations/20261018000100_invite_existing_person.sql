-- Invite a person who is already on the roster to sign in to THEIR record.
--
-- Until now accept_invite() always created a new person, so someone added as a
-- record first could only get a login by becoming a duplicate. An invite can
-- now be bound to a person (invites.person_id): accepting it attaches the
-- signed-in user to that person (members.user_id) and creates nothing new.
--
--  * invites.person_id: nullable, references people, on delete cascade. A
--    person-bound invite takes its sponsor, stage and name from the person
--    (trigger), so sponsor_person_id may now be null (a leader has no sponsor).
--  * At most one unused invite per person (unique partial index); creating a
--    new one withdraws the previous unused one (trigger).
--  * can_invite_person(): the rule for who may invite an existing person.
--  * accept_invite / get_invite replaced; ordinary invites behave as before.
--  * An unused invite is withdrawn when the person's registration is undone.

-- ---------------------------------------------------------------------------
-- invites: person-bound invites
-- ---------------------------------------------------------------------------

alter table public.invites
  add column person_id text references public.people (id) on delete cascade;
alter table public.invites alter column sponsor_person_id drop not null;
alter table public.invites
  add constraint invites_sponsor_or_person check (sponsor_person_id is not null or person_id is not null),
  add constraint invites_person_has_email check (person_id is null or nullif(btrim(email), '') is not null);

comment on column public.invites.person_id is
  'Set when the invite is for an existing person: accept_invite(token) signs the user in to that person instead of creating one. Sponsor, stage and name then come from the person.';

create index invites_person_idx on public.invites (person_id) where person_id is not null;
-- At most one unused invite per person (expiry is not part of the index: a new
-- invite withdraws the old unused one, see invites_for_person below).
create unique index invites_one_open_per_person_idx on public.invites (person_id)
  where person_id is not null and used_at is null;

-- ---------------------------------------------------------------------------
-- Who may invite an existing person
-- ---------------------------------------------------------------------------

-- Same rule as creating an ordinary invite (not a candidate, and the person is
-- someone the caller can see), and in addition: the person is in the caller's
-- own downline, or the caller is a leader (or a deputy acting for one). Never
-- yourself, never a customer, never someone who already has a login.
create function public.can_invite_person(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.people p
    where p.id = p_person_id
      and p.workspace_id = public.current_workspace_id()
      and p.biz_class <> 'customer'
      and p.id <> public.current_person_id()
      and not public.is_candidate()
      and p.id in (select public.visible_person_ids())
      and (public.acts_as_leader()
           or p.id in (select public.downline_ids(public.current_person_id())))
      and not exists (
        select 1 from public.members m
        where m.person_id = p.id and m.workspace_id = p.workspace_id and m.user_id is not null
      )
  )
$$;
revoke execute on function public.can_invite_person(text) from public, anon;
grant execute on function public.can_invite_person(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

-- The ordinary-invite insert rule applies to ordinary invites only.
alter policy "invite into your team" on public.invites
  with check (
    person_id is null
    and workspace_id = (select public.current_workspace_id())
    and not (select public.is_candidate())
    and created_by = (select public.current_person_id())
    and sponsor_person_id in (select public.visible_person_ids())
    and exists (select 1 from public.people p
                where p.id = sponsor_person_id and p.biz_class in ('apprentice', 'ibo'))
  );

create policy "invite an existing person" on public.invites
  for insert to authenticated
  with check (
    person_id is not null
    and workspace_id = (select public.current_workspace_id())
    and created_by = (select public.current_person_id())
    and public.can_invite_person(person_id)
  );

-- Anyone who may invite the person sees (and may withdraw) their open invite,
-- not only whoever created it.
create policy "read invites for people you may invite" on public.invites
  for select to authenticated
  using (
    person_id is not null
    and workspace_id = (select public.current_workspace_id())
    and public.can_invite_person(person_id)
  );

create policy "withdraw invites for people you may invite" on public.invites
  for delete to authenticated
  using (
    person_id is not null
    and used_at is null
    and workspace_id = (select public.current_workspace_id())
    and public.can_invite_person(person_id)
  );

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- A person-bound invite takes sponsor, stage and name from the person, and
-- replaces the person's previous unused invite. (If the person can't be found
-- the row is left alone: the insert policy then refuses it.)
create function public.invites_for_person() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_person public.people;
begin
  if new.person_id is null then
    return new;
  end if;
  select * into v_person from public.people p where p.id = new.person_id;
  if not found or v_person.workspace_id <> new.workspace_id then
    return new;
  end if;
  new.sponsor_person_id := v_person.sponsor_id;
  new.stage := case when v_person.biz_class = 'customer' then new.stage else v_person.biz_class end;
  new.name := v_person.name;
  new.email := btrim(new.email);
  delete from public.invites i where i.person_id = new.person_id and i.used_at is null;
  return new;
end $$;
revoke execute on function public.invites_for_person() from public, anon, authenticated;

create trigger invites_for_person before insert on public.invites
  for each row execute function public.invites_for_person();

-- Undoing a registration puts the person back to prospect: their unused sign-in
-- invite goes with it.
create function public.people_withdraw_invites() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.invites i where i.person_id = new.id and i.used_at is null;
  return new;
end $$;
revoke execute on function public.people_withdraw_invites() from public, anon, authenticated;

create trigger people_withdraw_invites after update of biz_class on public.people
  for each row
  when (old.biz_class in ('apprentice', 'ibo') and new.biz_class = 'prospect')
  execute function public.people_withdraw_invites();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

create function public.mask_email(p_email text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_email is null then null
    when position('@' in p_email) < 2 then '***'
    else left(p_email, 1) || '***' || substr(p_email, position('@' in p_email))
  end
$$;

-- Preview before signing in (anon may call this). Same fields as before plus
-- `for_person` (the invite is for someone already on the roster). For those,
-- `name` is the invitee's own name and `email` only a masked hint.
drop function public.get_invite(text);
create function public.get_invite(p_token text)
returns table (
  workspace_id text,
  workspace_name text,
  sponsor_name text,
  stage text,
  name text,
  email text,
  expires_at timestamptz,
  is_valid boolean,
  for_person boolean
)
language sql stable security definer set search_path = ''
as $$
  select i.workspace_id, w.name, s.name, i.stage, i.name,
         case when i.person_id is null then i.email else public.mask_email(i.email) end,
         i.expires_at,
         i.used_at is null and i.expires_at > now()
           and (i.person_id is null
                or not exists (select 1 from public.members m
                               where m.person_id = i.person_id and m.workspace_id = i.workspace_id
                                 and m.user_id is not null)),
         i.person_id is not null
  from public.invites i
  join public.workspaces w on w.id = i.workspace_id
  left join public.people s on s.id = i.sponsor_person_id
  where i.token = p_token
$$;
revoke execute on function public.get_invite(text) from public;
grant execute on function public.get_invite(text) to anon, authenticated;

-- Accept an invite as the signed-in user. An ordinary invite creates their
-- person under the sponsor (stage from the invite) and a member row; a
-- person-bound one signs them in to the existing person (member row updated, or
-- created when the person has none). Returns the person id.
create or replace function public.accept_invite(p_token text) returns text
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
  v_confirmed timestamptz;
  v_target public.people;
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

  select u.email, u.raw_user_meta_data, u.email_confirmed_at
    into v_email, v_meta, v_confirmed from auth.users u where u.id = v_uid;

  if v_inv.person_id is not null then
    -- Sign in to the existing person.
    select * into v_target from public.people p
     where p.id = v_inv.person_id and p.workspace_id = v_inv.workspace_id for update;
    if not found then
      raise exception 'Person not found: they are no longer on the team' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.members m
               where m.person_id = v_target.id and m.workspace_id = v_target.workspace_id
                 and m.user_id is not null) then
      raise exception 'This person already has a sign-in' using errcode = '22023';
    end if;
    -- The inviter confirmed this address: only that account may claim the record.
    if v_confirmed is null then
      raise exception 'Confirm your email address first' using errcode = '42501';
    end if;
    if lower(btrim(coalesce(v_email, ''))) <> lower(btrim(v_inv.email)) then
      raise exception 'This invite was sent to a different email address' using errcode = '42501';
    end if;

    update public.members m set user_id = v_uid
     where m.workspace_id = v_target.workspace_id and m.person_id = v_target.id and m.user_id is null;
    if not found then
      insert into public.members (workspace_id, person_id, user_id, role)
      values (v_target.workspace_id, v_target.id, v_uid, 'member');
    end if;

    if nullif(btrim(coalesce(v_target.email, '')), '') is null then
      update public.people p set email = v_inv.email where p.id = v_target.id;
    end if;

    update public.invites set used_at = now(), used_by = v_uid where id = v_inv.id;

    insert into public.activity (workspace_id, actor_name, actor_id, entity_type, entity_id,
                                 related_person_id, kind, summary)
    values (v_target.workspace_id, v_target.name, v_target.id, 'person', v_target.id, v_target.id, 'created',
            'Joined from an invite link');

    return v_target.id;
  end if;

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
