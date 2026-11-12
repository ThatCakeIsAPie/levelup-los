/**
 * Home card layouts on the client, by person id (rules in ./homeLayout). In
 * the browser-storage demo they persist to localStorage key
 * `levelup.homeLayout` (each demo login keeps its own); with real accounts
 * the store lives in memory and syncs with `dashboard_layouts` (only your own
 * row; src/data/remote, `homeLayoutBinding`).
 *
 * Pages never import this: they use `useHomeLayout`, `setHomeLayout` and
 * `resetHomeLayout` from "@/data" (./homeLayoutHooks).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage } from "@/stores/storage";
import { sanitizeLayout, type HomeLayout } from "./homeLayout";

export const HOME_LAYOUT_STORAGE_KEY = "levelup.homeLayout";

export interface HomeLayoutState {
  /** Person id -> their layout; missing = the default. */
  layouts: Record<string, HomeLayout>;
}

export const useHomeLayoutStore = create<HomeLayoutState>()(
  persist((): HomeLayoutState => ({ layouts: {} }), {
    name: HOME_LAYOUT_STORAGE_KEY,
    storage: dataStorage(),
    version: 1,
    // Anything unreadable starts over at the default.
    merge: (persisted, current) => {
      const raw = (persisted as Partial<HomeLayoutState> | undefined)?.layouts;
      const layouts: Record<string, HomeLayout> = {};
      if (raw && typeof raw === "object") {
        for (const [id, l] of Object.entries(raw)) {
          const ok = sanitizeLayout(l);
          if (ok) layouts[id] = ok;
        }
      }
      return { ...current, layouts };
    },
  }),
);
