/**
 * The team's event categories on the client. In the browser-storage demo they
 * persist to localStorage key `levelup.eventCategories` (seeded with the six
 * starting categories, versioned with the CRM seed); with real accounts the
 * store lives in memory and is filled from the database after sign-in
 * (src/data/remote).
 *
 * Pages never import this: they use the hooks and writes re-exported from
 * "@/data".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";
import { SEED_VERSION } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { startingCategories } from "./rules";
import type { EventCategoriesData } from "./types";

export const EVENT_CATEGORIES_STORAGE_KEY = "levelup.eventCategories";
/** Bump when the stored shape changes. */
const SCHEMA_VERSION = 1;

function fresh(): EventCategoriesData {
  return { categories: IS_SUPABASE ? [] : startingCategories() };
}

export const useEventCategoriesStore = create<EventCategoriesData>()(
  persist(fresh, {
    name: EVENT_CATEGORIES_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + SCHEMA_VERSION,
    migrate: () => fresh() as unknown as EventCategoriesData,
  }),
);
