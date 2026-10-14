/**
 * Chat media in Supabase Storage ("supabase" mode): the private `chat-media`
 * bucket. Object paths start with the conversation id, which is what the
 * storage policies check: `<conversation_id>/<uuid>.<ext>`. Files are read
 * through short-lived signed URLs (cached until shortly before they expire).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CHAT_MEDIA_BUCKET = "chat-media";
/** Signed URLs live this long (seconds) and are renewed a minute early. */
export const SIGNED_URL_TTL = 60 * 60;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/** File extension for a MIME type ("audio/webm;codecs=opus" -> "webm"). */
export function extensionFor(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT[base] ?? base.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin";
}

/** Object path for a new file in a conversation. */
export function mediaPath(conversationId: string, mime: string, id = crypto.randomUUID()): string {
  return `${conversationId}/${id}.${extensionFor(mime)}`;
}

/** Upload a file into a conversation's folder; returns its storage path. */
export async function uploadMedia(
  client: SupabaseClient,
  conversationId: string,
  blob: Blob,
  mime = blob.type || "application/octet-stream",
): Promise<string> {
  const path = mediaPath(conversationId, mime);
  const { error } = await client.storage.from(CHAT_MEDIA_BUCKET).upload(path, blob, {
    contentType: mime.split(";")[0],
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return path;
}

/** A signed URL for a stored file (null when it's gone or not allowed). */
export async function signedUrl(
  client: SupabaseClient,
  path: string,
  ttl = SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await client.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path, ttl);
  return error || !data ? null : data.signedUrl;
}

/** Download a stored file (null when it's gone or not allowed). */
export async function downloadMedia(client: SupabaseClient, path: string): Promise<Blob | null> {
  const { data, error } = await client.storage.from(CHAT_MEDIA_BUCKET).download(path);
  return error ? null : data;
}

/** Remove a stored file (uploader or chat moderator); errors are ignored. */
export async function removeMedia(client: SupabaseClient, path: string): Promise<void> {
  await client.storage
    .from(CHAT_MEDIA_BUCKET)
    .remove([path])
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Library files: the private `library` bucket. Paths are
// `<workspace_id>/<item_id>/<uuid>.<ext>`; the storage policies let people
// read the files of items they can see (src/data/library/files.ts).
// ---------------------------------------------------------------------------

export const LIBRARY_BUCKET = "library";

/** Upload a library file for an item; returns its storage path. */
export async function uploadLibraryMedia(
  client: SupabaseClient,
  workspaceId: string,
  itemId: string,
  blob: Blob,
  mime = blob.type || "application/octet-stream",
): Promise<string> {
  const path = `${workspaceId}/${itemId}/${crypto.randomUUID()}.${extensionFor(mime)}`;
  const { error } = await client.storage.from(LIBRARY_BUCKET).upload(path, blob, {
    contentType: mime.split(";")[0],
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
  return path;
}

/** A signed URL for a library file (null when it's gone or not allowed). */
export async function librarySignedUrl(
  client: SupabaseClient,
  path: string,
  ttl = SIGNED_URL_TTL,
): Promise<string | null> {
  const { data, error } = await client.storage.from(LIBRARY_BUCKET).createSignedUrl(path, ttl);
  return error || !data ? null : data.signedUrl;
}

/** Remove a library file (uploader or editor); errors are ignored. */
export async function removeLibraryMedia(client: SupabaseClient, path: string): Promise<void> {
  await client.storage
    .from(LIBRARY_BUCKET)
    .remove([path])
    .catch(() => undefined);
}
