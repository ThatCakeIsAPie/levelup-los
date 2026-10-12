import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logEvent } from "./activityStore";

export type EventType = "conference" | "team_meeting";

export interface CrmEvent {
  id: string;
  name: string;
  type: EventType;
  date: string; // ISO date
  location?: string;
  notes?: string;
}

interface EventsState {
  events: CrmEvent[];
  add: (e: Omit<CrmEvent, "id">) => CrmEvent;
  update: (id: string, patch: Partial<CrmEvent>) => void;
  remove: (id: string) => void;
  getById: (id: string) => CrmEvent | undefined;
  /** Auto-picked comparison events for the audit tab. */
  getComparisonEvents: (id: string) => { prior?: CrmEvent; lastYear?: CrmEvent };
}

const seed: CrmEvent[] = [
  { id: "e1", name: "SpringConference26", type: "conference", date: "2026-09-15", location: "Dallas, TX" },
  { id: "e2", name: "SpringConference25", type: "conference", date: "2025-09-12", location: "Dallas, TX" },
  { id: "e3", name: "SummerConference25", type: "conference", date: "2025-07-12", location: "Orlando, FL" },
  { id: "e4", name: "June Team Meeting", type: "team_meeting", date: "2026-06-08", location: "Zoom" },
];

const DAY = 24 * 60 * 60 * 1000;

export const useEventsStore = create<EventsState>()(persist((set, get) => ({
  events: seed,
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
  getComparisonEvents: (id) => {
    const current = get().events.find((e) => e.id === id);
    if (!current) return {};
    const t = new Date(current.date).getTime();
    const sameType = get().events.filter((e) => e.id !== id && e.type === current.type);

    const earlier = sameType.filter((e) => new Date(e.date).getTime() < t);
    const prior = earlier.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    const target = t - 365 * DAY;
    const window = 90 * DAY;
    const lastYear = sameType
      .filter((e) => Math.abs(new Date(e.date).getTime() - target) <= window)
      .sort((a, b) => Math.abs(new Date(a.date).getTime() - target) - Math.abs(new Date(b.date).getTime() - target))[0];

    return { prior, lastYear };
  },
}), { name: "levelup.events", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ events: s.events }) }));
