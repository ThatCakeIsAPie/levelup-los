import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logAttendance } from "./activityStore";

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
}

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set, get) => ({
      attendances: makeSeed(),
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

        if (patch.hasTicket === true && !prev.hasTicket) {
          logAttendance("ticket_purchased", id, prev.personId, prev.eventId, "Ticket purchased");
        }
        if (patch.attended === true && !prev.attended) {
          logAttendance("marked_attended", id, prev.personId, prev.eventId, "Attended");
        }
        if (patch.attended === false && prev.attended !== false && prev.hasTicket) {
          logAttendance("marked_no_show", id, prev.personId, prev.eventId, "No-show");
        }
      },
      remove: (id) => {
        const prev = get().attendances.find((a) => a.id === id);
        set({ attendances: get().attendances.filter((a) => a.id !== id) });
        if (prev) logAttendance("deleted", id, prev.personId, prev.eventId, "Removed from event");
      },
      bulkUpdate: (ids, patch) => {
        const now = new Date().toISOString();
        set({
          attendances: get().attendances.map((a) =>
            ids.includes(a.id) ? { ...a, ...patch, updatedAt: now } : a,
          ),
        });
      },
    }),
    {
      name: "levelup.attendance",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ attendances: s.attendances }),
    },
  ),
);

function makeSeed(): Attendance[] {
  // Seeded combos so funnel / audit / engagement views have data to show.
  // Keep IDs stable for dev.
  const mk = (
    id: string,
    eventId: string,
    personId: string,
    o: Partial<Attendance> = {},
  ): Attendance => ({
    id,
    eventId,
    personId,
    hasTicket: false,
    leadershipQualified: false,
    specialEventQualified: false,
    ...o,
  });
  return [
    // SpringConference26 (upcoming, e1)
    mk("a1", "e1", "1", {
      desireToAttend: "yes",
      hasTicket: true,
      ticketType: "in_person",
      leadershipQualified: true,
    }),
    mk("a2", "e1", "2", { desireToAttend: "yes", hasTicket: true, ticketType: "in_person" }),
    mk("a3", "e1", "3", {
      desireToAttend: "yes",
      hasTicket: false,
      plannedPurchaseDate: "2026-05-15",
      followUpDate: "2026-06-03",
      helperId: "1",
    }),
    mk("a4", "e1", "4", {
      desireToAttend: "yes",
      hasTicket: false,
      plannedPurchaseDate: "2026-05-30",
      helperId: "2",
    }),
    mk("a5", "e1", "5", { desireToAttend: "maybe", hasTicket: false, followUpDate: "2026-06-05" }),
    mk("a6", "e1", "6", { desireToAttend: "yes", hasTicket: true, ticketType: "stream" }),
    mk("a7", "e1", "7", {
      desireToAttend: "yes",
      hasTicket: false,
      plannedPurchaseDate: "2025-05-15",
    }),
    mk("a8", "e1", "8", { desireToAttend: "yes", hasTicket: true, ticketType: "in_person" }),
    mk("a9", "e1", "9", { desireToAttend: "no" }),
    mk("a10", "e1", "11", { desireToAttend: "yes", hasTicket: false, helperId: "7" }),
    // SpringConference25 (last year, e2)
    mk("b1", "e2", "1", {
      desireToAttend: "yes",
      hasTicket: true,
      attended: true,
      ticketType: "in_person",
    }),
    mk("b2", "e2", "2", {
      desireToAttend: "yes",
      hasTicket: true,
      attended: true,
      ticketType: "in_person",
    }),
    mk("b3", "e2", "3", {
      desireToAttend: "yes",
      hasTicket: true,
      attended: false,
      ticketType: "in_person",
    }),
    mk("b4", "e2", "6", {
      desireToAttend: "yes",
      hasTicket: true,
      attended: true,
      ticketType: "stream",
    }),
    mk("b5", "e2", "8", {
      desireToAttend: "yes",
      hasTicket: true,
      attended: true,
      ticketType: "in_person",
    }),
    mk("b6", "e2", "13", { desireToAttend: "yes", hasTicket: true, attended: true }),
    mk("b7", "e2", "17", { desireToAttend: "yes", hasTicket: true, attended: false }),
    // SummerConference25 (prior, e3)
    mk("c1", "e3", "1", { desireToAttend: "yes", hasTicket: true, attended: true }),
    mk("c2", "e3", "2", { desireToAttend: "yes", hasTicket: true, attended: true }),
    mk("c3", "e3", "4", { desireToAttend: "yes", hasTicket: true, attended: true }),
    mk("c4", "e3", "8", { desireToAttend: "yes", hasTicket: true, attended: false }),
    // June Team Meeting (e4)
    mk("d1", "e4", "1", { desireToAttend: "yes", hasTicket: true }),
    mk("d2", "e4", "4", { desireToAttend: "yes", hasTicket: false, followUpDate: "2026-06-01" }),
    mk("d3", "e4", "11", { desireToAttend: "maybe" }),
  ];
}
