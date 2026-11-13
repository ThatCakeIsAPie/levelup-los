-- Team appearance (migration 20261019000100_team_appearance): the leader chooses the
-- team's background picture, glass, logo and colours; everyone on the team reads them.
--
-- Seed facts: Maria (1) is the workspace leader; Anita (2) is a moderator; Marcus (6)
-- is Maria's deputy (a plain member); Jamal (4) and Tasha (700) are members; Beau (20)
-- is a candidate; David (3) is another IBO under Maria. A second team (w2) is created
-- below with its own leader Olivia (901).
begin;
create extension if not exists pgtap with schema extensions;
select plan(91);

create function pg_temp.login(p_person text) returns void language plpgsql as $$
declare
  v_uid uuid := ('00000000-0000-4000-8000-' || lpad(p_person, 12, '0'))::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'person' || p_person || '@demo.test')
  on conflict (id) do nothing;
  update public.members set user_id = v_uid where person_id = p_person and user_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-8000-' || lpad(p_person, 12, '0'), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.affected(p_sql text) returns integer language plpgsql as $$
declare
  n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- A second team with its own leader (901).
insert into public.workspaces (id, name) values ('w2', 'Other team');
insert into public.people (id, workspace_id, name, biz_class, business_start_date)
values ('901', 'w2', 'Olivia Other', 'ibo', current_date - 900);
insert into auth.users (instance_id, id, aud, role, email)
values ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000901',
        'authenticated', 'authenticated', 'olivia@other.test');
insert into public.members (workspace_id, person_id, user_id, role)
values ('w2', '901', '00000000-0000-4000-8000-000000000901', 'leader');

-- Schema ------------------------------------------------------------------------------
select is((select array_agg(column_name::text order by column_name)
           from information_schema.columns where table_schema = 'public' and table_name = 'workspaces'),
  array['background_mode', 'background_path', 'colors', 'created_at', 'glass', 'id', 'logo_path', 'name', 'timezone'],
  'workspaces: the look is columns on the workspace, and the old logo_url is now logo_path');
select is((select public from storage.buckets where id = 'team-appearance'), true,
  'the team-appearance bucket is public (decorative, loaded by every member on every page)');
select is((select file_size_limit from storage.buckets where id = 'team-appearance'), 1048576::bigint, 'it has a 1 MB size limit');
select is((select allowed_mime_types from storage.buckets where id = 'team-appearance'),
  array['image/png', 'image/jpeg', 'image/webp'], 'and takes only PNG, JPEG and WebP (never SVG)');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'team appearance:%' and cmd in ('UPDATE', 'ALL')), 0,
  'no update policy: a file is never replaced in place');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'team appearance:%'), 3, 'three storage policies: upload, list, remove');
select is(has_function_privilege('anon', 'public.set_workspace_appearance(text, text, boolean, text, text, text, text)', 'execute'),
  false, 'anonymous callers cannot execute set_workspace_appearance');

-- The default look ----------------------------------------------------------------------
select pg_temp.login('1');
select is((select background_mode from public.workspaces where id = 'w1'), 'default', 'a team starts with the brand''s own background');
select is((select glass is null and background_path is null and logo_path is null and colors = '{}'::jsonb
           from public.workspaces where id = 'w1'), true, 'and no glass choice, logo or colours');

-- The leader saves a look -----------------------------------------------------------------
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values
  ('team-appearance', 'w1/bg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp', auth.uid()::text),
  ('team-appearance', 'w1/logo-dddddddddddddddddddddddddddddddd.png', auth.uid()::text)$$,
  'the leader uploads a picture and a logo into their own folder');
select is(public.set_workspace_appearance('picture', 'w1/bg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp', true,
  'w1/logo-dddddddddddddddddddddddddddddddd.png', '#336699', '#ffcc00', '#101820'), '{}'::text[],
  'the leader saves the whole look (nothing old to remove)');
select is((select background_mode || ' ' || background_path from public.workspaces where id = 'w1'),
  'picture w1/bg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp', 'the picture is stored');
