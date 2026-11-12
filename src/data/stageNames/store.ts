/**
 * Custom stage names on the client (rules in ./rules). In the browser-storage
 * demo every person's own names persist to localStorage key
 * `<prefix>.stageNames` (so switching demo users shows the inheritance down
 * the sponsor tree); with real accounts the store lives in memory and holds
 * only the signed-in person's own rows (`stage_names`, RLS: your own), synced
 * by `stageNamesBinding` in src/data/remote. Names set above you are loaded
 * separately (./inherited).
 *
 * Pages never import this: they use `useStageNames`, `useStageNameEditor` and
 * `saveStageNames` from "@/data" (./hooks).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { storageKey } from "@/lib/brand";
import { dataStorage } from "@/stores/storage";
import { MAX_STAGE_NAME, isStageKey, isStagePipeline, type StageNameEntry } from "./rules";

export const STAGE_NAMES_STORAGE_KEY = storageKey("stageNames");

export interface StageNamesState {
  /** Everyone's own custom names (the demo), or just yours (real accounts). */
  entries: StageNameEntry[];
}

/** Keep only well-formed entries (one per person, pipeline and stage). */
export function sanitizeEntries(raw: unknown): StageNameEntry[] {
  if (!Array.isArray(raw)) return [];
  const out = new Map<string, StageNameEntry>();
  for (const r of raw as Partial<StageNameEntry>[]) {
    if (!r || typeof r.personId !== "string" || !isStagePipeline(r.pipeline)) continue;
    if (typeof r.stage !== "string" || !isStageKey(r.pipeline, r.stage)) continue;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (!name || name.length > MAX_STAGE_NAME) continue;
    out.set(`${r.personId}\u0001${r.pipeline}\u0001${r.stage}`, {
      personId: r.personId,
      pipeline: r.pipeline,
      stage: r.stage,
      name,
    });
  }
  return [...out.values()];
}

export const useStageNamesStore = create<StageNamesState>()(
  persist((): StageNamesState => ({ entries: [] }), {
    name: STAGE_NAMES_STORAGE_KEY,
    storage: dataStorage(),
    version: 1,
    // Anything unreadable starts over at the defaults.
    merge: (persisted, current) => ({
      ...current,
      entries: sanitizeEntries((persisted as Partial<StageNamesState> | undefined)?.entries),
    }),
  }),
);
