/**
 * Card tasks and notes on the client. In the browser-storage demo they persist to localStorage key
 * `<prefix>.cardTasks`, versioned with the CRM seed (resetDemo and SEED_VERSION bumps re-seed it
 * like every other `<prefix>.*` store); with real accounts the store lives in memory only and is
 * filled from the database after sign-in (src/data/remote).
 *
 * Pages never import this: they use the hooks and mutations re-exported from "@/data".
 */
import { storageKey } from "@/lib/brand";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";
import { SEED_VERSION, seedPeople } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { seedCardTasks } from "./seed";
import type { CardTasksData } from "./types";

export const CARD_TASKS_STORAGE_KEY = storageKey("cardTasks");
/** Bump when the stored shape changes (resets everyone's card tasks demo data). */
const SCHEMA_VERSION = 1;

/** Both tables, empty (real accounts start here). */
export function emptyCardTasks(): CardTasksData {
  return { tasks: [], notes: [] };
}

function fresh(): CardTasksData {
  return IS_SUPABASE ? emptyCardTasks() : seedCardTasks(seedPeople());
}

/**
 * Saved demo data exists, so the seed needn't be built: this store's own, or the pipeline boards'
 * (a visitor whose boards were saved before tasks and notes existed keeps their own cards, and
 * their booked steps and notes are converted into tasks and notes as the boards load, see legacy.ts).
 */
const hasSaved = (() => {
  if (IS_SUPABASE) return false;
  try {
    return [CARD_TASKS_STORAGE_KEY, storageKey("pipeline"), storageKey("customerPipeline")].some(
      (k) => localStorage.getItem(k) !== null,
    );
  } catch {
    return false;
  }
})();

export const useCardTasksStore = create<CardTasksData>()(
  persist(() => (hasSaved ? emptyCardTasks() : fresh()), {
    name: CARD_TASKS_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + SCHEMA_VERSION,
    migrate: () => fresh() as unknown as CardTasksData,
    merge: (saved, current) => ({ ...current, ...(saved as CardTasksData) }),
  }),
);

/** Apply an immutable update to the card tasks tables. */
export function updateCardTasks(fn: (s: CardTasksData) => Partial<CardTasksData>): void {
  useCardTasksStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const cardTasks = (): CardTasksData => useCardTasksStore.getState();
