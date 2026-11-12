-- "Referred by": who passed on a prospect's, customer's or list name's
-- details (client: src/data/referrals). A referrer is a person (a prospect,
-- a customer, a team member) or a name on a list (the customer board's
-- Referral source column holds list names, which aren't people), so each
-- referred row has two optional links, at most one of them set:
--
--  * people.referred_by / list_entries.referred_by: a person;
--  * people.referred_by_entry / list_entries.referred_by_entry: a list name.
--
-- Both are "on delete set null": deleting the referrer only drops the link.
-- Nothing is copied when a name becomes a prospect or customer: the app reads
-- the referral through the entry's prospect_id / customer_id link.
--
-- Rules (row-level security is unchanged; a guard adds, for client writes):
--  * the referrer must be someone the writer can see (can_see_person(), the
--    same set as the CRM view) or a name on a list they can see
--    (list_entry_visible()); checked only when the link is set or changed, so
--    an upline editing a downline's prospect referred by the downline's
--    private customer can still save other fields;
--  * nobody refers themselves (a row never links to itself).

alter table public.people
  add column referred_by text references public.people (id) on delete set null,
  add column referred_by_entry text references public.list_entries (id) on delete set null,
  add constraint people_referred_by_one check (num_nonnulls(referred_by, referred_by_entry) <= 1),
  add constraint people_referred_by_not_self check (referred_by is distinct from id);
create index people_referred_by_idx on public.people (referred_by) where referred_by is not null;
create index people_referred_by_entry_idx on public.people (referred_by_entry)
  where referred_by_entry is not null;
comment on column public.people.referred_by is 'Who referred this prospect or customer (a person).';
comment on column public.people.referred_by_entry is 'Who referred this prospect or customer (a name on a list).';

alter table public.list_entries
  add column referred_by text references public.people (id) on delete set null,
  add column referred_by_entry text references public.list_entries (id) on delete set null,
  add constraint list_entries_referred_by_one check (num_nonnulls(referred_by, referred_by_entry) <= 1),
  add constraint list_entries_referred_by_not_self check (referred_by_entry is distinct from id);
create index list_entries_referred_by_idx on public.list_entries (referred_by)
  where referred_by is not null;
create index list_entries_referred_by_entry_idx on public.list_entries (referred_by_entry)
  where referred_by_entry is not null;
comment on column public.list_entries.referred_by is 'Who referred this name (a person).';
comment on column public.list_entries.referred_by_entry is 'Who referred this name (another name on a list).';

-- The referrer must be visible to the writer (client writes only: the seed
-- and security-definer RPCs are trusted).
create function public.referral_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if not public.is_client_write() then
    return new;
  end if;
  if new.referred_by is not null
     and (tg_op = 'INSERT' or new.referred_by is distinct from old.referred_by)
     and not public.can_see_person(new.referred_by) then
    raise exception 'Referred by someone you can''t see' using errcode = '42501';
  end if;
  if new.referred_by_entry is not null
     and (tg_op = 'INSERT' or new.referred_by_entry is distinct from old.referred_by_entry)
     and not public.list_entry_visible(new.referred_by_entry) then
    raise exception 'Referred by a name you can''t see' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger people_referral_guard
  before insert or update of referred_by, referred_by_entry on public.people
  for each row execute function public.referral_guard();
create trigger list_entries_referral_guard
  before insert or update of referred_by, referred_by_entry on public.list_entries
  for each row execute function public.referral_guard();
