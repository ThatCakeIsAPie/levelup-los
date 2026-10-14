/**
 * The pipeline tables on the client. In the browser-storage demo they persist
 * to localStorage key `levelup.pipeline`, versioned with the CRM seed so
 * resetDemo and SEED_VERSION bumps re-seed it like every other `levelup.*`
 * store. With real accounts ("supabase" mode) the store lives in memory only
 * (src/stores/storage.ts) and starts empty.
 *
 * Pages never import this: they use the hooks and mutations re-exported from
 * "@/data".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE, storageKey } from "@/lib/config";
import { SEED_VERSION, seedPeople } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { seedPipeline } from "./seed";
import type { PipelineData } from "./types";

export const PIPELINE_STORAGE_KEY = storageKey("pipeline");
/** Bump when the stored shape changes (resets everyone's pipeline demo data). */
const PIPELINE_SCHEMA_VERSION = 1;

/** Every pipeline table, empty (real accounts start here). */
export function emptyPipeline(): PipelineData {
  return { steps: [], hides: [], cards: [], moves: [], settings: [], shares: [], requests: [] };
}

function fresh(): PipelineData {
  return IS_SUPABASE ? emptyPipeline() : seedPipeline(seedPeople());
}

/** Saved demo data exists, so the seed (a few thousand moves) needn't be built. */
const hasSaved = (() => {
  if (IS_SUPABASE) return false;
  try {
    return localStorage.getItem(PIPELINE_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
})();

export const usePipelineStore = create<PipelineData>()(
  persist(() => (hasSaved ? emptyPipeline() : fresh()), {
    name: PIPELINE_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + PIPELINE_SCHEMA_VERSION,
    migrate: () => fresh() as unknown as PipelineData,
  }),
);

/** Apply an immutable update to the pipeline tables. */
export function updatePipeline(fn: (s: PipelineData) => Partial<PipelineData>): void {
  usePipelineStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const pipeline = (): PipelineData => usePipelineStore.getState();
