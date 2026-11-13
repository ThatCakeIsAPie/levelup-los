/**
 * The team's look with real accounts: the `workspaces` row (read by every
 * member) and `set_workspace_appearance()` (the leader's only way to write),
 * plus the pictures in the public `team-appearance` bucket. Pictures are
 * uploaded BEFORE the function is called, so a look never points at a missing
 * file, and the files the team no longer uses are removed afterwards.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Encoded } from "@/lib/pictureFiles";
import { LOOK_BUCKET, isLookPath, lookProblem, newLookPath, parseLook } from "./rules";
import type { TeamLook } from "./types";

/** The look of the caller's workspace (RLS: members of it), or null when the row cannot be read. */
export async function fetchTeamLook(
  client: SupabaseClient,
): Promise<{ workspaceId: string; look: TeamLook } | null> {
  const { data, error } = await client
    .from("workspaces")
    .select("id, background_mode, background_path, glass, logo_path, colors")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`load team look: ${error.message}`);
  if (!data) return null;
  const id = String(data.id);
  return {
    workspaceId: id,
    look: parseLook(
      {
        background: data.background_mode,
        backgroundPath: data.background_path,
        glass: data.glass,
        logoPath: data.logo_path,
        colors: data.colors,
      },
      id,
    ),
  };
}

async function upload(client: SupabaseClient, path: string, file: Encoded): Promise<void> {
  const { error } = await client.storage.from(LOOK_BUCKET).upload(path, file.blob, {
    contentType: file.mime,
    upsert: false,
    cacheControl: "31536000",
  });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

async function removeFiles(client: SupabaseClient, paths: string[]): Promise<void> {
  if (!paths.length) return;
  await client.storage
    .from(LOOK_BUCKET)
    .remove(paths)
    .catch(() => undefined);
}

/**
 * Save the whole look. `files` are new pictures to upload (their paths are made
 * here); a picture or logo without a file keeps the path already in `look`.
 * Returns the look as stored. Throws with a short message when it was refused.
 */
export async function saveRemoteLook(
  client: SupabaseClient,
  workspaceId: string,
  look: TeamLook,
  files: { background?: Encoded | null; logo?: Encoded | null },
): Promise<TeamLook> {
  const uploaded: string[] = [];
  try {
    let backgroundPath = look.background === "picture" ? look.backgroundPath : null;
    let logoPath = look.logoPath;
    if (look.background === "picture" && files.background) {
      backgroundPath = newLookPath(workspaceId, "bg", files.background.mime);
      await upload(client, backgroundPath, files.background);
      uploaded.push(backgroundPath);
    }
    if (files.logo) {
      logoPath = newLookPath(workspaceId, "logo", files.logo.mime);
      await upload(client, logoPath, files.logo);
      uploaded.push(logoPath);
    }
    const next: TeamLook = { ...look, backgroundPath, logoPath };
    const problem = lookProblem(next, workspaceId);
    if (problem) throw new Error(`That ${problem} is not allowed.`);

    const { data, error } = await client.rpc("set_workspace_appearance", {
      p_background: next.background,
      p_background_path: next.backgroundPath ?? undefined,
      p_glass: next.glass ?? undefined,
      p_logo_path: next.logoPath ?? undefined,
      p_main: next.colors.main ?? undefined,
      p_highlight: next.colors.highlight ?? undefined,
      p_sidebar: next.colors.sidebar ?? undefined,
    });
    if (error) {
      throw new Error(
        error.code === "42501"
          ? "Only the team's leader can change this."
          : `Could not save the look: ${error.message}`,
      );
    }
    // Files the team no longer uses (only ever paths of this workspace).
    const removed = ((data ?? []) as string[]).filter(
      (p) => isLookPath(p, workspaceId, "bg") || isLookPath(p, workspaceId, "logo"),
    );
    await removeFiles(client, removed);
    return next;
  } catch (e) {
    // The look was not saved: the pictures uploaded for it are not needed.
    await removeFiles(client, uploaded);
    throw e;
  }
}
