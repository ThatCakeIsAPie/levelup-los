/**
 * Saving the team's look. With real accounts: upload new pictures, call
 * `set_workspace_appearance()`, remove the files no longer used (./remote.ts);
 * in the demo the same steps run against the browser's own storage (./local.ts).
 * Either way the store then holds the look as stored.
 */
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import type { Encoded } from "@/lib/pictureFiles";
import { useSessionStore } from "@/stores/sessionStore";
import { deleteLocalFiles, releaseLocalUrl, saveLocalFile } from "./local";
import { saveRemoteLook } from "./remote";
import { lookProblem, newLookPath } from "./rules";
import { lookWorkspaceId, useTeamLookStore } from "./store";
import { defaultLook, type TeamLook } from "./types";

export interface NewPictures {
  /** A new background picture (used when the background is `picture`). */
  background?: Encoded | null;
  /** A new logo. */
  logo?: Encoded | null;
}

async function saveLocalLook(
  workspaceId: string,
  previous: TeamLook,
  look: TeamLook,
  files: NewPictures,
): Promise<TeamLook> {
  const written: string[] = [];
  try {
    let backgroundPath = look.background === "picture" ? look.backgroundPath : null;
    let logoPath = look.logoPath;
    if (look.background === "picture" && files.background) {
      backgroundPath = newLookPath(workspaceId, "bg", files.background.mime);
      await saveLocalFile(backgroundPath, files.background.blob);
      written.push(backgroundPath);
    }
    if (files.logo) {
      logoPath = newLookPath(workspaceId, "logo", files.logo.mime);
      await saveLocalFile(logoPath, files.logo.blob);
      written.push(logoPath);
    }
    const next: TeamLook = { ...look, backgroundPath, logoPath };
    const problem = lookProblem(next, workspaceId);
    if (problem) throw new Error(`That ${problem} is not allowed.`);
    const unused = [previous.backgroundPath, previous.logoPath].filter(
      (p): p is string => p !== null && p !== next.backgroundPath && p !== next.logoPath,
    );
    await deleteLocalFiles(unused);
    unused.forEach(releaseLocalUrl);
    return next;
  } catch (e) {
    await deleteLocalFiles(written);
    throw e;
  }
}

/**
 * Save the look for the whole team (the leader only). `look` carries every
 * choice; a picture or logo that is kept as it was needs no file. Throws a
 * short message when it could not be saved, and the saved look stays as it was.
 */
export async function saveTeamLook(look: TeamLook, files: NewPictures = {}): Promise<void> {
  const session = useSessionStore.getState();
  const leader = IS_SUPABASE
    ? session.account?.workspaceRole === "leader"
    : session.user?.role === "leader";
  if (!leader) throw new Error("Only the team's leader can change this.");
  const workspaceId = lookWorkspaceId();
  const previous = useTeamLookStore.getState().look;
  const next = IS_SUPABASE
    ? await saveRemoteLook(getSupabase(), workspaceId, look, files)
    : await saveLocalLook(workspaceId, previous, look, files);
  useTeamLookStore.setState({ look: next, workspaceId });
}

/** Clear every choice: the brand's own look for the whole team. */
export function resetTeamLook(): Promise<void> {
  return saveTeamLook(defaultLook());
}
