import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dataStorage, seedOr } from "./storage";
import { logAttendance } from "./activityStore";
import { seedAttendances, seedMissedNotes, SEED_VERSION } from "@/data/seed";

/**
 * How someone attends (or attended): in person or online. For events with
 * tickets it is also the ticket's type (an online ticket is "virtual").
 */
export type AttendMode = "in_person" | "virtual";
export type DesireLevel = "yes" | "no" | "maybe";

export interface Attendance {
  id: string;
  eventId: string;
  personId: string;
  desireToAttend?: DesireLevel;
  followUpDate?: string;
  hasTicket: boolean;
  /** In person or virtual: the ticket's type, or how they came (per event, no person default). */
  mode?: AttendMode;
  plannedPurchaseDate?: string;
  helperId?: string | null;
  leadershipQualified: boolean;
  specialEventQualified: boolean;
  notes?: string;
  /** Whether the person actually attended; drives No Shows roll-up. */
  attended?: boolean;
  updatedAt?: string;
}

/**
 * "Already handled" note on a missed-event follow-up (e.g. "talked at the
 * gym, she was sick"): written by an upline of the person, read by everyone
 * who can see the person. Clears the follow-up for all their uplines.
 */
export interface MissedEventNote {
  id: string;
  personId: string;
  /** The missed event the note is about. */
  eventId: string;
  note: string;
  /** Who wrote it (an upline); null once they have been removed. */
  byId: string | null;
  createdAt: string; // ISO
}

interface AttendanceState {
  attendances: Attendance[];
  missedNotes: MissedEventNote[];
  addMissedNote: (n: Omit<MissedEventNote, "id" | "createdAt">) => MissedEventNote;
  removeMissedNote: (id: string) => void;
  forEvent: (eventId: string) => Attendance[];
  forPerson: (personId: string) => Attendance[];
  forEventAndPerson: (eventId: string, personId: string) => Attendance | undefined;
  add: (eventId: string, personId: string) => Attendance;
  update: (id: string, patch: Partial<Attendance>) => void;
  remove: (id: string) => void;
  bulkUpdate: (ids: string[], patch: Partial<Attendance>) => void;
  /** Drop rows silently (cascade for a deleted person or event). */
  removeWhere: (pred: (a: Attendance) => boolean) => void;
  /** Drop missed-event notes silently (same cascades). */
  removeNotesWhere: (pred: (n: MissedEventNote) => boolean) => void;
}

/** Activity entries for a change: ticket bought, attended, no-show. */
function logChange(prev: Attendance, patch: Partial<Attendance>) {
  if (patch.hasTicket === true && !prev.hasTicket) {
    logAttendance("ticket_purchased", prev.id, prev.personId, prev.eventId, "Ticket purchased");
  }
  if (patch.attended === true && !prev.attended) {
    const mode = patch.mode ?? prev.mode;
    logAttendance(
      "marked_attended",
      prev.id,
      prev.personId,
      prev.eventId,
      mode === "virtual"
        ? "Attended virtually"
        : mode === "in_person"
          ? "Attended in person"
          : "Attended",
      mode ? { mode } : undefined,
    );
  }
  const hadTicket = patch.hasTicket ?? prev.hasTicket;
  if (patch.attended === false && prev.attended !== false && hadTicket) {
    logAttendance("marked_no_show", prev.id, prev.personId, prev.eventId, "No-show");
  }
}

export const useAttendanceStore = create<AttendanceState>()(
  persist(
    (set, get) => ({
      attendances: seedOr(seedAttendances, []),
      missedNotes: seedOr(seedMissedNotes, []),
      addMissedNote: (n) => {
        const note: MissedEventNote = {
          ...n,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        };
        set({ missedNotes: [note, ...get().missedNotes] });
        return note;
      },
      removeMissedNote: (id) => set({ missedNotes: get().missedNotes.filter((n) => n.id !== id) }),
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
      removeNotesWhere: (pred) => set({ missedNotes: get().missedNotes.filter((n) => !pred(n)) }),
    }),
    {
      name: "levelup.attendance",
      storage: dataStorage(),
      partialize: (s) => ({ attendances: s.attendances, missedNotes: s.missedNotes }),
      version: SEED_VERSION,
      migrate: () =>
        ({
          attendances: seedAttendances(),
          missedNotes: seedMissedNotes(),
        }) as unknown as AttendanceState,
    },
  ),
);
