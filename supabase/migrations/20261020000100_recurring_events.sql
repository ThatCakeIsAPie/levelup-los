-- Repeating events (client: src/data/recurrence).
--
-- An event can repeat with no end, the way calendar apps do it. The design:
--
--  * Every occurrence is a real row in `events` with its own id, so attendance, answers, rosters,
--    logistics, follow-ups, chat posts and counts keep working per session, unchanged.
--  * `event_series` holds the rule (frequency, first date, last date, dates deleted on their own) and
--    what a new occurrence is made from. Occurrences point at it with `events.series_id`, and are
--    identified in it by `events.series_date`, the date of their place in the rule (it never changes,
--    even when the event itself is moved).
--  * Exactly one occurrence per series date: a unique index on (series_id, series_date), and every
--    function that makes or re-plans occurrences first locks the series row.
--  * An occurrence deleted on its own keeps its date in `event_series.skipped` (a trigger does it, so
--    even a client that doesn't know about series can't bring it back), and a field changed on one
--    occurrence is remembered in `events.series_overrides` (a trigger, for the same reason).
--  * A series is kept filled ahead by `topup_event_series()`, which the app calls when someone signed
--    in loads events (no scheduled job: the earlier migrations only use pg_cron when it happens to be
--    installed, and an idle team gets its occurrences as soon as anyone opens the app).
--  * Generated occurrences carry the series creator in `created_by`, so they are editable by the same
--    people as if the creator had added them by hand, whoever's browser triggered the top-up.
--
-- Additive only: a new table, three new nullable columns on `events`, new functions and triggers.
-- Existing events don't repeat; a client that doesn't know about series keeps working.

-- ---------------------------------------------------------------------------
-- Date arithmetic (the same rules as src/data/recurrence/rule.ts; both are tested against the
-- same table of cases, src/data/recurrence/cases.ts)
-- ---------------------------------------------------------------------------

-- The nth occurrence (0 = the first date) of a rule. Monthly on a day the month lacks is the last day
-- of the month; monthly on the fifth weekday of a month that has only four is the last such weekday.
create function public.series_nth_date(p_freq text, p_anchor date, p_n integer) returns date
language plpgsql immutable set search_path = ''
as $$
declare
  v_first date;
  v_last date;
  v_day integer;
begin
  if p_n < 0 then
    raise exception 'n can''t be negative' using errcode = '22023';
  end if;
  if p_freq = 'daily' then
    return p_anchor + p_n;
  elsif p_freq = 'weekly' then
    return p_anchor + 7 * p_n;
  elsif p_freq = 'biweekly' then
    return p_anchor + 14 * p_n;
  elsif p_freq in ('monthly_date', 'monthly_weekday') then
    v_first := (make_date(extract(year from p_anchor)::integer, extract(month from p_anchor)::integer, 1)
                + make_interval(months => p_n))::date;
    v_last := ((v_first + interval '1 month')::date) - 1;
    if p_freq = 'monthly_date' then
      return least(v_first + (extract(day from p_anchor)::integer - 1), v_last);
    end if;
    v_day := ((extract(dow from p_anchor)::integer - extract(dow from v_first)::integer + 7) % 7)
             + 7 * ((extract(day from p_anchor)::integer - 1) / 7);
    if v_first + v_day > v_last then
      v_day := v_day - 7;
    end if;
    return v_first + v_day;
  end if;
  raise exception 'Unknown repeat: %', p_freq using errcode = '22023';
end $$;

-- The shortest gap, in days, between two occurrences of a rule.
create function public.series_period_days(p_freq text) returns integer
language sql immutable set search_path = ''
as $$
  select case p_freq when 'daily' then 1 when 'weekly' then 7 when 'biweekly' then 14 else 28 end
$$;

-- Whether a date is one of the rule's occurrences.
create function public.series_is_slot(p_freq text, p_anchor date, p_date date) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_d date;
  n integer := 0;
