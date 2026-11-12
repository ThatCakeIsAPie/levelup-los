-- In-app feedback: the "Feedback" button in the sidebar (client:
-- src/data/feedback, src/components/feedback, admin page at /settings/feedback).
--
-- A signed-in person describes a change they want and the app sends it with a
-- snapshot of the page they were looking at:
--
--  * public.feedback: one row per report. `message` is what they typed (1 to
--    2000 characters), `context` is a small JSON object the app fills in (page
--    path and search, page title, viewport, theme, user agent, brand slug, app
--    version, client time, sender name), `screenshot_path` is the object in the
--    `feedback` bucket (or null when the person removed the snapshot).
--  * storage bucket `feedback` (private): the snapshot, "<workspace_id>/<feedback_id>.jpg".
--
-- Who can do what:
--  * Any member inserts a report for themselves in their own workspace
--    (person_id and workspace_id must be theirs) and uploads the image into
--    their workspace's folder. They cannot set the status.
--  * The sender reads their own reports and images; nobody else on the team does.
--  * App admins (`app_admins`) read every report and image, in every
--    workspace, and change only `status` ('new' or 'done').
--  * Nobody deletes or edits a report's text; no policy or grant allows it.

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default public.current_workspace_id()
    references public.workspaces (id) on delete cascade,
  -- The sender. Set null if their person row is deleted; the report stays.
  person_id text default public.current_person_id()
    references public.people (id) on delete set null,
  message text not null
    constraint feedback_message_length check (char_length(btrim(message)) between 1 and 2000),
  context jsonb not null default '{}'::jsonb
    constraint feedback_context_object check (jsonb_typeof(context) = 'object')
    constraint feedback_context_size check (octet_length(context::text) <= 8000),
  screenshot_path text
    constraint feedback_screenshot_in_workspace
      check (screenshot_path is null or starts_with(screenshot_path, workspace_id || '/')),
  status text not null default 'new'
    constraint feedback_status_valid check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);
comment on table public.feedback is
  'Change requests people send from the app, with a snapshot of the page (bucket `feedback`). Senders read their own; app admins read all and set status.';

create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_person_idx on public.feedback (person_id);

alter table public.feedback enable row level security;

-- Send: a member, as themselves, in their own workspace.
create policy "members send their own feedback" on public.feedback
  for insert to authenticated
  with check (workspace_id = (select public.current_workspace_id())
              and person_id = (select public.current_person_id()));

-- Read: your own reports, or everything when you are an app admin.
create policy "senders read their own feedback" on public.feedback
  for select to authenticated
  using (workspace_id = (select public.current_workspace_id())
         and person_id = (select public.current_person_id()));

create policy "app admins read all feedback" on public.feedback
  for select to authenticated
  using ((select public.is_app_admin()));

-- Triage: app admins flip the status (the column grant below limits the update to it).
create policy "app admins set feedback status" on public.feedback
  for update to authenticated
  using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

revoke all on public.feedback from public, anon, authenticated;
grant select on public.feedback to authenticated;
grant insert (id, workspace_id, person_id, message, context, screenshot_path)
  on public.feedback to authenticated;
grant update (status) on public.feedback to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: private `feedback` bucket, "<workspace_id>/<feedback_id>.jpg"
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback', 'feedback', false, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- Upload: any member, into their workspace's folder.
create policy "feedback: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback'
              and (storage.foldername(name))[1] = (select public.current_workspace_id()));

-- Read: the uploader, and app admins.
create policy "feedback: sender or admin reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback'
         and (owner_id = (select auth.uid())::text
              or (select public.is_app_admin())));

-- No update or delete policy: images are never replaced or removed by clients.
