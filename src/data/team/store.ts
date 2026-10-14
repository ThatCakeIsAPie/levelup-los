/**
 * Team settings on the client (deputies, feature switches). In the
 * browser-storage demo they persist to localStorage key `levelup.team`,
 * versioned with the CRM seed; with real accounts the store lives in memory
 * and is filled from the database after sign-in (src/data/remote).
 *
 * Pages never import this: they use the hooks and writes re-exported from
 * "@/data".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE, storageKey } from "@/lib/config";
import { SEED_VERSION } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { seedDeputies, seedFeatureSwitches } from "./seed";
import type { TeamData } from "./types";

export const TEAM_STORAGE_KEY = storageKey("team");
/** Bump when the stored shape changes. */
const SCHEMA_VERSION = 1;

export function emptyTeam(): TeamData {
  return { deputies: [], switches: [] };
}

function fresh(): TeamData {
  return IS_SUPABASE ? emptyTeam() : { deputies: seedDeputies(), switches: seedFeatureSwitches() };
}

export const useTeamStore = create<TeamData>()(
  persist(fresh, {
    name: TEAM_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + SCHEMA_VERSION,
    migrate: () => fresh() as unknown as TeamData,
  }),
);