begin
  if p_date < p_anchor then
    return false;
  end if;
  while n < 5000 loop
    v_d := public.series_nth_date(p_freq, p_anchor, n);
    if v_d = p_date then
      return true;
    elsif v_d > p_date then
      return false;
    end if;
    n := n + 1;
  end loop;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- The series
-- ---------------------------------------------------------------------------

create table public.event_series (
  id text primary key default gen_random_uuid()::text,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- Who made the series; every occurrence is created as theirs (edit rights follow created_by).
  created_by text references public.people (id) on delete set null,
  freq text not null
    check (freq in ('daily', 'weekly', 'biweekly', 'monthly_date', 'monthly_weekday')),
  -- The first occurrence's date: where the rule starts counting.
  starts_on date not null,
  -- The last date an occurrence may fall on; null = never ends.
  ends_on date,
  -- Dates whose occurrence was deleted on its own: they are not made again.
  skipped date[] not null default '{}',
  -- What a new occurrence is made from.
  name text not null check (length(btrim(name)) > 0),
  category_id text not null references public.event_categories (id) on delete restrict,
  location text,
  notes text,
  format text not null default 'in_person' check (format in ('in_person', 'virtual', 'both')),
  ticket_url text
    check (ticket_url is null or (ticket_url ~* '^https?://[^\s]+$' and length(ticket_url) <= 2000)),
  -- Days an occurrence runs past its first day (0 = a one-day event).
  length_days integer not null default 0 check (length_days between 0 and 366),
  created_at timestamptz not null default now()
);
create index event_series_workspace_idx on public.event_series (workspace_id);
comment on table public.event_series is
  'The rule of a repeating event and what each new occurrence is made from. Read by the team; made and changed only by the series functions (no direct writes).';

alter table public.event_series enable row level security;

create policy "read event series" on public.event_series
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id()));

-- No insert, update or delete policy and no table privilege besides select: a series is made and changed
-- only by the security definer functions below, which check who may, and is never deleted by a client.
revoke all on public.event_series from public, anon, authenticated;
grant select on public.event_series to authenticated;

alter table public.events
  add column series_id text references public.event_series (id) on delete set null,
  add column series_date date,
  add column series_overrides text[];
comment on column public.events.series_id is 'The series this event is one occurrence of; null for an event that doesn''t repeat.';
comment on column public.events.series_date is 'The date of this occurrence''s place in its series; stays when the event itself is moved.';
comment on column public.events.series_overrides is 'Columns changed on this occurrence alone: a later "this and following" edit from an earlier occurrence leaves them as they are.';

-- Exactly one occurrence per series date.
create unique index events_series_slot_key on public.events (series_id, series_date)
  where series_id is not null;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The series functions set this while they work, so the triggers below let their own changes through.
create function public.series_internal_begin() returns text
language plpgsql set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('app.series_internal', true), '');
begin
  perform set_config('app.series_internal', 'on', true);
  return v_prev;
end $$;

create function public.series_internal_end(p_prev text) returns void
language plpgsql set search_path = ''
as $$
begin
  perform set_config('app.series_internal', coalesce(p_prev, ''), true);
end $$;

