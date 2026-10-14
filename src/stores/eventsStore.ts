import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { logEvent } from "./activityStore";
import { seedEvents, SEED_VERSION } from "@/data/seed";

/**
 * The six event types (docs/plans/mvp-plan-2026-10-13.md "Events"). Labels,
 * which ones can be joined online and which use tickets / travel live in
 * src/data/eventTypes.
 */
export type EventType =
  "info_session" | "work_session" | "night_owls" | "training" | "monthly_meeting" | "conference";

/** How people can join: in person, online, or either (online only where the type allows it). */
export type EventFormat = "in_person" | "virtual" | "both";

export interface CrmEvent {
  id: string;
  name: string;
  type: EventType;
  date: string; // "YYYY-MM-DD" (first day)
  /** Last day for multi-day events ("YYYY-MM-DD"); omit for single-day events. */
  endDate?: string;
  location?: string;
  notes?: string;
  /** In person (the default), virtual or both; see `eventFormat()` in @/data. */
  format?: EventFormat;
}

interface EventsState {
  events: CrmEvent[];
  add: (e: Omit<CrmEvent, "id">) => CrmEvent;
  update: (id: string, patch: Partial<CrmEvent>) => void;
  remove: (id: string) => void;
  getById: (id: string) => CrmEvent | undefined;
}

export const useEventsStore = create<EventsState>()(
  persist(
    (set, get) => ({
      events: seedOr(seedEvents, []),
      add: (e) => {
        const ev: CrmEvent = { ...e, id: crypto.randomUUID() };
        set({ events: [...get().events, ev] });
        logEvent("created", ev.id, `Created event ${ev.name}`);
        return ev;
      },
      update: (id, patch) => {
        set({ events: get().events.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
        logEvent("updated", id, `Edited ${Object.keys(patch).join(", ")}`);
      },
      remove: (id) => {
        set({ events: get().events.filter((e) => e.id !== id) });
        logEvent("deleted", id, "Deleted event");
      },
      getById: (id) => get().events.find((e) => e.id === id),
    }),
    {
      name: "levelup.events",
      storage: dataStorage(),
      partialize: (s) => ({ events: s.events }),
      version: SEED_VERSION,
      migrate: () => ({ events: seedEvents() }) as unknown as EventsState,
    },
  ),
);
