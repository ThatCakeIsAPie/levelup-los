/**
 * Feedback with real accounts: a row in `feedback` and, when there is a
 * snapshot, an object in the private `feedback` bucket at
 * "<workspace_id>/<feedback_id>.jpg" (uploaded first, so a report never points
 * at a missing image; a retry of the same report reuses the upload). Read
 * back through signed URLs. Senders read their own reports, app admins read
 * all (migration 20261016002500_feedback).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { SIGNED_URL_TTL } from "@/data/remote/storage";
import { reportFromRow, type FeedbackRow } from "./rules";
import { type FeedbackContext, type FeedbackReport, type FeedbackStatus } from "./types";

export const FEEDBACK_BUCKET = "feedback";

/** Uploads already done in this tab, by report id (a failed insert is retried without re-uploading). */
const uploaded = new Map<string, string>();

export async function sendRemoteReport(
  client: SupabaseClient,
  input: {
    id: string;
    workspaceId: string;
    message: string;
    context: FeedbackContext;
    image: Blob | null;
  },
): Promise<void> {
  let path: string | null = null;
  if (input.image) {
    path = uploaded.get(input.id) ?? `${input.workspaceId}/${input.id}.jpg`;
    if (!uploaded.has(input.id)) {
      const { error } = await client.storage.from(FEEDBACK_BUCKET).upload(path, input.image, {
        contentType: "image/jpeg",
        upsert: false,
      });
      if (error) throw new Error(error.message);
      uploaded.set(input.id, path);
    }
  }
  const { error } = await client.from("feedback").insert({
    id: input.id,
    message: input.message.trim(),
    context: input.context,
    screenshot_path: path,
  });
  if (error) throw new Error(error.message);
  uploaded.delete(input.id);
}

const COLUMNS = "id, message, person_id, context, screenshot_path, status, created_at";

/** The newest reports an admin may read (a sender gets only their own). */
export async function listRemoteReports(
  client: SupabaseClient,
  limit: number,
): Promise<FeedbackReport[]> {
  const { data, error } = await client
    .from("feedback")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as FeedbackRow[]).map(reportFromRow);
}

export async function setRemoteStatus(
  client: SupabaseClient,
  id: string,
  status: FeedbackStatus,
): Promise<void> {
  const { data, error } = await client
    .from("feedback")
    .update({ status })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  // Row-level security hides the row from a non-admin: an update that changed nothing.
  if (!data?.length) throw new Error("You can't change this report.");
}

export async function remoteImageUrl(client: SupabaseClient, path: string): Promise<string | null> {
  const { data, error } = await client.storage
    .from(FEEDBACK_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  return error || !data ? null : data.signedUrl;
}
