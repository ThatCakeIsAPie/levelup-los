/**
 * The team's saved look on the client. In the browser-storage demo it persists
 * to localStorage key `<prefix>.teamLook` (the pictures are in IndexedDB, see
 * ./local.ts), versioned with the CRM seed so "Reset demo data" and a seed bump
 * clear it; with real accounts it lives in memory and is filled from the
 * `workspaces` row after sign-in (src/data/remote/hydrate.ts).
 *
 * Pages never import this: they use the hooks and writes re-exported from "@/data".
 */
import { storageKey } from "@/lib/brand";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SEED_VERSION } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { useSessionStore } from "@/stores/sessionStore";
import { WORKSPACE_ID } from "@/data/chat/types";
import { parseLook } from "./rules";
import { defaultLook, type TeamLook } from "./types";

export const TEAM_LOOK_STORAGE_KEY = storageKey("teamLook");
/** Bump when the stored shape changes. */
const SCHEMA_VERSION = 1;

export interface TeamLookData {
  look: TeamLook;
  /** The workspace the look belongs to (null until loaded with real accounts). */
  workspaceId: string | null;
}

export const emptyTeamLook = (): TeamLookData => ({ look: defaultLook(), workspaceId: null });

export const useTeamLookStore = create<TeamLookData>()(
  persist(emptyTeamLook, {
    name: TEAM_LOOK_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + SCHEMA_VERSION,
    migrate: () => emptyTeamLook(),
    // A stored value is never trusted: every part is checked again on the way in.
    merge: (persisted, current) => ({
      ...current,
      look: parseLook((persisted as Partial<TeamLookData> | undefined)?.look, WORKSPACE_ID),
    }),
  }),
);

/** The workspace id the look belongs to: the loaded one, the account's, or the demo's. */
export function lookWorkspaceId(): string {
  return (
    useTeamLookStore.getState().workspaceId ??
    useSessionStore.getState().account?.workspaceId ??
    WORKSPACE_ID
  );
}
