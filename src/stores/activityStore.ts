import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { seedActivity, SEED_VERSION } from "@/data/seed";

export type ActivityEntity = "person" | "event" | "attendance";
export type ActivityKind =
  | "created"
  | "updated"
  | "deleted"
  | "stage_changed"
  | "assigned_event"
  | "ticket_purchased"
  | "marked_attended"
  | "marked_no_show"
  | "note";

export interface ActivityEvent {
  id: string;
  timestamp: string; // ISO
  actorName: string;
  entityType: ActivityEntity;
  entityId: string;
  /** Secondary entity (e.g. for attendance rows: the person it belongs to). */
  relatedPersonId?: string;
  relatedEventId?: string;
  kind: ActivityKind;
  summary: string;
  meta?: Record<string, unknown>;
}

interface ActivityState {
  events: ActivityEvent[];
  log: (e: Omit<ActivityEvent, "id" | "timestamp" | "actorName">) => void;
  forPerson: (personId: string) => ActivityEvent[];
  forEvent: (eventId: string) => ActivityEvent[];
}

const ACTOR = "You";

export const useActivityStore = create<ActivityState>()(
  persist(
    (set, get) => ({
      events: seedActivity(),
      log: (e) => {
        const entry: ActivityEvent = {
          ...e,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          actorName: ACTOR,
        };
        set({ events: [entry, ...get().events] });
      },
      forPerson: (personId) =>
        get().events.filter(
          (e) =>
            (e.entityType === "person" && e.entityId === personId) ||
            e.relatedPersonId === personId,
        ),
      forEvent: (eventId) =>
        get().events.filter(
          (e) =>
            (e.entityType === "event" && e.entityId === eventId) || e.relatedEventId === eventId,
        ),
    }),
    {
      name: "levelup.activity",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ events: s.events }),
      version: SEED_VERSION,
      migrate: () => ({ events: seedActivity() }) as unknown as ActivityState,
    },
  ),
);

// Convenience helpers (call outside of stores to avoid circular import)
export function logPerson(
  kind: ActivityKind,
  personId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  useActivityStore.getState().log({
    entityType: "person",
    entityId: personId,
    relatedPersonId: personId,
    kind,
    summary,
    meta,
  });
}

export function logEvent(
  kind: ActivityKind,
  eventId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  useActivityStore.getState().log({
    entityType: "event",
    entityId: eventId,
    relatedEventId: eventId,
    kind,
    summary,
    meta,
  });
}

export function logAttendance(
  kind: ActivityKind,
  attendanceId: string,
  personId: string,
  eventId: string,
  summary: string,
  meta?: Record<string, unknown>,
) {
  useActivityStore.getState().log({
    entityType: "attendance",
    entityId: attendanceId,
    relatedPersonId: personId,
    relatedEventId: eventId,
    kind,
    summary,
    meta,
  });
}
