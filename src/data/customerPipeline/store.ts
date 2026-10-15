/**
 * Your list and the customer pipeline on the client. In the browser-storage
 * demo the tables persist to localStorage key `levelup.customerPipeline`,
 * versioned with the CRM seed (resetDemo and SEED_VERSION bumps re-seed it);
 * with real accounts the store lives in memory only and is filled from the
 * database after sign-in (src/data/remote).
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
import { convertLegacyCards } from "../pipeline/booking";
import { chainOf, columnsFor } from "../pipeline/rules";
import type { BoardDef, PipelineColumn } from "../pipeline/types";
import { seedCustomerPipeline } from "./seed";
import { cardBand } from "./rules";
import { CUSTOMER_BOARD, type CustomerPipelineData } from "./types";

export const CUSTOMER_PIPELINE_STORAGE_KEY = "levelup.customerPipeline";
/** Bump when the stored shape changes (resets everyone's demo list and board). */
const SCHEMA_VERSION = 3; // 2: "New contacts" merged into Contact; 3: booked next steps, notes

/** Every table, empty (real accounts start here). */
export function emptyCustomerPipeline(): CustomerPipelineData {
  return { entries: [], steps: [], hides: [], cards: [], moves: [] };
}

/**
 * Saved demo data from before booked next steps: free-text `nextStep` becomes
 * a booked column when it names one on the list owner's board, else the
 * card's note.
 */
export function upgradeCustomerPipeline(state: CustomerPipelineData): CustomerPipelineData {
  const people = usePeopleStore.getState().people;
  const owner = new Map((state.entries ?? []).map((e) => [e.id, e.ownerId]));
  const cache = new Map<string, PipelineColumn<string>[]>();
  const columnsOf = (id: string | undefined) => {
    const key = id ?? "";
    let c = cache.get(key);
    if (!c) {
      c = columnsFor(
        id ? chainOf(people, id) : [],
        state.steps ?? [],
        state.hides ?? [],
        CUSTOMER_BOARD as BoardDef<string>,
      );
      cache.set(key, c);
    }
    return c;
  };
  const cards = convertLegacyCards(
    state.cards ?? [],
    (c) => ({
      columns: columnsOf(owner.get(c.entryId)),
      band: cardBand(c.column, state.steps ?? []),
    }),
    CUSTOMER_BOARD as BoardDef<string>,
  );
  return { ...state, cards };
}

function fresh(): CustomerPipelineData {
  return IS_SUPABASE ? emptyCustomerPipeline() : seedCustomerPipeline(seedPeople());
}

export const useCustomerPipelineStore = create<CustomerPipelineData>()(
  persist(fresh, {
    name: CUSTOMER_PIPELINE_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + SCHEMA_VERSION,
    migrate: () => fresh() as unknown as CustomerPipelineData,
    merge: (saved, current) =>
      upgradeCustomerPipeline({ ...current, ...(saved as CustomerPipelineData) }),
  }),
);

/** Apply an immutable update. */
export function updateCustomerPipeline(
  fn: (s: CustomerPipelineData) => Partial<CustomerPipelineData>,
): void {
  useCustomerPipelineStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const customerPipeline = (): CustomerPipelineData => useCustomerPipelineStore.getState();
