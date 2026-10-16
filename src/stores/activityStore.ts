import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { seedActivity, SEED_VERSION } from "@/data/seed";
import { useSessionStore } from "./sessionStore";

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
  /**
   * Who did it, when known: set when logged in this app (the signed-in person)
   * and from the database's `actor_id`. Entries without it are "You" when
   * `actorName` says so.
   */
  actorId?: string;
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
      events: seedOr(seedActivity, []),
      log: (e) => {
        const actorId = useSessionStore.getState().user?.personId;
        const entry: ActivityEvent = {
          ...e,
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          actorName: ACTOR,
          ...(actorId ? { actorId } : {}),
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
      storage: dataStorage(),
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
