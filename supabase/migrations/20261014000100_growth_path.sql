-- Growth path (docs/plans/mvp-plan-2026-10-13.md; mirror of src/data/growth):
--   * sales get a PV (point value) and the person whose PV they count toward;
--   * uplines set a downline's PV for a calendar month (replacing the logged
--     total), recorded with who and when;
--   * uplines mark a milestone as reached by hand (e.g. history from before
--     the app), recorded with who and when.
-- The milestone rules themselves run in the app (src/data/growth/engine.ts).

-- ---------------------------------------------------------------------------
-- Sales: PV and whose PV it is
-- ---------------------------------------------------------------------------

alter table public.sales
  add column pv numeric(10, 2) check (pv is null or pv >= 0),
  add column person_id text references public.people (id) on delete set null;
comment on column public.sales.pv is 'Point value; counts toward person_id''s monthly PV.';
comment on column public.sales.person_id is
  'Whose PV the sale counts toward: the customer''s owner, or the buyer for a personal order (customer_id is then a business person).';
create index sales_person_date_idx on public.sales (person_id, date) where person_id is not null;

-- Existing sales count toward the customer's owner (or the buyer themselves).
update public.sales s
   set person_id = case when c.biz_class = 'customer' then c.owner_id else c.id end
  from public.people c
 where c.id = s.customer_id and s.person_id is null;

-- A sale counts toward the customer's owner, or the buyer for a personal
-- order. Filled in when the client leaves it out; anything else is refused.
create function public.sales_attribute() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_seller text;
begin
  select case when c.biz_class = 'customer' then c.owner_id else c.id end
    into v_seller
    from public.people c
   where c.id = new.customer_id;
  if not found then
    return new; -- the customer check / foreign key decides
  end if;
  if new.person_id is null then
    new.person_id := v_seller;
  elsif public.is_client_write() and new.person_id is distinct from v_seller then
    raise exception 'A sale counts toward the customer''s owner, or the buyer for a personal order'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger sales_attribute before insert or update of customer_id, person_id on public.sales
  for each row execute function public.sales_attribute();

-- Reading: sales of customers you can see (your own customers, as before) and
-- sales that count toward someone you can see, so uplines can work out their
-- team's PV. The customer stays private: their people row is still only
-- visible to their owner. Writing is unchanged: sales of visible customers
-- (or a visible business person's personal order).
drop policy "sales of visible customers" on public.sales;

create policy "sales of visible customers or sellers" on public.sales
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and (customer_id in (select public.visible_person_ids())
              or person_id in (select public.visible_person_ids())));

create policy "log sales of visible customers" on public.sales
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and customer_id in (select public.visible_person_ids()));

create policy "edit sales of visible customers" on public.sales
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and customer_id in (select public.visible_person_ids()))
  with check (workspace_id = (select public.current_workspace_id())
              and customer_id in (select public.visible_person_ids()));

create policy "delete sales of visible customers" on public.sales
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and customer_id in (select public.visible_person_ids()));

-- ---------------------------------------------------------------------------
-- Who may coach whom
-- ---------------------------------------------------------------------------

