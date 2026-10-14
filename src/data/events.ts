import { useMemo } from "react";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useAttendanceStore, type Attendance } from "@/stores/attendanceStore";
import { useOpsStore } from "@/stores/opsStore";
import { IS_SUPABASE } from "@/lib/config";
import { serverSide } from "./remote";
import { upcomingAttentionCount } from "./attention";
import { useDoNotContactIds } from "./customerPipeline/hooks";
import { localDate } from "@/lib/dates";
import { filterAttendances } from "./access";
import { useVisibleIds } from "./people";

const byDateAsc = (a: CrmEvent, b: CrmEvent) => a.date.localeCompare(b.date);

/** Whether an event has not finished yet (its last day is today or later). */
export function isUpcoming(e: CrmEvent, today = localDate()): boolean {
  return (e.endDate ?? e.date) >= today;
}

/** Every event (all roles see the list), oldest first. */
export function useEvents(): CrmEvent[] {
  const events = useEventsStore((s) => s.events);
  return useMemo(() => [...events].sort(byDateAsc), [events]);
}

/** Events that haven't finished yet, soonest first. */
export function useUpcomingEvents(): CrmEvent[] {
  const events = useEvents();
  return useMemo(() => {
    const today = localDate();
    return events.filter((e) => isUpcoming(e, today));
  }, [events]);
}

/** Finished events, most recent first. */
export function usePastEvents(): CrmEvent[] {
  const events = useEvents();
  return useMemo(() => {
    const today = localDate();
    return events.filter((e) => !isUpcoming(e, today)).reverse();
  }, [events]);
}

/** The next upcoming event, optionally of one type (e.g. "conference"). */
export function useNextEvent(type?: CrmEvent["type"]): CrmEvent | undefined {
  const upcoming = useUpcomingEvents();
  return useMemo(() => upcoming.find((e) => !type || e.type === type), [upcoming, type]);
}

/** One event by id, or undefined. */
export function useEvent(id: string | undefined): CrmEvent | undefined {
  const events = useEventsStore((s) => s.events);
  return useMemo(() => events.find((e) => e.id === id), [events, id]);
}

/** Attendance rows for an event, limited to people the current user may see. */
export function useAttendancesForEvent(eventId: string | undefined): Attendance[] {
  const all = useAttendanceStore((s) => s.attendances);
  const ids = useVisibleIds();
  return useMemo(
    () => (eventId ? filterAttendances(all, ids).filter((a) => a.eventId === eventId) : []),
    [all, ids, eventId],
  );
}

/** A person's attendance rows across events (empty if the person isn't visible). */
export function useAttendancesForPerson(personId: string | undefined): Attendance[] {
  const all = useAttendanceStore((s) => s.attendances);
  const ids = useVisibleIds();
  return useMemo(
    () => (personId && ids.has(personId) ? all.filter((a) => a.personId === personId) : []),
    [all, ids, personId],
  );
}

/** Every attendance row the current user may see (all events). */
export function useVisibleAttendances(): Attendance[] {
  const all = useAttendanceStore((s) => s.attendances);
  const ids = useVisibleIds();
  return useMemo(() => filterAttendances(all, ids), [all, ids]);
}

/**
 * Visible people needing attention on events that haven't finished yet (same
 * rule as the event cards: attentionItems in ./attention). Drives the count
 * badge on the Events nav item.
 */
export function useEventsAttentionCount(): number {
  const upcoming = useUpcomingEvents();
  const rows = useVisibleAttendances();
  const skip = useDoNotContactIds();
  return useMemo(
    () => upcomingAttentionCount(upcoming, rows, undefined, skip),
    [upcoming, rows, skip],
  );
}

// ---- Mutations ----

/** Create an event. */
export function addEvent(e: Omit<CrmEvent, "id">): CrmEvent {
  return useEventsStore.getState().add(e);
}

/** Patch an event. */
export function updateEvent(id: string, patch: Partial<CrmEvent>): void {
  useEventsStore.getState().update(id, patch);
}

/** Delete an event with its attendance rows, travel plans, shared costs and their payments. */
export function removeEvent(id: string): void {
  const cascade = () => {
    useAttendanceStore.getState().removeWhere((a) => a.eventId === id);
    useOpsStore.getState().removeEvent(id);
  };
  // Real accounts: the database removes the event's rows by foreign-key
  // cascade, so only the event itself is written.
  if (IS_SUPABASE) serverSide(cascade);
  useEventsStore.getState().remove(id);
  if (!IS_SUPABASE) cascade();
}

/** Add a person to an event's roster (returns the existing row if already there). */
export function assignToEvent(eventId: string, personId: string): Attendance {
  return useAttendanceStore.getState().add(eventId, personId);
}

/** Patch an attendance row (ticket, desire, helper, attended...). */
export function updateAttendance(id: string, patch: Partial<Attendance>): void {
  useAttendanceStore.getState().update(id, patch);
}

/** Remove an attendance row. */
export function removeAttendance(id: string): void {
  useAttendanceStore.getState().remove(id);
}

/** Patch many attendance rows at once (logs the same activity as single updates). */
export function bulkUpdateAttendances(ids: string[], patch: Partial<Attendance>): void {
  useAttendanceStore.getState().bulkUpdate(ids, patch);
}
