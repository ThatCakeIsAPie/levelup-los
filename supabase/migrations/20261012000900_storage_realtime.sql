-- Storage buckets and realtime publication.

-- chat-media (private): images, voice notes and files of chat messages.
-- Object paths start with the conversation id: "<conversation_id>/<message_id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 26214400,
        array['image/*', 'audio/*', 'video/*', 'application/pdf', 'text/plain'])
on conflict (id) do nothing;

-- library (private): our own audio talks, videos and documents.
-- Object paths start with the workspace id: "<workspace_id>/...".
insert into storage.buckets (id, name, public, file_size_limit)
values ('library', 'library', false, 52428800)
on conflict (id) do nothing;

-- chat-media: members of the conversation read and upload; the uploader or a
-- conversation moderator removes.
create policy "chat media: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-media'
         and (storage.foldername(name))[1] in (select public.my_conversation_ids()));

create policy "chat media: members upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-media'
              and (storage.foldername(name))[1] in (select public.my_conversation_ids()));

create policy "chat media: uploader or moderator removes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'chat-media'
         and (storage.foldername(name))[1] in (select public.my_conversation_ids())
         and (owner_id = (select auth.uid())::text
              or public.can_moderate_conversation((storage.foldername(name))[1])));

-- library: every workspace member reads; leaders and moderators write.
create policy "library: members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'library'
         and (storage.foldername(name))[1] = (select public.current_workspace_id()));

create policy "library: moderators upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'library'
              and (storage.foldername(name))[1] = (select public.current_workspace_id())
              and (select public.is_moderator_or_leader()));

create policy "library: moderators update" on storage.objects
  for update to authenticated
  using (bucket_id = 'library'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())
         and (select public.is_moderator_or_leader()))
  with check (bucket_id = 'library'
              and (storage.foldername(name))[1] = (select public.current_workspace_id()));

create policy "library: moderators remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'library'
         and (storage.foldername(name))[1] = (select public.current_workspace_id())
         and (select public.is_moderator_or_leader()));

-- Realtime: postgres_changes for these tables (RLS applies per subscriber).
alter publication supabase_realtime add table
  public.messages,
  public.reactions,
  public.notifications,
  public.conversation_members,
  public.announcement_drafts;
