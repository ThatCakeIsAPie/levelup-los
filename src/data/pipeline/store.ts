/**
 * The pipeline tables on the client. In the browser-storage demo they persist
 * to localStorage key `<prefix>.pipeline`, versioned with the CRM seed so
 * resetDemo and SEED_VERSION bumps re-seed it like every other `<prefix>.*`
 * store. With real accounts ("supabase" mode) the store lives in memory only
 * (src/stores/storage.ts) and starts empty.
 *
 * Pages never import this: they use the hooks and mutations re-exported from
 * "@/data".
 */
import { storageKey } from "@/lib/brand";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";
import { SEED_VERSION, seedPeople } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { usePeopleStore } from "@/stores/peopleStore";
import { cardTasks } from "../cardTasks/store";
import { convertLegacyCards, saveConverted } from "../cardTasks/legacy";
import { seedPipeline } from "./seed";
import { chainOf, columnsFor } from "./rules";
import type { PipelineCard, PipelineColumn, PipelineData } from "./types";

export const PIPELINE_STORAGE_KEY = storageKey("pipeline");
/** Bump when the stored shape changes (resets everyone's pipeline demo data). */
const PIPELINE_SCHEMA_VERSION = 2; // 2: booked next steps, notes, cancellations (cards no longer carry them)

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
  };
}

/**
 * Saved demo cards from before Hot / Warm / Cold carry `hot` instead of a rating (the rating is
 * worked out here). Booked next steps and notes on saved cards are converted into tasks and notes
 * by the card tasks store (src/data/cardTasks/legacy.ts).
 */
/** Saved cards of the old shape were converted while loading: write them back at once. */
let convertedOnLoad = false;

export function upgradePipeline(state: PipelineData): PipelineData {
  // Booked next steps and notes become tasks and notes (the same rules as the database's
  // convert_card_followups()); `cancellations` (cancelled booked steps) are dropped with them.
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
  const conv = convertLegacyCards("recruiting", state.cards ?? [], (c) => c.personId, {
    ownerOf: (id) => sponsor.get(id) ?? null,
    labelOf: (id, col) =>
      columnsOf(sponsor.get(id) ?? null).find((c) => c.id === col)?.label ??
      (state.steps ?? []).find((x) => x.id === col)?.label ??
      null,
    existing: cardTasks(),
  });
  saveConverted(conv);
  if (conv.found) convertedOnLoad = true;
  const { cancellations: _gone, ...rest } = state as PipelineData & { cancellations?: unknown };
  void _gone;
  return { ...rest, cards: conv.cards.map(withRating) };
}

/** Saved demo cards from before Hot / Warm / Cold had `hot: boolean` instead of `rating`. */
function withRating<T extends PipelineCard>(card: T): T {
  const old = card as T & { hot?: boolean };
  if (old.rating !== undefined) return card;
  const { hot, ...rest } = old;
  return { ...rest, rating: hot ? "hot" : null } as T;
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

// Persist writes only when the state changes: save the converted cards now, so a reload cannot
// convert them a second time (a task you ticked off or deleted would come back).
if (convertedOnLoad) usePipelineStore.setState((s) => ({ ...s }));

/** Apply an immutable update to the pipeline tables. */
export function updatePipeline(fn: (s: PipelineData) => Partial<PipelineData>): void {
  usePipelineStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const pipeline = (): PipelineData => usePipelineStore.getState();
