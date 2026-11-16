-- Home's card layout: people can hide cards (client: src/data/homeLayout.ts).
--
-- Home's edit mode lets each person hide the cards they don't want and bring
-- them back later. The layout gains an optional third list:
--
--  * layout = {"order": [...], "side": [...], "hidden": [card id, ...]}:
--    "hidden" holds the cards the person hid. A hidden card keeps its place
--    in "order" (and "side"), so showing it again puts it back where it was.
--    Absent = nothing hidden: layouts saved before this migration stay valid
--    and load unchanged.
--
-- The only change is dashboard_layout_valid(jsonb), which accepted just
-- "order" and "side": it now also accepts "hidden" under the same rules as
-- the other two lists (an array of at most 50 distinct card ids, each a letter
-- then letters, digits, _ or -, at most 40 characters). Any other key is still
-- refused. create or replace keeps the function's owner, grants and the table
-- constraint that calls it; nothing else changes (the table, its row-level
-- security and its grants are as before).

create or replace function public.dashboard_layout_valid(p_layout jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_list jsonb;
  v_id jsonb;
begin
  if p_layout is null or jsonb_typeof(p_layout) <> 'object' then
    return false;
  end if;
  for v_key in select jsonb_object_keys(p_layout) loop
    if v_key not in ('order', 'side', 'hidden') then
      return false;
    end if;
    v_list := p_layout -> v_key;
    if jsonb_typeof(v_list) <> 'array' or jsonb_array_length(v_list) > 50 then
      return false;
    end if;
    for v_id in select value from jsonb_array_elements(v_list) loop
      if jsonb_typeof(v_id) <> 'string' or (v_id #>> '{}') !~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$' then
        return false;
      end if;
    end loop;
    if (select count(distinct value) from jsonb_array_elements(v_list)) <> jsonb_array_length(v_list) then
      return false;
    end if;
  end loop;
  return true;
end $$;

comment on function public.dashboard_layout_valid(jsonb) is
  'dashboard_layouts.layout shape: an object with only "order", "side" and (optional) "hidden", each an '
  'array of at most 50 distinct card ids (a letter, then letters, digits, _ or -, at most 40 characters).';
