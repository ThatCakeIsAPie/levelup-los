import { storageKey } from "@/lib/brand";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { logEvent } from "./activityStore";
import { seedEvents, SEED_VERSION } from "@/data/seed";
import { convertLegacyEvents } from "@/data/eventCategories/rules";
import { dedupeOccurrences, markOverrides, tombstone } from "@/data/recurrence/plan";
import type { RepeatFreq } from "@/data/recurrence/rule";

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
  /**
   * The series this event is one occurrence of (src/data/recurrence); events that do not repeat have
   * none. Real accounts: `events.series_id`, written only by the database's series functions.
   */
  seriesId?: string;
  /** The date of this occurrence's place in its series; it stays when the event itself is moved. */
  seriesDate?: string;
  /** The fields changed on this occurrence alone (database column names): a later "This and following" edit from an earlier occurrence leaves them as they are. */
  seriesOverrides?: string[];
}

/** A rule that repeats an event, and what each new occurrence is made from. */
export interface EventSeries {
  id: string;
  freq: RepeatFreq;
  /** The first occurrence's date: where the rule starts counting. */
  startsOn: string;
  /** The last date an occurrence may fall on; none = never ends. */
  endsOn?: string;
  /** Dates whose occurrence was deleted by itself: they are not made again. */
  skipped: string[];
  /** Who made the series; its occurrences are editable by the same people as if they had added them. */
  createdBy?: string;
  // What a new occurrence is made from.
  name: string;
  categoryId: string;
  location?: string;
  notes?: string;
  format?: EventFormat;
  ticketUrl?: string;
  /** Days an occurrence runs past its first day (0 for a one-day event). */
  lengthDays: number;
}

interface EventsState {
  events: CrmEvent[];
  /** The rules of the repeating events (empty for a team that has none). */
  series: EventSeries[];
  add: (e: Omit<CrmEvent, "id">) => CrmEvent;
  update: (id: string, patch: Partial<CrmEvent>) => void;
  remove: (id: string) => void;
  getById: (id: string) => CrmEvent | undefined;
}

export const useEventsStore = create<EventsState>()(
  persist(
    (set, get) => ({
      events: seedOr(seedEvents, []),
      series: [],
      add: (e) => {
        const ev: CrmEvent = { ...e, id: crypto.randomUUID() };
        set({ events: [...get().events, ev] });
        logEvent("created", ev.id, `Created event ${ev.name}`);
        return ev;
      },
      update: (id, patch) => {
        // A change to one occurrence of a repeating event is remembered on it (series_overrides).
        set({
          events: get().events.map((e) =>
            e.id === id ? { ...e, ...patch, ...markOverrides(e, patch) } : e,
          ),
        });
        logEvent("updated", id, `Edited ${Object.keys(patch).join(", ")}`);
      },
      remove: (id) => {
        // An occurrence deleted by itself is never made again: its date is kept on the series.
        const gone = get().events.find((e) => e.id === id);
        set({
          events: get().events.filter((e) => e.id !== id),
          series: gone ? tombstone(get().series, gone) : get().series,
        });
        logEvent("deleted", id, "Deleted event");
      },
      getById: (id) => get().events.find((e) => e.id === id),
    }),
    {
      name: storageKey("events"),
      storage: dataStorage(),
      partialize: (s) => ({ events: s.events, series: s.series }),
      version: SEED_VERSION,
      migrate: () => ({ events: seedEvents() }) as unknown as EventsState,
      // Events saved before categories had a `type`: give them its category.
      merge: (persisted, current) => {
        const saved = persisted as Partial<EventsState> | undefined;
        // Saved data from before events could repeat has no series; two tabs that each made the same
        // occurrence leave one of them (the ids are the same, this is the second line of defence).
        return saved?.events
          ? {
              ...current,
              events: dedupeOccurrences(convertLegacyEvents(saved.events)),
              series: saved.series ?? [],
            }
          : current;
      },
    },
  ),
);
