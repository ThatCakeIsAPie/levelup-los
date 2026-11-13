/**
 * Showing the SAVED look: the app shell calls `showSavedLook()` whenever the
 * saved look (or who is signed in) changes; it resolves the pictures, applies
 * the look through `applyTeamLook` (src/lib/teamLook.ts, the one place that
 * writes it to the page) and caches it for the next page load. While the
 * leader is editing in Settings (`isPreviewing()`), the live preview owns the
 * page and this does nothing until the editor ends the preview.
 */
import { IS_SUPABASE } from "@/lib/config";
import {
  applyTeamLook,
  cacheTeamLook,
  clearTeamLookCache,
  isPreviewing,
  setPreviewing,
  type ResolvedLook,
} from "@/lib/teamLook";
import { useSessionStore } from "@/stores/sessionStore";
import { resolveLook } from "./resolve";
import { lookWorkspaceId, useTeamLookStore } from "./store";

let token = 0;

/** Who the cache belongs to: the auth user with real accounts, the demo person otherwise. */
function owner(): string | null {
  const s = useSessionStore.getState();
  return (IS_SUPABASE ? s.account?.userId : s.user?.personId) ?? null;
}

export async function showSavedLook(): Promise<void> {
  const mine = ++token;
  if (isPreviewing()) return;
  const look = useTeamLookStore.getState().look;
  const resolved = await resolveLook(look);
  if (mine !== token || isPreviewing()) return;
  applyTeamLook(resolved);
  const who = owner();
  if (who) cacheTeamLook(who, lookWorkspaceId(), look);
}

/** Signed out (or no team): the brand's own look, and nothing cached. */
export function hideTeamLook(): void {
  token++;
  clearTeamLookCache();
  applyTeamLook(null);
}

/** Show a look that is not saved (the editor's live preview). It stays until `endTeamLookPreview`. */
export function previewTeamLook(resolved: ResolvedLook): void {
  token++;
  setPreviewing(true);
  applyTeamLook(resolved);
}

/** Leave the preview and show what is saved (Cancel, Save, leaving the page). */
export function endTeamLookPreview(): Promise<void> {
  setPreviewing(false);
  return showSavedLook();
}
