/**
 * Quick attendance and missed-event follow-ups: hooks and writes (rules in
 * ./info and ./missed; the kinds of event are src/data/eventCategories).
 */
import { useMemo } from "react";
import {
  useAttendanceStore,
  type AttendMode,
  type MissedEventNote,
} from "@/stores/attendanceStore";
import { useCrmStore } from "@/stores/crmStore";
import { localDate } from "@/lib/dates";
import { usePeopleStore } from "@/stores/peopleStore";
import { getViewer, useCurrentUser, useViewer } from "../session";
import { isUplineOf } from "../growth/hooks";
import { useVisibleIds, useVisiblePeople } from "../people";
import { useEvents, useVisibleAttendances, assignToEvent, updateAttendance } from "../events";
import { canManageEvents } from "./info";
import { useUnlocks } from "../team/hooks";
import { useEventCategoriesStore } from "../eventCategories/store";
import { useDoNotContactIds } from "../customerPipeline/hooks";
import {
  missedAudience,
  missedEventStreaks,
  openMissedFollowUps,
  type MissedStreak,
} from "./missed";

/** May the viewer create and edit events? (the one check; see `canManageEvents`). */
export function useCanManageEvents(): boolean {
  const user = useCurrentUser();
  const eventPlanning = useUnlocks().can.eventPlanning;
  return canManageEvents({ role: user.role, eventPlanning });
}

/** Missed-event notes about people the viewer can see, newest first. */
export function useMissedNotes(): MissedEventNote[] {
  const notes = useAttendanceStore((s) => s.missedNotes);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      notes
        .filter((n) => ids.has(n.personId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [notes, ids],
  );
}

/**
 * Every current missed streak among the people the viewer can see (handled
 * or not, the viewer's own included), worked out once per change.
 */
export function useMissedStreaks(): MissedStreak[] {
  const events = useEvents();
  const attendances = useVisibleAttendances();
  const contacts = useCrmStore((s) => s.contacts);
  const notes = useMissedNotes();
  const ids = useVisibleIds();
  const categories = useEventCategoriesStore((s) => s.categories);
  return useMemo(
    () =>
      missedEventStreaks({
        events,
        attendances,
        contacts: contacts.filter((c) => ids.has(c.personId)),
        notes,
        today: localDate(),
        categories,
      }),
    [events, attendances, contacts, notes, ids, categories],
  );
}

/**
 * Open follow-ups for the viewer's Today list: registered team members
 * (apprentices and IBOs) they can see, and customers of theirs or their
 * team's (`missedAudience`; not in "Do not contact"), who missed an event of
 * a category they came to last time, not handled yet by anyone. Never the
 * viewer's own.
 */
export function useMissedFollowUps(): MissedStreak[] {
  const streaks = useMissedStreaks();
  const people = useVisiblePeople();
  const user = useCurrentUser();
  const skip = useDoNotContactIds();
  return useMemo(() => {
    if (user.role === "candidate") return [];
    const audience = missedAudience(people, user.personId, new Date(), skip);
    return openMissedFollowUps(streaks, user.personId, audience);
  }, [streaks, people, user, skip]);
}

/**
 * May the viewer follow up this person's missed events (check in, "Already
 * handled")? Their uplines; for a customer, the customer's owner and the
 * owner's uplines (the database's rule for notes).
 */
export function useCanFollowUpMissed(personId: string | undefined): boolean {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  return useMemo(() => {
    if (!personId || !viewer || viewer.role === "candidate") return false;
    const p = people.find((x) => x.id === personId);
    if (p?.bizClass === "customer") {
      if (!ids.has(personId) || !p.ownerId) return false;
      return p.ownerId === viewer.personId || isUplineOf(people, ids, viewer, p.ownerId);
    }
    return isUplineOf(people, ids, viewer, personId);
  }, [people, ids, viewer, personId]);
}

/** A person's current missed streaks (handled or not), latest first. */
export function useMissedForPerson(personId: string | undefined): MissedStreak[] {
  const streaks = useMissedStreaks();
  return useMemo(() => streaks.filter((s) => s.personId === personId), [streaks, personId]);
}

/** Streaks that include this event as a miss (people who came last time and not to this one). */
export function useMissedAtEvent(eventId: string | undefined): MissedStreak[] {
  const streaks = useMissedStreaks();
  return useMemo(
    () => streaks.filter((s) => s.missed.some((e) => e.id === eventId)),
    [streaks, eventId],
  );
}

// ---- Writes ----

/**
 * Record whether someone came to an event, and how: `mode` in person or
 * virtual marks them attended; `false` marks them as not there; `null`
 * clears it. Adds them to the event's list if they aren't on it yet. Returns
 * a function that puts the row back as it was (for Undo).
 */
export function setEventAttendance(
  eventId: string,
  personId: string,
  mode: AttendMode | false | null,
): () => void {
  const store = useAttendanceStore.getState();
  const existing = store.forEventAndPerson(eventId, personId);
  const row = existing ?? assignToEvent(eventId, personId);
  const before = { attended: row.attended, mode: row.mode };
  updateAttendance(
    row.id,
    mode === null
      ? { attended: undefined }
      : mode === false
        ? { attended: false }
        : { attended: true, mode },
  );
  return () => {
    if (existing) updateAttendance(row.id, before);
    else useAttendanceStore.getState().remove(row.id);
  };
}

/**
 * Leave an "already handled" note on someone's missed event, as the viewer.
 * Only their uplines may (the database refuses anyone else); returns the note.
 */
export function addMissedNote(personId: string, eventId: string, note: string): MissedEventNote {
  return useAttendanceStore
    .getState()
    .addMissedNote({ personId, eventId, note: note.trim(), byId: getViewer()?.personId ?? null });
}

/** Remove a note (its author only). */
export function removeMissedNote(id: string): void {
  useAttendanceStore.getState().removeMissedNote(id);
}