-- The caller is an upline of the person: the person is in the caller's
-- business downline (visible, not a customer) and isn't the caller.
create function public.is_upline_of(p_person_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_person_id is distinct from public.current_person_id()
     and p_person_id in (select public.visible_person_ids())
     and exists (select 1 from public.people p
                  where p.id = p_person_id
                    and p.biz_class <> 'customer'
                    and p.workspace_id = public.current_workspace_id())
$$;
revoke execute on function public.is_upline_of(text) from public, anon;
grant execute on function public.is_upline_of(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Monthly PV set by uplines (PvOverride)
-- ---------------------------------------------------------------------------

create table public.pv_overrides (
  person_id text not null references public.people (id) on delete cascade,
  -- Calendar month, 'YYYY-MM'.
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  pv numeric(10, 2) not null check (pv >= 0),
  set_by text default public.current_person_id() references public.people (id) on delete set null,
  set_at timestamptz not null default now(),
  primary key (person_id, month)
);
comment on table public.pv_overrides is
  'A person''s PV for one calendar month, set by an upline; replaces the logged sales total for that month.';

-- ---------------------------------------------------------------------------
-- Milestones marked by hand (MilestoneMark)
-- ---------------------------------------------------------------------------

create table public.milestone_marks (
  person_id text not null references public.people (id) on delete cascade,
  code text not null check (code in ('new_apprentice', 'first_sale', 'core_150', 'core_300',
    'first_sponsor', 'bronze_foundation', '3_10', 'bronze_builder', '6_25', '6_50',
    'platinum', 'ruby', '12_100')),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  reached_on date not null,
  marked_by text default public.current_person_id() references public.people (id) on delete set null,
  marked_at timestamptz not null default now(),
  note text,
  primary key (person_id, code)
);
comment on table public.milestone_marks is
  'A growth-path milestone an upline marked as reached by hand (e.g. history from before the app).';

-- Clients can't choose who set a value or when, or move a row to another
-- person, month or milestone. A marked day can't be in the future (a day of
-- slack for time zones).
create function public.pv_overrides_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'UPDATE' and (new.person_id is distinct from old.person_id
        or new.month is distinct from old.month or new.workspace_id is distinct from old.workspace_id) then
      raise exception 'A monthly PV can''t move to another person or month' using errcode = '42501';
    end if;
    new.set_by := public.current_person_id();
    new.set_at := now();
  end if;
  return new;
end $$;
create trigger pv_overrides_stamp before insert or update on public.pv_overrides
  for each row execute function public.pv_overrides_stamp();

create function public.milestone_marks_stamp() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if public.is_client_write() then
    if tg_op = 'UPDATE' and (new.person_id is distinct from old.person_id
        or new.code is distinct from old.code or new.workspace_id is distinct from old.workspace_id) then
      raise exception 'A mark can''t move to another person or milestone' using errcode = '42501';
    end if;
    if new.reached_on > current_date + 1 then
      raise exception 'A milestone can''t be reached in the future' using errcode = '23514';
    end if;
    new.marked_by := public.current_person_id();
    new.marked_at := now();
  end if;
  return new;
end $$;
create trigger milestone_marks_stamp before insert or update on public.milestone_marks
  for each row execute function public.milestone_marks_stamp();

-- ---------------------------------------------------------------------------
-- RLS: anyone who can see the person reads; only their uplines write
-- ---------------------------------------------------------------------------

alter table public.pv_overrides enable row level security;
alter table public.milestone_marks enable row level security;

create policy "pv overrides of visible people" on public.pv_overrides
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));
create policy "uplines set a month's pv" on public.pv_overrides
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and public.is_upline_of(person_id));
create policy "uplines change a month's pv" on public.pv_overrides
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and public.is_upline_of(person_id))
  with check (workspace_id = (select public.current_workspace_id())
              and public.is_upline_of(person_id));
create policy "uplines clear a month's pv" on public.pv_overrides
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and public.is_upline_of(person_id));

create policy "milestone marks of visible people" on public.milestone_marks
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id in (select public.visible_person_ids()));
create policy "uplines mark milestones" on public.milestone_marks
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and public.is_upline_of(person_id));
create policy "uplines change marks" on public.milestone_marks
  for update to authenticated
  using (workspace_id = (select public.current_workspace_id()) and public.is_upline_of(person_id))
  with check (workspace_id = (select public.current_workspace_id())
              and public.is_upline_of(person_id));
create policy "uplines remove marks" on public.milestone_marks
  for delete to authenticated
  using (workspace_id = (select public.current_workspace_id()) and public.is_upline_of(person_id));

revoke execute on function public.sales_attribute() from public, anon, authenticated;
revoke execute on function public.pv_overrides_stamp() from public, anon, authenticated;
revoke execute on function public.milestone_marks_stamp() from public, anon, authenticated;
