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
import { IS_SUPABASE } from "@/lib/config";
import { SEED_VERSION, seedPeople } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { usePeopleStore } from "@/stores/peopleStore";
import { seedPipeline } from "./seed";
import { convertLegacyCards } from "./booking";
import { chainOf, columnsFor, recruitingBand } from "./rules";
import type { PipelineColumn, PipelineData } from "./types";

export const PIPELINE_STORAGE_KEY = "levelup.pipeline";
/** Bump when the stored shape changes (resets everyone's pipeline demo data). */
const PIPELINE_SCHEMA_VERSION = 2; // 2: booked next steps, notes, cancellations

/** Every pipeline table, empty (real accounts start here). */
export function emptyPipeline(): PipelineData {
  return {
    steps: [],
    hides: [],
    cards: [],
    moves: [],
    settings: [],
    shares: [],
    requests: [],
    cancellations: [],
  };
}

/**
 * Saved demo data from before booked next steps: free-text `nextStep` on the
 * cards becomes a booked column when it names one on the owner's board,
 * else the card's note (convertLegacyCards).
 */
export function upgradePipeline(state: PipelineData): PipelineData {
  const people = usePeopleStore.getState().people;
  const sponsor = new Map(people.map((p) => [p.id, p.sponsorId ?? null]));
  const cache = new Map<string, PipelineColumn[]>();
  const columnsOf = (owner: string | null) => {
    const key = owner ?? "";
    let c = cache.get(key);
    if (!c) {
      c = columnsFor(owner ? chainOf(people, owner) : [], state.steps ?? [], state.hides ?? []);
      cache.set(key, c);
    }
    return c;
  };
  const cards = convertLegacyCards(state.cards ?? [], (c) => ({
    columns: columnsOf(sponsor.get(c.personId) ?? null),
    band: recruitingBand(c.column, state.steps ?? []),
  }));
  return { ...state, cards, cancellations: state.cancellations ?? [] };
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
    merge: (saved, current) => upgradePipeline({ ...current, ...(saved as PipelineData) }),
  }),
);

/** Apply an immutable update to the pipeline tables. */
export function updatePipeline(fn: (s: PipelineData) => Partial<PipelineData>): void {
  usePipelineStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const pipeline = (): PipelineData => usePipelineStore.getState();
