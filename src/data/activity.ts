import { useMemo } from "react";
import { useActivityStore, type ActivityEvent } from "@/stores/activityStore";
import { useVisibleIds } from "./people";

/** Activity timeline for a visible person, newest first (empty if not visible). */
export function useActivity(personId: string | undefined): ActivityEvent[] {
  const events = useActivityStore((s) => s.events);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      personId && ids.has(personId)
        ? events
            .filter(
              (e) =>
                (e.entityType === "person" && e.entityId === personId) ||
                e.relatedPersonId === personId,
            )
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        : [],
    [events, ids, personId],
  );
}

/** Activity for an event, limited to rows about visible people, newest first. */
export function useEventActivity(eventId: string | undefined): ActivityEvent[] {
  const events = useActivityStore((s) => s.events);
  const ids = useVisibleIds();
  return useMemo(
    () =>
      eventId
        ? events
            .filter(
              (e) =>
                ((e.entityType === "event" && e.entityId === eventId) ||
                  e.relatedEventId === eventId) &&
                (!e.relatedPersonId || ids.has(e.relatedPersonId)),
            )
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        : [],
    [events, ids, eventId],
  );
}
