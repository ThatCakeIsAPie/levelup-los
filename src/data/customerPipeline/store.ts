/**
 * Your list and the customer pipeline on the client. In the browser-storage
 * demo the tables persist to localStorage key `<prefix>.customerPipeline`,
 * versioned with the CRM seed (resetDemo and SEED_VERSION bumps re-seed it);
 * with real accounts the store lives in memory only and is filled from the
 * database after sign-in (src/data/remote).
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
import { chainOf, columnsFor } from "../pipeline/rules";
import type { BoardDef, PipelineColumn } from "../pipeline/types";
import { seedCustomerPipeline } from "./seed";
import { CUSTOMER_BOARD, type CustomerPipelineData } from "./types";

export const CUSTOMER_PIPELINE_STORAGE_KEY = storageKey("customerPipeline");
/** Bump when the stored shape changes (resets everyone's demo list and board). */
const SCHEMA_VERSION = 3; // 2: "New contacts" merged into Contact; 3: booked next steps, notes

/** Every table, empty (real accounts start here). */
export function emptyCustomerPipeline(): CustomerPipelineData {
  return { entries: [], steps: [], hides: [], cards: [], moves: [] };
}

/**
 * Names saved before "Referred by" get empty links. Booked next steps and notes on saved cards are
 * converted into tasks and notes by the card tasks store (src/data/cardTasks/legacy.ts).
 */
/** Saved cards of the old shape were converted while loading: write them back at once. */
let convertedOnLoad = false;

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
  const conv = convertLegacyCards("customer", state.cards ?? [], (c) => c.entryId, {
    ownerOf: (id) => owner.get(id) ?? null,
    labelOf: (id, col) =>
      columnsOf(owner.get(id)).find((c) => c.id === col)?.label ??
      (state.steps ?? []).find((x) => x.id === col)?.label ??
      null,
    existing: cardTasks(),
  });
  saveConverted(conv);
  if (conv.found) convertedOnLoad = true;
  const entries = (state.entries ?? []).map((e) =>
    e.referredBy === undefined || e.referredByEntry === undefined
      ? { ...e, referredBy: e.referredBy ?? null, referredByEntry: e.referredByEntry ?? null }
      : e,
  );
  return { ...state, entries, cards: conv.cards };
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

// Persist writes only when the state changes: save the converted cards now, so a reload cannot
// convert them a second time.
if (convertedOnLoad) useCustomerPipelineStore.setState((s) => ({ ...s }));

/** Apply an immutable update. */
export function updateCustomerPipeline(
  fn: (s: CustomerPipelineData) => Partial<CustomerPipelineData>,
): void {
  useCustomerPipelineStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations). */
export const customerPipeline = (): CustomerPipelineData => useCustomerPipelineStore.getState();
