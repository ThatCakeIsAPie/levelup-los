-- Team appearance: the team's leader chooses the background picture, glass on or
-- off, the logo and three colours for the whole team (client: Settings > Team >
-- Appearance, src/data/teamLook, src/lib/teamLook.ts).
--
-- Where the choices live: the `workspaces` row, one typed column per choice.
--   background_mode  'default' (the brand's own picture), 'none' or 'picture'
--   background_path  the picture in the `team-appearance` bucket; set exactly when the mode is 'picture'
--   glass            true / false; null = the brand's own. Only meaningful over a picture
--   logo_path        the logo in the same bucket (was `logo_url`, which nothing used)
--   colors           {"main": "#rrggbb", "highlight": ..., "sidebar": ...}, any subset (was an unused palette)
-- The old `logo_url` held URLs nobody wrote and `colors` an unused example
-- palette; both are cleared here (the demo seed no longer writes them) and
-- take their new meaning, so no column is left half used.
--
-- Who can do what:
--  * Every member of the workspace reads the columns (they need them to render
--    the app); nobody outside the workspace, and nobody signed out, does.
--  * Nobody writes them directly: UPDATE on `workspaces` is limited to `name`
--    and `timezone` by a column grant. The only way is set_workspace_appearance(),
--    SECURITY DEFINER with an empty search_path, which checks that the caller is
--    the workspace LEADER (not a deputy, moderator or member) and validates
--    every value; the check constraints below say the same again.
--  * Pictures: public bucket `team-appearance`, `<workspace id>/(bg|logo)-<32 hex>.<ext>`.
--    Only the leader uploads, lists and removes, in their own workspace folder.

-- Old, unused values would not pass the new checks.
update public.workspaces set colors = '{}'::jsonb where colors <> '{}'::jsonb;
update public.workspaces set logo_url = null where logo_url is not null;

alter table public.workspaces rename column logo_url to logo_path;

-- ---------------------------------------------------------------------------
-- Value rules (immutable, so check constraints and the function share them)
-- ---------------------------------------------------------------------------

-- `<workspace id>/<file>` where the file name is generated: bg-<32 hex>.webp|jpg or logo-<32 hex>.png|webp.
-- No other folder, no traversal, no other extension (never svg).
create function public.team_look_path_ok(p_workspace text, p_path text, p_kind text)
returns boolean
language sql immutable parallel safe set search_path = ''
as $fn$
  select p_path is not null
    and p_kind in ('bg', 'logo')
    and p_workspace ~ '^[A-Za-z0-9_-]{1,64}$'
    and starts_with(p_path, p_workspace || '/')
    and substr(p_path, length(p_workspace) + 2) ~
      (case p_kind
         when 'bg' then '^bg-[0-9a-f]{32}\.(webp|jpg)$'
         else '^logo-[0-9a-f]{32}\.(png|webp)$'
       end)
$fn$;

-- An object with only the keys main, highlight and sidebar, each a lower-case #rrggbb.
create function public.team_colors_valid(p_colors jsonb)
returns boolean
language sql immutable parallel safe set search_path = ''
as $fn$
  select p_colors is not null
    and jsonb_typeof(p_colors) = 'object'
    and (p_colors - 'main' - 'highlight' - 'sidebar') = '{}'::jsonb
    and not exists (
      select 1 from jsonb_each(p_colors) e
      where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') !~ '^#[0-9a-f]{6}$'
    )
$fn$;

alter table public.workspaces
  add column background_mode text not null default 'default',
  add column background_path text,
  add column glass boolean;

alter table public.workspaces
  add constraint workspaces_background_mode_valid
    check (background_mode in ('default', 'none', 'picture')),
  add constraint workspaces_background_path_valid
    check ((background_mode = 'picture') = (background_path is not null)
           and (background_path is null or public.team_look_path_ok(id, background_path, 'bg'))),
  add constraint workspaces_logo_path_valid
    check (logo_path is null or public.team_look_path_ok(id, logo_path, 'logo')),
  add constraint workspaces_colors_valid
    check (public.team_colors_valid(colors));

comment on column public.workspaces.background_mode is
  'Team background: default (the brand''s own picture), none, or picture (background_path). Written only by set_workspace_appearance().';
comment on column public.workspaces.background_path is
  'The team''s own background picture in the public team-appearance bucket, set exactly when background_mode is picture.';
comment on column public.workspaces.glass is
  'Glass look over the picture: true, false, or null for the brand''s own.';
comment on column public.workspaces.logo_path is
  'The team''s logo in the public team-appearance bucket; null shows the brand''s mark.';
comment on column public.workspaces.colors is
  'The team''s own colours {"main","highlight","sidebar"} as lower-case #rrggbb (any subset); {} = the brand''s own. The app derives every readable variant from them.';
comment on table public.workspaces is
  'A team. Its name, timezone and look (background, glass, logo, colors); the look is written only by set_workspace_appearance().';

-- No direct writes to the look: leaders keep UPDATE on name and timezone only.
revoke update on public.workspaces from public, anon, authenticated;
grant update (name, timezone) on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- set_workspace_appearance(): the only way to change the look
-- ---------------------------------------------------------------------------
-- Replaces the whole look (an argument left out is "default": calling it with
-- no arguments resets everything). Returns the picture paths the team no longer
-- uses, so the client can remove those files from the bucket.
-- Errors: 42501 not the leader, 22023 a value is not allowed, P0002 the file is not in the bucket.
create function public.set_workspace_appearance(
  p_background text default 'default',
  p_background_path text default null,
  p_glass boolean default null,
  p_logo_path text default null,
  p_main text default null,
  p_highlight text default null,
  p_sidebar text default null
) returns text[]
language plpgsql security definer set search_path = ''
as $fn$
declare
  v_ws text := public.current_workspace_id();
  v_old public.workspaces%rowtype;
  v_colors jsonb := '{}'::jsonb;
begin
  if auth.uid() is null or v_ws is null or not public.is_leader() then
    raise exception 'Only the team leader can change the team look.' using errcode = '42501';
  end if;
  if p_background is null or p_background not in ('default', 'none', 'picture') then
    raise exception 'Background must be default, none or picture.' using errcode = '22023';
  end if;
  if (p_background = 'picture') <> (p_background_path is not null) then
    raise exception 'A picture background needs a picture, and only then.' using errcode = '22023';
  end if;
  if p_background_path is not null and not public.team_look_path_ok(v_ws, p_background_path, 'bg') then
    raise exception 'That background picture path is not allowed.' using errcode = '22023';
  end if;
  if p_logo_path is not null and not public.team_look_path_ok(v_ws, p_logo_path, 'logo') then
    raise exception 'That logo path is not allowed.' using errcode = '22023';
  end if;
  if p_main is not null then
    if p_main !~ '^#[0-9a-f]{6}$' then
      raise exception 'Main must be a colour like #336699.' using errcode = '22023';
    end if;
    v_colors := v_colors || jsonb_build_object('main', p_main);
  end if;
  if p_highlight is not null then
    if p_highlight !~ '^#[0-9a-f]{6}$' then
      raise exception 'Highlight must be a colour like #336699.' using errcode = '22023';
    end if;
    v_colors := v_colors || jsonb_build_object('highlight', p_highlight);
  end if;
  if p_sidebar is not null then
    if p_sidebar !~ '^#[0-9a-f]{6}$' then
      raise exception 'Sidebar must be a colour like #336699.' using errcode = '22023';
    end if;
    v_colors := v_colors || jsonb_build_object('sidebar', p_sidebar);
  end if;
  -- A path must be a file that was uploaded (by the leader: only they may insert into the folder).
  if p_background_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'team-appearance' and o.name = p_background_path
  ) then
    raise exception 'The background picture was not uploaded.' using errcode = 'P0002';
  end if;
  if p_logo_path is not null and not exists (
    select 1 from storage.objects o where o.bucket_id = 'team-appearance' and o.name = p_logo_path
  ) then
    raise exception 'The logo was not uploaded.' using errcode = 'P0002';
  end if;

  select * into v_old from public.workspaces where id = v_ws for update;
  update public.workspaces
     set background_mode = p_background,
         background_path = p_background_path,
         glass = p_glass,
         logo_path = p_logo_path,
         colors = v_colors
   where id = v_ws;

  return array(
    select distinct p
    from unnest(array[v_old.background_path, v_old.logo_path]) as p
    where p is not null
      and p is distinct from p_background_path
      and p is distinct from p_logo_path
  );
