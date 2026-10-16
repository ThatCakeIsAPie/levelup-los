import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { logEvent } from "./activityStore";
import { seedEvents, SEED_VERSION } from "@/data/seed";
import { convertLegacyEvents } from "@/data/eventCategories/rules";

/** How people can join: in person, online, or either (online only where the category allows it). */
export type EventFormat = "in_person" | "virtual" | "both";

export interface CrmEvent {
  id: string;
  name: string;
  /**
   * The team's event category (src/data/eventCategories): its name, icon and
   * settings (online, tickets, travel, missed-event reminders). Look it up
   * with `useCategoryOf()` / `eventCategory(e)` from @/data.
   */
  categoryId: string;
  date: string; // "YYYY-MM-DD" (first day)
  /** Last day for multi-day events ("YYYY-MM-DD"); omit for single-day events. */
  endDate?: string;
  location?: string;
  notes?: string;
  /** In person (the default), virtual or both; see `eventFormat()` in @/data. */
  format?: EventFormat;
  /** Where to buy a ticket (team site, Venmo...): an http(s) link; see `cleanTicketUrl()`. */
  ticketUrl?: string;
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
      // Events saved before categories had a `type`: give them its category.
      merge: (persisted, current) => {
        const saved = (persisted as Partial<EventsState> | undefined)?.events;
        return saved ? { ...current, events: convertLegacyEvents(saved) } : current;
      },
    },
  ),
);