-- Who may edit events: the same as the policies on public.events (the creator, a leader or moderator,
-- a deputy).
create function public.may_edit_events(p_created_by text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(p_created_by = public.current_person_id(), false)
      or public.is_moderator_or_leader()
      or public.is_deputy()
$$;

-- Whether anything hangs off an event: attendance, travel and logistics, shared costs, follow-up notes,
-- a library talk linked to it, a chat post about it. Such an occurrence is never thrown away when a
-- series is planned again.
create function public.event_has_dependents(p_event_id text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.attendances a where a.event_id = p_event_id)
      or exists (select 1 from public.logistics l where l.event_id = p_event_id)
      or exists (select 1 from public.shared_costs c where c.event_id = p_event_id)
      or exists (select 1 from public.missed_event_notes n where n.event_id = p_event_id)
      or exists (select 1 from public.library_items i where i.event_id = p_event_id)
      or exists (select 1 from public.messages m
                  where m.card ->> 'type' = 'event' and m.card ->> 'eventId' = p_event_id
                    and m.deleted_at is null)
$$;

-- ---------------------------------------------------------------------------
-- Triggers on events
-- ---------------------------------------------------------------------------

-- A client can't make, move or detach occurrences by hand (only the series functions do). A change to
-- one occurrence is remembered on it, so it is never overwritten by an edit from an earlier occurrence.
create function public.events_series_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_fields text[];
begin
  if coalesce(current_setting('app.series_internal', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.series_id is not null or new.series_date is not null or new.series_overrides is not null then
      raise exception 'Occurrences of a repeating event are made by their series'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.series_id is distinct from old.series_id
     or new.series_date is distinct from old.series_date
     or new.series_overrides is distinct from old.series_overrides then
    raise exception 'The series of an event can''t be changed directly' using errcode = '42501';
  end if;
  if old.series_id is not null then
    v_fields := array_remove(array[
      case when new.name is distinct from old.name then 'name' end,
      case when new.category_id is distinct from old.category_id then 'category_id' end,
      case when new.location is distinct from old.location then 'location' end,
      case when new.notes is distinct from old.notes then 'notes' end,
      case when new.format is distinct from old.format then 'format' end,
      case when new.ticket_url is distinct from old.ticket_url then 'ticket_url' end,
      case when new.date is distinct from old.date then 'date' end,
      case when new.end_date is distinct from old.end_date then 'end_date' end
    ]::text[], null);
    if cardinality(v_fields) > 0 then
      new.series_overrides := array(
        select distinct f from unnest(coalesce(old.series_overrides, '{}'::text[]) || v_fields) f
         order by f);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.events_series_guard() from public, anon, authenticated;

create trigger events_series_guard before insert or update on public.events
  for each row execute function public.events_series_guard();

-- An occurrence deleted on its own never comes back: its date is kept on the series. (The series
-- functions that delete occurrences stop or re-plan the series themselves and skip this.)
create function public.events_series_tombstone() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.series_id is not null and old.series_date is not null
     and coalesce(current_setting('app.series_internal', true), '') <> 'on' then
    update public.event_series
       set skipped = array(select distinct d from unnest(array_append(skipped, old.series_date)) d order by d)
     where id = old.series_id and not (old.series_date = any(skipped));
  end if;
  return old;
end $$;
revoke execute on function public.events_series_tombstone() from public, anon, authenticated;

create trigger events_series_tombstone before delete on public.events
  for each row execute function public.events_series_tombstone();

-- ---------------------------------------------------------------------------
-- Filling a series ahead
-- ---------------------------------------------------------------------------

-- Makes the occurrences a series is missing for p_today: every date from today on within 8 weeks, and
-- at least the next 2; never a date in the past, a skipped date or one after the end. Locks the series
-- row, so two callers at once take turns, and each date has its unique index besides: whoever is second
-- finds the occurrence there and makes nothing. Returns the occurrences it made.
create function public.series_fill(p_series_id text, p_today date) returns setof public.events
language plpgsql security definer set search_path = ''
as $$
declare
  s public.event_series;
  n integer := 0;
  v_slot date;
  v_wanted integer := 0;
  v_horizon date := p_today + 56;
  v_row public.events;
  v_prev text;
begin
  select * into s from public.event_series where id = p_series_id for update;
  if s.id is null or (s.ends_on is not null and s.ends_on < p_today) then
    return;
  end if;
  v_prev := public.series_internal_begin();
  while n < 5000 loop
    v_slot := public.series_nth_date(s.freq, s.starts_on, n);
    n := n + 1;
    exit when s.ends_on is not null and v_slot > s.ends_on;
    continue when v_slot < p_today;
    exit when v_slot > v_horizon and v_wanted >= 2;
    continue when v_slot = any(s.skipped);
    v_wanted := v_wanted + 1;
    insert into public.events
      (workspace_id, name, category_id, date, end_date, location, notes, format, ticket_url,
       created_by, series_id, series_date)
    values
      (s.workspace_id, s.name, s.category_id, v_slot,
       case when s.length_days > 0 then v_slot + s.length_days end,
       s.location, s.notes, s.format, s.ticket_url, s.created_by, s.id, v_slot)
    on conflict (series_id, series_date) where series_id is not null do nothing
    returning * into v_row;
    if found then
      return next v_row;
    end if;
  end loop;
  perform public.series_internal_end(v_prev);
  return;
end $$;
revoke execute on function public.series_fill(text, date) from public, anon, authenticated;

-- Tops up every open series of the caller's workspace. Any signed-in member may call it: it only makes
-- what the rules already say, always as the series' creator. A series that can't be filled (for
-- example its category was archived) is left and the others go on.
create function public.topup_event_series() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_today date;
  v_prev text;
  v_id text;
  r public.events;
  v_events jsonb := '[]'::jsonb;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  v_today := public.workspace_today(v_ws);
  v_prev := public.series_internal_begin();
  for v_id in
    select id from public.event_series
     where workspace_id = v_ws and (ends_on is null or ends_on >= v_today)
     order by id
  loop
    begin
      for r in select * from public.series_fill(v_id, v_today) loop
        v_events := v_events || to_jsonb(r);
      end loop;
    exception when others then
      raise warning 'event series % could not be filled: %', v_id, sqlerrm;
    end;
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object('events', v_events);
end $$;
comment on function public.topup_event_series() is
  'Makes the occurrences the caller''s team''s repeating events are missing (8 weeks ahead, at least the next 2). Safe to call any time and from any number of clients at once.';
revoke execute on function public.topup_event_series() from public, anon;
grant execute on function public.topup_event_series() to authenticated;

-- ---------------------------------------------------------------------------
-- Making an event repeat, and "this and following"
-- ---------------------------------------------------------------------------

-- The first date of the event becomes the series' first occurrence and the next ones are made. Who may:
-- whoever may edit the event (its creator, a leader or moderator, a deputy); a new event is made by
-- anyone but a candidate, and its creator is whoever made it.
create function public.make_event_repeat(p_event_id text, p_freq text, p_ends_on date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  e public.events;
  v_id text;
  v_prev text;
  r public.events;
  v_events jsonb := '[]'::jsonb;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  select * into e from public.events where id = p_event_id and workspace_id = v_ws for update;
  if e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if not public.may_edit_events(e.created_by) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  if e.series_id is not null then
    raise exception 'That event already repeats' using errcode = '22023';
  end if;
  if p_freq is null or p_freq not in ('daily', 'weekly', 'biweekly', 'monthly_date', 'monthly_weekday') then
    raise exception 'Unknown repeat' using errcode = '22023';
  end if;
  if p_ends_on is not null and p_ends_on < e.date then
    raise exception 'The series can''t end before it starts' using errcode = '22023';
  end if;
  if coalesce(e.end_date - e.date, 0) > 0
     and coalesce(e.end_date - e.date, 0) + 1 >= public.series_period_days(p_freq) then
    raise exception 'A multi-day event can only repeat less often than it is long' using errcode = '22023';
  end if;

  v_prev := public.series_internal_begin();
  insert into public.event_series
    (workspace_id, created_by, freq, starts_on, ends_on, name, category_id, location, notes, format,
     ticket_url, length_days)
  values
    (e.workspace_id, e.created_by, p_freq, e.date, p_ends_on, e.name, e.category_id, e.location, e.notes,
     e.format, e.ticket_url, coalesce(e.end_date - e.date, 0))
  returning id into v_id;
  update public.events set series_id = v_id, series_date = e.date where id = e.id;
  for r in select * from public.series_fill(v_id, public.workspace_today(v_ws)) loop
    v_events := v_events || to_jsonb(r);
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', v_events || coalesce((select jsonb_agg(to_jsonb(x)) from public.events x where x.id = e.id), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y where y.id = v_id), '[]'::jsonb));
end $$;
comment on function public.make_event_repeat(text, text, date) is
  'Makes an event repeat (daily, weekly, biweekly, monthly_date, monthly_weekday), until p_ends_on or for ever. The event is the first occurrence; the next ones are made 8 weeks ahead.';
revoke execute on function public.make_event_repeat(text, text, date) from public, anon;
grant execute on function public.make_event_repeat(text, text, date) to authenticated;

-- "This and following events" on save: the edit made on one occurrence applies to it and the later ones
-- of its series, and to the occurrences made in future; earlier ones are never touched.
--
--  * p_patch: the fields as the person left them, by column (name, category_id, location, notes, format,
--    ticket_url, date, end_date; a null value clears). Only the fields that differ from the occurrence
--    as stored are applied to later ones, and not where that occurrence set the field itself with
--    "this event" (series_overrides). The occurrence itself takes all of it and clears its own marks.
--  * p_repeat: null = Repeats and Ends as they were; {"freq": "none"} = stop repeating here;
--    {"freq": "...", "ends_on": date|null} = a new rule.
--  * If the date, Repeats or Ends changed, the later occurrences are planned again from this one's
--    (new) date: the series is split here (or changed in place when this is its first). Later
--    occurrences that were never edited, have nothing hanging off them and are still ahead are dropped
--    and made again by the new rule; the others are never deleted: they stay in the series when their
--    date still fits the new rule and are otherwise kept as single events.
create function public.update_event_series_following(p_event_id text, p_patch jsonb, p_repeat jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_today date;
  v_sid text;
  s public.event_series;
  e public.events;
  n public.events;
  v_key text;
  v_changed text[];
  v_old_len integer;
  v_new_len integer;
  v_freq text;
  v_ends date;
  v_stopped boolean := false;
  v_rule_changed boolean := false;
  v_target text;
  v_first boolean;
  v_later text[];
  v_taken date[] := '{}';
  v_removed text[] := '{}';
  v_touched text[];
  v_prev text;
  l public.events;
  r public.events;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  p_patch := coalesce(p_patch, '{}'::jsonb);
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key not in ('name', 'category_id', 'location', 'notes', 'format', 'ticket_url', 'date', 'end_date') then
      raise exception 'Unknown field: %', v_key using errcode = '22023';
    end if;
  end loop;

  -- Series first, then the occurrence: the same order everywhere, so two callers can't deadlock.
  select series_id into v_sid from public.events where id = p_event_id and workspace_id = v_ws;
  if v_sid is null then
    raise exception 'That event doesn''t repeat' using errcode = '22023';
  end if;
  select * into s from public.event_series where id = v_sid and workspace_id = v_ws for update;
  select * into e from public.events where id = p_event_id and series_id = v_sid for update;
  if s.id is null or e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if not public.may_edit_events(e.created_by)
     or exists (select 1 from public.events x
                 where x.series_id = s.id and x.series_date > e.series_date
                   and not public.may_edit_events(x.created_by)) then
    raise exception 'You can''t change this event' using errcode = '42501';
  end if;
  v_today := public.workspace_today(v_ws);

  -- The occurrence as it will be.
  n := e;
  if p_patch ? 'name' then n.name := btrim(coalesce(p_patch ->> 'name', '')); end if;
  if p_patch ? 'category_id' then n.category_id := p_patch ->> 'category_id'; end if;
  if p_patch ? 'location' then n.location := p_patch ->> 'location'; end if;
  if p_patch ? 'notes' then n.notes := p_patch ->> 'notes'; end if;
  if p_patch ? 'format' then n.format := p_patch ->> 'format'; end if;
  if p_patch ? 'ticket_url' then n.ticket_url := p_patch ->> 'ticket_url'; end if;
  if p_patch ? 'date' then n.date := (p_patch ->> 'date')::date; end if;
  if p_patch ? 'end_date' then n.end_date := (p_patch ->> 'end_date')::date; end if;
  if n.name = '' or n.name is null or n.date is null then
    raise exception 'An event needs a name and a date' using errcode = '23514';
  end if;
  if n.end_date is not null and n.end_date < n.date then
    raise exception 'The end date can''t be before the start date' using errcode = '23514';
  end if;
  v_old_len := coalesce(e.end_date - e.date, 0);
  v_new_len := coalesce(n.end_date - n.date, 0);
  v_changed := array_remove(array[
    case when n.name is distinct from e.name then 'name' end,
    case when n.category_id is distinct from e.category_id then 'category_id' end,
    case when n.location is distinct from e.location then 'location' end,
    case when n.notes is distinct from e.notes then 'notes' end,
    case when n.format is distinct from e.format then 'format' end,
    case when n.ticket_url is distinct from e.ticket_url then 'ticket_url' end,
    case when n.date is distinct from e.date then 'date' end,
    case when n.end_date is distinct from e.end_date then 'end_date' end
  ]::text[], null);

  -- The rule as it will be.
  v_freq := s.freq;
  v_ends := s.ends_on;
  if p_repeat is not null and p_repeat <> 'null'::jsonb then
    if p_repeat ->> 'freq' = 'none' then
      v_stopped := true;
      v_rule_changed := true;
    else
      v_freq := p_repeat ->> 'freq';
      v_ends := (p_repeat ->> 'ends_on')::date;
      if v_freq is null or v_freq not in ('daily', 'weekly', 'biweekly', 'monthly_date', 'monthly_weekday') then
        raise exception 'Unknown repeat' using errcode = '22023';
      end if;
      v_rule_changed := v_freq is distinct from s.freq or v_ends is distinct from s.ends_on;
    end if;
  end if;
  if not v_stopped then
    if v_new_len > 0 and v_new_len + 1 >= public.series_period_days(v_freq) then
      raise exception 'A multi-day event can only repeat less often than it is long' using errcode = '22023';
    end if;
    if v_ends is not null and v_ends < n.date then
      raise exception 'The series can''t end before it starts' using errcode = '22023';
    end if;
  end if;

  v_prev := public.series_internal_begin();
  v_later := array(select x.id from public.events x
                    where x.series_id = s.id and x.series_date > e.series_date);

  -- The fields that changed move on to the later occurrences that haven't set them themselves.
  update public.events x set
    name = case when 'name' = any(v_changed) and not coalesce('name' = any(x.series_overrides), false)
                then n.name else x.name end,
    category_id = case when 'category_id' = any(v_changed) and not coalesce('category_id' = any(x.series_overrides), false)
                       then n.category_id else x.category_id end,
    location = case when 'location' = any(v_changed) and not coalesce('location' = any(x.series_overrides), false)
                    then n.location else x.location end,
    notes = case when 'notes' = any(v_changed) and not coalesce('notes' = any(x.series_overrides), false)
                 then n.notes else x.notes end,
    format = case when 'format' = any(v_changed) and not coalesce('format' = any(x.series_overrides), false)
                  then n.format else x.format end,
    ticket_url = case when 'ticket_url' = any(v_changed) and not coalesce('ticket_url' = any(x.series_overrides), false)
                      then n.ticket_url else x.ticket_url end,
    end_date = case when v_new_len <> v_old_len and not coalesce('end_date' = any(x.series_overrides), false)
                    then (case when v_new_len > 0 then x.date + v_new_len end) else x.end_date end
   where x.id = any(v_later);

  -- The occurrence itself takes everything and forgets what it had set on its own for those fields.
  update public.events set
    name = n.name, category_id = n.category_id, location = n.location, notes = n.notes,
    format = n.format, ticket_url = n.ticket_url, date = n.date, end_date = n.end_date,
    series_overrides = nullif(array(select f from unnest(coalesce(e.series_overrides, '{}'::text[])) f
                                     where f <> all(v_changed)), '{}'::text[])
   where id = e.id;

  -- What new occurrences are made from.
  update public.event_series set
    name = case when 'name' = any(v_changed) then n.name else name end,
    category_id = case when 'category_id' = any(v_changed) then n.category_id else category_id end,
    location = case when 'location' = any(v_changed) then n.location else location end,
    notes = case when 'notes' = any(v_changed) then n.notes else notes end,
    format = case when 'format' = any(v_changed) then n.format else format end,
    ticket_url = case when 'ticket_url' = any(v_changed) then n.ticket_url else ticket_url end,
    length_days = v_new_len
   where id = s.id;

  v_target := s.id;
  if (n.date is distinct from e.date) or v_rule_changed then
    -- The schedule changed: plan the later occurrences again from this one, on its (new) date.
    v_first := (e.series_date = s.starts_on);
    if v_stopped then
      update public.event_series set ends_on = e.series_date - 1 where id = s.id;
      v_target := null;
    elsif v_first then
      update public.event_series set freq = v_freq, starts_on = n.date, ends_on = v_ends where id = s.id;
    else
      insert into public.event_series
        (workspace_id, created_by, freq, starts_on, ends_on, skipped, name, category_id, location, notes,
         format, ticket_url, length_days)
      select t.workspace_id, t.created_by, v_freq, n.date, v_ends,
             array(select d from unnest(t.skipped) d where d >= e.series_date),
             t.name, t.category_id, t.location, t.notes, t.format, t.ticket_url, t.length_days
        from public.event_series t where t.id = s.id
      returning id into v_target;
      update public.event_series set ends_on = e.series_date - 1 where id = s.id;
    end if;

    -- Out of their places while they are sorted (the unique index would trip over a date that moves).
    update public.events set series_date = null where id = e.id or id = any(v_later);
    if v_target is not null then
      update public.events set series_id = v_target, series_date = n.date where id = e.id;
      v_taken := array[n.date];
    else
      update public.events set series_id = null, series_date = null, series_overrides = null where id = e.id;
    end if;
    for l in select * from public.events x where x.id = any(v_later) order by x.date, x.id loop
      if v_target is not null and not (l.date = any(v_taken))
         and public.series_is_slot(v_freq, n.date, l.date)
         and (v_ends is null or l.date <= v_ends) then
        -- Still on the new rule: stays in the series, whatever hangs off it.
        update public.events set series_id = v_target, series_date = l.date where id = l.id;
        v_taken := v_taken || l.date;
      elsif coalesce(cardinality(l.series_overrides), 0) = 0
            and not public.event_has_dependents(l.id)
            and coalesce(l.end_date, l.date) >= v_today then
        -- Untouched, empty and still ahead: the new rule makes its own.
        delete from public.events where id = l.id;
        v_removed := v_removed || l.id;
      else
        -- Kept as it is: a single event now.
        update public.events set series_id = null, series_date = null, series_overrides = null where id = l.id;
      end if;
    end loop;
    if v_target is not null then
      perform 1 from public.series_fill(v_target, v_today);
    end if;
  end if;

  v_touched := array[e.id] || v_later;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(x)) from public.events x
                         where x.id = any(v_touched) or x.series_id = v_target), '[]'::jsonb),
    'deleted', to_jsonb(v_removed),
    'series', coalesce((select jsonb_agg(to_jsonb(y)) from public.event_series y
                         where y.id = s.id or y.id = v_target), '[]'::jsonb));
end $$;
comment on function public.update_event_series_following(text, jsonb, jsonb) is
  'The "this and following events" edit of a repeating event: changes this occurrence and the later ones (and the rule, if asked), never an earlier one.';
revoke execute on function public.update_event_series_following(text, jsonb, jsonb) from public, anon;
grant execute on function public.update_event_series_following(text, jsonb, jsonb) to authenticated;

-- "This and following events" on delete: this occurrence and every later one go, and the series stops
-- just before this date. Later occurrences that are already over are history (attendance included)
-- and stay as single events; earlier ones are never touched.
create function public.delete_event_following(p_event_id text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_today date;
  v_sid text;
  s public.event_series;
  e public.events;
  x public.events;
  v_removed text[] := '{}';
  v_kept text[] := '{}';
  v_prev text;
begin
  if v_ws is null then
    raise exception 'Not signed in to a team' using errcode = '42501';
  end if;
  select series_id into v_sid from public.events where id = p_event_id and workspace_id = v_ws;
  if v_sid is null then
    raise exception 'That event doesn''t repeat' using errcode = '22023';
  end if;
  select * into s from public.event_series where id = v_sid and workspace_id = v_ws for update;
  select * into e from public.events where id = p_event_id and series_id = v_sid for update;
  if s.id is null or e.id is null then
    raise exception 'Event not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.events y
              where y.series_id = s.id and y.series_date >= e.series_date
                and not public.may_edit_events(y.created_by)) then
    raise exception 'You can''t delete this event' using errcode = '42501';
  end if;
  v_today := public.workspace_today(v_ws);

  v_prev := public.series_internal_begin();
  update public.event_series
     set ends_on = least(coalesce(ends_on, e.series_date - 1), e.series_date - 1)
   where id = s.id;
  for x in select * from public.events y where y.series_id = s.id and y.series_date >= e.series_date
            order by y.series_date for update loop
    if x.id = e.id or coalesce(x.end_date, x.date) >= v_today then
      delete from public.events where id = x.id;
      v_removed := v_removed || x.id;
    else
      update public.events set series_id = null, series_date = null, series_overrides = null where id = x.id;
      v_kept := v_kept || x.id;
    end if;
  end loop;
  perform public.series_internal_end(v_prev);
  return jsonb_build_object(
    'events', coalesce((select jsonb_agg(to_jsonb(y)) from public.events y where y.id = any(v_kept)), '[]'::jsonb),
    'deleted', to_jsonb(v_removed),
    'series', coalesce((select jsonb_agg(to_jsonb(z)) from public.event_series z where z.id = s.id), '[]'::jsonb));
end $$;
comment on function public.delete_event_following(text) is
  'Deletes a repeating event''s occurrence and every later one and stops the series there. Finished later occurrences stay as single events.';
revoke execute on function public.delete_event_following(text) from public, anon;
grant execute on function public.delete_event_following(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Merging categories moves the series along (and is not an edit of each occurrence)
-- ---------------------------------------------------------------------------

create or replace function public.merge_event_categories(p_from_id text, p_into_id text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_ws text := public.current_workspace_id();
  v_from public.event_categories;
  v_into public.event_categories;
  v_moved integer;
  v_prev text;
begin
  if not public.acts_as_leader() then
    raise exception 'Only your team''s leader and their deputies merge categories'
      using errcode = '42501';
  end if;
  select * into v_from from public.event_categories where id = p_from_id and workspace_id = v_ws;
  select * into v_into from public.event_categories where id = p_into_id and workspace_id = v_ws;
  if v_from.id is null or v_into.id is null then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  if v_from.id = v_into.id then
    raise exception 'Pick a different category to merge into' using errcode = '22023';
  end if;
  if v_into.archived_at is not null then
    raise exception 'That category is archived' using errcode = '23514';
  end if;

  v_prev := public.series_internal_begin();
  update public.events set category_id = v_into.id
   where category_id = v_from.id and workspace_id = v_ws;
  get diagnostics v_moved = row_count;
  -- Repeating events keep repeating in the category they were merged into.
  update public.event_series set category_id = v_into.id
   where category_id = v_from.id and workspace_id = v_ws;
  perform public.series_internal_end(v_prev);

  update public.event_categories set archived_at = coalesce(archived_at, now())
   where id = v_from.id;
  return v_moved;
end $$;

-- The internals are for the functions above only.
revoke execute on function public.series_nth_date(text, date, integer) from public, anon, authenticated;
revoke execute on function public.series_period_days(text) from public, anon, authenticated;
revoke execute on function public.series_is_slot(text, date, date) from public, anon, authenticated;
revoke execute on function public.series_internal_begin() from public, anon, authenticated;
revoke execute on function public.series_internal_end(text) from public, anon, authenticated;
revoke execute on function public.may_edit_events(text) from public, anon, authenticated;
revoke execute on function public.event_has_dependents(text) from public, anon, authenticated;
