-- Home's card layout, per person (client: src/data/homeLayout.ts, store
-- `homeLayouts`, binding `homeLayoutBinding`).
--
-- People rearrange the cards on Home (drag on desktop, "Edit layout" on
-- phones) and the layout follows them to every device. One row per person:
--
--  * layout = {"order": [card id, ...], "side": [card id, ...]}: every card in
--    order (phones show them in this order), and the cards in the right-hand
--    column on desktop. Card ids are the app's ("today", "team", "myDay", ...);
--    only their shape is checked here, so a new card needs no migration. The
--    app keeps ids it doesn't know (a newer client's), appends cards missing
--    from the list in their default place, and skips cards the person can't
--    see right now.
--  * No row = the default layout. "Reset layout" deletes the row.
--
-- Only the person reads or writes their own row.

create function public.dashboard_layout_valid(p_layout jsonb)
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
    if v_key not in ('order', 'side') then
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
  'dashboard_layouts.layout shape: an object with only "order" and "side", each an array of at '
  'most 50 distinct card ids (a letter, then letters, digits, _ or -, at most 40 characters).';

create table public.dashboard_layouts (
  person_id text primary key default public.current_person_id()
    references public.people (id) on delete cascade,
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  layout jsonb not null default '{"order": [], "side": []}'::jsonb
    constraint dashboard_layouts_layout_valid check (public.dashboard_layout_valid(layout)),
  updated_at timestamptz not null default now()
);
comment on table public.dashboard_layouts is
  'How each person arranged the cards on Home (order, and the desktop right-hand column); no row = the default.';

create trigger dashboard_layouts_touch before update on public.dashboard_layouts
  for each row execute function public.touch_updated_at();

alter table public.dashboard_layouts enable row level security;

create policy "own dashboard layout" on public.dashboard_layouts
  for all to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()))
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id()));

grant select, insert, update, delete on public.dashboard_layouts to authenticated;
