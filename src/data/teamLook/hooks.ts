import { IS_SUPABASE } from "@/lib/config";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamLookStore, lookWorkspaceId } from "./store";
import type { TeamLook } from "./types";

/** The team's saved look (the brand's own where nothing was chosen). */
export function useTeamLook(): TeamLook {
  return useTeamLookStore((s) => s.look);
}

/** Non-reactive version of `useTeamLook`. */
export function getTeamLook(): TeamLook {
  return useTeamLookStore.getState().look;
}

/** The workspace the look belongs to (for building picture paths). */
export { lookWorkspaceId };

/** Only the workspace leader changes the look (deputies and everyone else do not; the database checks the same). */
export function useCanChangeLook(): boolean {
  return useSessionStore((s) =>
    IS_SUPABASE ? s.account?.workspaceRole === "leader" : s.user?.role === "leader",
  );
}
