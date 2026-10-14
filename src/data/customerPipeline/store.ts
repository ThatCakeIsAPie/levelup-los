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
import { seedCustomerPipeline } from "./seed";
import type { CustomerPipelineData } from "./types";

export const CUSTOMER_PIPELINE_STORAGE_KEY = "levelup.customerPipeline";
/** Bump when the stored shape changes (resets everyone's demo list and board). */
const SCHEMA_VERSION = 1;

/** Every table, empty (real accounts start here). */
export function emptyCustomerPipeline(): CustomerPipelineData {
  return { entries: [], steps: [], hides: [], cards: [], moves: [] };
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
