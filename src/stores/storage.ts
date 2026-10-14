import { createJSONStorage, type StateStorage } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";

/**
 * Where the data stores persist.
 *
 *  - "local" mode (browser-storage demo): localStorage, under the `levelup.*`
 *    keys (the build's storage namespace; see storageKey in @/lib/config).
 *  - "supabase" mode: nowhere. The stores start empty, are filled from the
 *    database after sign-in (src/data/remote) and live in memory only, so
 *    real data never mixes with the demo's saved data (or the other way round).
 */
const memoryOnly: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function dataStorage() {
  return createJSONStorage(() => (IS_SUPABASE ? memoryOnly : localStorage));
}

/** The demo seed in "local" mode; an empty value with real accounts. */
export function seedOr<T>(seed: () => T, empty: T): T {
  return IS_SUPABASE ? empty : seed();
}
