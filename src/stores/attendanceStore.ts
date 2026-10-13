import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logAttendance } from "./activityStore";
import { seedAttendances, SEED_VERSION } from "@/data/seed";

export type TicketType = "in_person" | "stream";
export type DesireLevel = "yes" | "no" | "maybe";

export interface Attendance {
  id: string;
  eventId: string;
  personId: string;
  desireToAttend?: DesireLevel;
  followUpDate?: string;
  hasTicket: boolean;
  /** Per-event only — no Person default. */
  ticketType?: TicketType;
  plannedPurchaseDate?: string;
  helperId?: string | null;
  leadershipQualified: boolean;
  specialEventQualified: boolean;
  notes?: string;
  /** Whether the person actually attended; drives No Shows roll-up. */
  attended?: boolean;
  updatedAt?: string;
}

interface AttendanceState {
  attendances: Attendance[];
  forEvent: (eventId: string) => Attendance[];
  forPerson: (personId: string) => Attendance[];
  forEventAndPerson: (eventId: string, personId: string) => Attendance | undefined;
  add: (eventId: string, personId: string) => Attendance;
  update: (id: string, patch: Partial<Attendance>) => void;
  remove: (id: string) => void;
  bulkUpdate: (ids: string[], patch: Partial<Attendance>) => void;
  /** Drop rows silently (cascade for a deleted person or event). */
  removeWhere: (pred: (a: Attendance) => boolean) => void;
}

/** Activity entries for a change: ticket bought, attended, no-show. */
function logChange(prev: Attendance, patch: Partial<Attendance>) {
  if (patch.hasTicket === true && !prev.hasTicket) {
    logAttendance("ticket_purchased", prev.id, prev.personId, prev.eventId, "Ticket purchased");
  }
  if (patch.attended === true && !prev.attended) {
    logAttendance("marked_attended", prev.id, prev.personId, prev.eventId, "Attended");
  }
  const hadTicket = patch.hasTicket ?? prev.hasTicket;
  if (patch.attended === false && prev.attended !== false && hadTicket) {
    logAttendance("marked_no_show", prev.id, prev.personId, prev.eventId, "No-show");
  }
}

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set, get) => ({
      attendances: seedAttendances(),
      forEvent: (eventId) => get().attendances.filter((a) => a.eventId === eventId),
      forPerson: (personId) => get().attendances.filter((a) => a.personId === personId),
      forEventAndPerson: (eventId, personId) =>
        get().attendances.find((a) => a.eventId === eventId && a.personId === personId),
      add: (eventId, personId) => {
        const existing = get().attendances.find(
          (a) => a.eventId === eventId && a.personId === personId,
        );
        if (existing) return existing;
        const a: Attendance = {
          id: crypto.randomUUID(),
          eventId,
          personId,
          hasTicket: false,
          leadershipQualified: false,
          specialEventQualified: false,
          updatedAt: new Date().toISOString(),
        };
        set({ attendances: [...get().attendances, a] });
        logAttendance("assigned_event", a.id, personId, eventId, "Assigned to event");
        return a;
      },
      update: (id, patch) => {
        const prev = get().attendances.find((a) => a.id === id);
        if (!prev) return;
        const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
        set({ attendances: get().attendances.map((a) => (a.id === id ? next : a)) });
        logChange(prev, patch);
      },
      remove: (id) => {
        const prev = get().attendances.find((a) => a.id === id);
        set({ attendances: get().attendances.filter((a) => a.id !== id) });
        if (prev) logAttendance("deleted", id, prev.personId, prev.eventId, "Removed from event");
      },
      bulkUpdate: (ids, patch) => {
        const now = new Date().toISOString();
        const wanted = new Set(ids);
        const changed = get().attendances.filter((a) => wanted.has(a.id));
        set({
          attendances: get().attendances.map((a) =>
            wanted.has(a.id) ? { ...a, ...patch, updatedAt: now } : a,
          ),
        });
        changed.forEach((prev) => logChange(prev, patch));
      },
      removeWhere: (pred) => set({ attendances: get().attendances.filter((a) => !pred(a)) }),
    }),
    {
      name: "levelup.attendance",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ attendances: s.attendances }),
      version: SEED_VERSION,
      migrate: () => ({ attendances: seedAttendances() }) as unknown as AttendanceState,
    },
  ),
);