select is((select glass from public.workspaces where id = 'w1'), true, 'glass is stored');
select is((select logo_path from public.workspaces where id = 'w1'), 'w1/logo-dddddddddddddddddddddddddddddddd.png', 'the logo is stored');
select is((select colors from public.workspaces where id = 'w1'),
  '{"main": "#336699", "highlight": "#ffcc00", "sidebar": "#101820"}'::jsonb, 'the three colours are stored');

-- Replacing a picture returns the old file so the app can remove it -------------------------
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values
  ('team-appearance', 'w1/bg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', auth.uid()::text)$$, 'the leader uploads another picture');
select is(public.set_workspace_appearance('picture', 'w1/bg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', false,
  'w1/logo-dddddddddddddddddddddddddddddddd.png', '#336699'), array['w1/bg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'],
  'replacing the picture hands back the one no longer used');
select is((select glass from public.workspaces where id = 'w1'), false, 'glass can be turned off');
select is((select colors from public.workspaces where id = 'w1'), '{"main": "#336699"}'::jsonb,
  'a colour left out is the brand''s own again');

-- Everyone on the team reads it ------------------------------------------------------------
select pg_temp.login('4');
select is((select background_path from public.workspaces where id = 'w1'), 'w1/bg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', 'a member reads the picture');
select is((select colors->>'main' from public.workspaces where id = 'w1'), '#336699', 'and the colours');
select pg_temp.login('20');
select is((select logo_path from public.workspaces where id = 'w1'), 'w1/logo-dddddddddddddddddddddddddddddddd.png', 'a candidate reads the look too');
select pg_temp.login('6');
select is((select glass from public.workspaces where id = 'w1'), false, 'and a deputy');

-- Nobody else changes it ------------------------------------------------------------------
select pg_temp.login('2');
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'a moderator cannot');
select pg_temp.login('6');
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'a deputy cannot');
select pg_temp.login('4');
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'a member cannot');
select pg_temp.login('3');
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'another IBO on the team (a crossline from the leader''s side) cannot');
select pg_temp.login('20');
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'a candidate cannot');
select pg_temp.anon();
select throws_ok($$select public.set_workspace_appearance('none')$$, '42501', null, 'a signed-out caller cannot');
select pg_temp.login('901');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg')$$,
  '22023', null, 'another team''s leader cannot point at this team''s picture');
select lives_ok($$select public.set_workspace_appearance('none', null, false, null, '#112233')$$,
  'another team''s leader changes only their own team');
select pg_temp.logout();
select is((select background_mode || ' ' || colors::text from public.workspaces where id = 'w1'),
  'picture {"main": "#336699"}', 'and this team''s look did not move');
select is((select background_mode || ' ' || colors::text from public.workspaces where id = 'w2'),
  'none {"main": "#112233"}', 'while theirs did');

-- Direct writes are closed ------------------------------------------------------------------
select pg_temp.login('1');
select throws_ok($$update public.workspaces set background_mode = 'none' where id = 'w1'$$, '42501', null, 'the leader cannot update the background directly');
select throws_ok($$update public.workspaces set colors = '{"main": "#000000"}' where id = 'w1'$$, '42501', null, 'nor the colours');
select throws_ok($$update public.workspaces set glass = true where id = 'w1'$$, '42501', null, 'nor glass');
select throws_ok($$update public.workspaces set logo_path = null where id = 'w1'$$, '42501', null, 'nor the logo');
select throws_ok($$update public.workspaces set background_path = 'w1/bg-cccccccccccccccccccccccccccccccc.webp' where id = 'w1'$$, '42501', null, 'nor the picture path');
select is(pg_temp.affected($$update public.workspaces set name = 'Demo Team' where id = 'w1'$$), 1, 'the leader still renames the team');
select pg_temp.login('4');
select is(pg_temp.affected($$update public.workspaces set name = 'Mine' where id = 'w1'$$), 0, 'a member cannot even do that');
select pg_temp.logout();

