/**
 * How people join events, and who may plan them (pure). What used to come
 * from the six fixed event types now comes from the event's category
 * (src/data/eventCategories: `allowsVirtual`, `usesTickets`, `usesTravel`,
 * `eventFormat`, `eventModes`).
 */
import type { EventFormat } from "@/stores/eventsStore";
import type { AttendMode } from "@/stores/attendanceStore";
import type { Role } from "@/stores/sessionStore";

export const EVENT_FORMAT_LABEL: Record<EventFormat, string> = {
  in_person: "In person",
  virtual: "Virtual",
  both: "In person + virtual",
};

export const MODE_LABEL: Record<AttendMode, string> = {
  in_person: "In person",
  virtual: "Virtual",
};

/**
 * Who may create and edit events. THE one permission check for event
 * planning: every page and the Log sheet call this (through
 * `useCanManageEvents()` / `canManageEvents()`). Adding an event category
 * from the event form follows it too (`canCreateCategories`).
 *
 * The rule is the "event planning" unlock (src/data/unlocks.ts): leaders,
 * their deputies, the admin account and anyone 3/10 and up; never
 * candidates. Pass `eventPlanning` from `useUnlocks().can.eventPlanning`;
 * without it only the old floor applies (no candidates). The database lets
 * anyone who isn't a candidate add events (milestones run in the app), and
 * the creator, moderators, leaders and deputies edit or delete them.
 */
export function canManageEvents(viewer: { role: Role; eventPlanning?: boolean }): boolean {
  if (viewer.role === "candidate") return false;
  return viewer.eventPlanning ?? true;
}