end
$fn$;

revoke execute on function public.set_workspace_appearance(text, text, boolean, text, text, text, text)
  from public, anon;
grant execute on function public.set_workspace_appearance(text, text, boolean, text, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: the `team-appearance` bucket
-- ---------------------------------------------------------------------------
-- PUBLIC on purpose. These are decorative pictures that every member's browser
-- loads on every page, as a CSS background and an <img>, and the look is painted
-- from a local cache before any data arrives: a signed URL would expire under
-- that cache and would have to be renewed by a timer. A public URL never
-- changes, caches for good, and cannot be listed or guessed: the path is the
-- workspace id plus a random 128-bit file name, only the leader can list the
-- folder (the policies below), and a replaced or reset picture is deleted.
-- Size limit 1 MB (the app shrinks to about 600 KB / 200 KB first); PNG, JPEG, WebP only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-appearance', 'team-appearance', true, 1048576,
        array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Upload: the leader, into their own workspace's folder, with a generated file name.
create policy "team appearance: leader uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'team-appearance'
              and (select public.is_leader())
              and (storage.foldername(name))[1] = (select public.current_workspace_id())
              and (public.team_look_path_ok((select public.current_workspace_id()), name, 'bg')
                   or public.team_look_path_ok((select public.current_workspace_id()), name, 'logo')));

-- List and remove: the leader, their own folder only. Everyone else reads a picture
-- through its public URL and cannot list the bucket.
create policy "team appearance: leader lists" on storage.objects
  for select to authenticated
  using (bucket_id = 'team-appearance'
         and (select public.is_leader())
         and (storage.foldername(name))[1] = (select public.current_workspace_id()));

create policy "team appearance: leader removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'team-appearance'
         and (select public.is_leader())
         and (storage.foldername(name))[1] = (select public.current_workspace_id()));

-- No update policy: file names are never reused, a new picture is a new file.