-- What the function refuses ----------------------------------------------------------------
select pg_temp.login('1');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values
  ('team-appearance', 'w1/bg-cccccccccccccccccccccccccccccccc.webp', auth.uid()::text)$$, 'one more picture to test with');
select throws_ok($$select public.set_workspace_appearance('wallpaper')$$, '22023', null, 'an unknown background mode');
select throws_ok($$select public.set_workspace_appearance(null)$$, '22023', null, 'a null mode');
select throws_ok($$select public.set_workspace_appearance('picture')$$, '22023', null, 'the picture mode needs a picture');
select throws_ok($$select public.set_workspace_appearance('none', 'w1/bg-cccccccccccccccccccccccccccccccc.webp')$$, '22023', null, 'a picture without the picture mode');
select throws_ok($$select public.set_workspace_appearance('picture', 'w2/bg-cccccccccccccccccccccccccccccccc.webp')$$, '22023', null, 'a picture in another team''s folder');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/../w2/bg-cccccccccccccccccccccccccccccccc.webp')$$, '22023', null, 'path traversal');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-cccccccccccccccccccccccccccccccc.svg')$$, '22023', null, 'an SVG');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-cccccccccccccccccccccccccccccccc.png')$$, '22023', null, 'a background in the logo''s type (png)');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-cccccccccccccccccccccccccccccccc.webp.svg')$$, '22023', null, 'a double extension');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC.webp')$$, '22023', null, 'upper-case hex');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-ccc.webp')$$, '22023', null, 'a short file name');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/photo.webp')$$, '22023', null, 'a file name that was not generated');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/sub/bg-cccccccccccccccccccccccccccccccc.webp')$$, '22023', null, 'a sub-folder');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-cccccccccccccccccccccccccccccccc.webp"); background:url(x')$$, '22023', null, 'a path carrying CSS');
select throws_ok($$select public.set_workspace_appearance('none', null, null, 'w1/logo-dddddddddddddddddddddddddddddddd.jpg')$$, '22023', null, 'a logo as a jpg');
select throws_ok($$select public.set_workspace_appearance('none', null, null, 'w1/bg-cccccccccccccccccccccccccccccccc.webp')$$, '22023', null, 'a background used as the logo');
select throws_ok($$select public.set_workspace_appearance('none', null, null, null, 'red')$$, '22023', null, 'a colour name');
select throws_ok($$select public.set_workspace_appearance('none', null, null, null, '#FFF')$$, '22023', null, 'a short colour');
select throws_ok($$select public.set_workspace_appearance('none', null, null, null, '#FFFFFF')$$, '22023', null, 'an upper-case colour');
select throws_ok($$select public.set_workspace_appearance('none', null, null, null, null, 'red;background:url(x)')$$, '22023', null, 'a colour carrying CSS');
select throws_ok($$select public.set_workspace_appearance('none', null, null, null, null, null, '#12345g')$$, '22023', null, 'a colour with a bad digit');
select throws_ok($$select public.set_workspace_appearance('picture', 'w1/bg-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.webp')$$, 'P0002', null, 'a well-formed path of a file nobody uploaded');
select is((select background_mode from public.workspaces where id = 'w1'), 'picture', 'after all those refusals the look is untouched');
select pg_temp.logout();

-- The constraints say the same on their own -------------------------------------------------
select throws_ok($$update public.workspaces set colors = '{"main": "red"}' where id = 'w1'$$, '23514', null, 'constraint: a colour name');
select throws_ok($$update public.workspaces set colors = '{"navy": "#1a365d"}' where id = 'w1'$$, '23514', null, 'constraint: only the three colour keys');
select throws_ok($$update public.workspaces set colors = '[]' where id = 'w1'$$, '23514', null, 'constraint: colours are an object');
select throws_ok($$update public.workspaces set background_mode = 'picture', background_path = null where id = 'w2'$$, '23514', null, 'constraint: picture needs a path');
select throws_ok($$update public.workspaces set background_mode = 'none', background_path = 'w2/bg-cccccccccccccccccccccccccccccccc.webp' where id = 'w2'$$, '23514', null, 'constraint: a path needs the picture mode');
select throws_ok($$update public.workspaces set background_mode = 'picture', background_path = 'w1/bg-cccccccccccccccccccccccccccccccc.webp' where id = 'w2'$$, '23514', null, 'constraint: the path is in the workspace''s own folder');
select throws_ok($$update public.workspaces set logo_path = 'https://example.com/x.png' where id = 'w2'$$, '23514', null, 'constraint: a logo is a path, not a URL');

