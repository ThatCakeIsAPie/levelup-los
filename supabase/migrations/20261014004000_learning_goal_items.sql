-- The weekly goal as a list (client: src/data/weeklyGoal.ts, LearningGoal.items).
--
--  * learning_goals.items: the goal's items in order, each
--    {"kind": text, "target": whole number >= 1, "unit"?: text}. A kind is
--    in the list at most once. Kinds are lower_snake_case names the app
--    defines (reading, podcasts, workshops, contacts, new_customers, pv,
--    events, first_meetings today); the shape is checked here so a new kind
--    needs no migration. Reading is counted in pages, chapters or minutes,
--    podcasts in episodes or minutes; other kinds have no unit.
--  * Null items = the goal from before lists: reading, podcasts and workshops
--    from pages / podcasts / workshops and reading_unit / podcast_unit, a 0
--    target left out. Clients that write items keep those columns in step
--    (each target, or 0 when the goal doesn't have it, and the units), so
--    older clients still read something sensible.

create function public.learning_goal_items_valid(p_items jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_item jsonb;
  v_kind text;
  v_unit jsonb;
  v_target numeric;
  v_seen text[] := '{}';
begin
  if p_items is null then
    return true;
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item -> 'kind') is distinct from 'string'
       or jsonb_typeof(v_item -> 'target') is distinct from 'number'
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('kind', 'target', 'unit'))
    then
      return false;
    end if;
    v_kind := v_item ->> 'kind';
    v_target := (v_item ->> 'target')::numeric;
    v_unit := v_item -> 'unit';
    if v_kind !~ '^[a-z][a-z_]{0,39}$'
       or v_kind = any (v_seen)
       or v_target <> trunc(v_target)
       or v_target < 1
       or v_target > 100000
    then
      return false;
    end if;
    if v_unit is not null and jsonb_typeof(v_unit) <> 'null' then
      if not (
        (v_kind = 'reading' and v_unit in ('"pages"', '"chapters"', '"minutes"'))
        or (v_kind = 'podcasts' and v_unit in ('"episodes"', '"minutes"'))
      ) then
        return false;
      end if;
    end if;
    v_seen := v_seen || v_kind;
  end loop;
  return true;
end $$;

comment on function public.learning_goal_items_valid(jsonb) is
  'learning_goals.items shape: an array of at most 20 {kind, target, unit?}, kinds unique, '
  'targets whole numbers 1..100000, units only for reading and podcasts.';

alter table public.learning_goals
  add column items jsonb,
  add constraint learning_goals_items_valid check (public.learning_goal_items_valid(items));
