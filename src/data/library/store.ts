/**
 * The library tables on the client. In the browser-storage demo they persist
 * to localStorage key `levelup.library`, versioned with the CRM seed so
 * resetDemo and SEED_VERSION bumps re-seed it like every other `levelup.*`
 * store. With real accounts ("supabase" mode) the store lives in memory only
 * (src/stores/storage.ts) and starts empty.
 *
 * Pages never import this: they use the hooks and mutations from "@/data".
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE, storageKey } from "@/lib/config";
import { SEED_VERSION } from "@/data/seed";
import { dataStorage, seedOr } from "@/stores/storage";
import { clearLibraryFiles } from "./files";
import { seedLibrary } from "./seed";
import type { LibraryData } from "./types";

export const LIBRARY_STORAGE_KEY = storageKey("library");
/** Bump when the stored shape changes (resets everyone's library demo data). */
const LIBRARY_SCHEMA_VERSION = 1;

/** Every library table, empty (real accounts: filled from the database). */
export function emptyLibrary(): LibraryData {
  return { items: [], topics: [], channels: [], progress: [] };
}

const fresh = (): LibraryData => seedOr(() => seedLibrary(), emptyLibrary());

/** True when no library data was saved yet (first run or after resetDemo). Demo only. */
const isFirstRun = (() => {
  if (IS_SUPABASE || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(LIBRARY_STORAGE_KEY) === null;
  } catch {
    return true;
  }
})();
// Fresh seed: drop uploads left over from before a reset.
if (isFirstRun) void clearLibraryFiles();

export const useLibraryStore = create<LibraryData>()(
  persist(() => fresh(), {
    name: LIBRARY_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + LIBRARY_SCHEMA_VERSION,
    migrate: () => fresh(),
  }),
);

/** Apply an immutable update to the library tables. */
export function updateLibrary(fn: (s: LibraryData) => Partial<LibraryData>): void {
  useLibraryStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations and route loaders). */
export const library = (): LibraryData => useLibraryStore.getState();