-- Storage policies ----------------------------------------------------------------------------
select pg_temp.login('1');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w2/bg-cccccccccccccccccccccccccccccccc.webp', auth.uid()::text)$$,
  '42501', null, 'the leader cannot upload into another team''s folder');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/holiday.png', auth.uid()::text)$$,
  '42501', null, 'nor with a file name that is not generated');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/bg-cccccccccccccccccccccccccccccccc.svg', auth.uid()::text)$$,
  '42501', null, 'nor an svg');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'bg-cccccccccccccccccccccccccccccccc.webp', auth.uid()::text)$$,
  '42501', null, 'nor outside a folder');
select is((select count(*)::int from storage.objects where bucket_id = 'team-appearance'), 4, 'the leader lists their own folder (4 files)');
select pg_temp.login('4');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/bg-ffffffffffffffffffffffffffffffff.webp', auth.uid()::text)$$,
  '42501', null, 'a member cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'team-appearance'), 0, 'and cannot list the bucket (the pictures load by their public URL)');
select pg_temp.login('6');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/bg-ffffffffffffffffffffffffffffffff.webp', auth.uid()::text)$$,
  '42501', null, 'a deputy cannot upload');
select pg_temp.login('2');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/logo-ffffffffffffffffffffffffffffffff.png', auth.uid()::text)$$,
  '42501', null, 'a moderator cannot upload');
select pg_temp.login('20');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/logo-ffffffffffffffffffffffffffffffff.png', auth.uid()::text)$$,
  '42501', null, 'a candidate cannot upload');
select pg_temp.login('901');
select throws_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w1/bg-ffffffffffffffffffffffffffffffff.webp', auth.uid()::text)$$,
  '42501', null, 'another team''s leader cannot upload into this team''s folder');
select lives_ok($$insert into storage.objects (bucket_id, name, owner_id) values ('team-appearance', 'w2/logo-ffffffffffffffffffffffffffffffff.png', auth.uid()::text)$$,
  'but does upload into their own');
select is((select count(*)::int from storage.objects where bucket_id = 'team-appearance'), 1, 'and lists only their own folder');
select pg_temp.anon();
select throws_ok($$insert into storage.objects (bucket_id, name) values ('team-appearance', 'w1/bg-ffffffffffffffffffffffffffffffff.webp')$$,
  '42501', null, 'a signed-out caller cannot upload');
select is((select count(*)::int from storage.objects where bucket_id = 'team-appearance'), 0, 'or list');

-- Removing -----------------------------------------------------------------------------------
select pg_temp.login('4');
select is(pg_temp.affected($$delete from storage.objects where bucket_id = 'team-appearance'$$), 0, 'a member removes nothing');
select pg_temp.login('901');
select is(pg_temp.affected($$delete from storage.objects where bucket_id = 'team-appearance' and name like 'w1/%'$$), 0, 'another team''s leader removes nothing of this team''s');
select pg_temp.login('1');
select set_config('storage.allow_delete_query', 'true', true);
select is(pg_temp.affected($$delete from storage.objects where bucket_id = 'team-appearance' and name = 'w1/bg-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp'$$), 1, 'the leader removes a file no longer used');

-- Reset -----------------------------------------------------------------------------------------
select is(public.set_workspace_appearance(), array['w1/bg-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg', 'w1/logo-dddddddddddddddddddddddddddddddd.png'],
  'reset to default hands back every file the team had');
select pg_temp.logout();
select is((select background_mode = 'default' and background_path is null and glass is null and logo_path is null and colors = '{}'::jsonb
           from public.workspaces where id = 'w1'), true, 'and the look is the default again');

select * from finish();
rollback;
