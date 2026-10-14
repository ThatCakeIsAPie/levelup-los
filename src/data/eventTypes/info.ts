/**
 * Event types and how people join them (pure). The MVP plan's table
 * (docs/plans/mvp-plan-2026-10-13.md "Events"):
 *
 *   | Type                 | In person | Virtual | Tickets | Travel |
 *   | Info session         | ✓         | ✓       |         |        |
 *   | Work session         | ✓         |         |         |        |
 *   | Night Owls           | ✓         |         |         |        |
 *   | Training             | ✓         | ✓       |         |        |
 *   | Monthly team meeting | ✓         | ✓       | ✓       |        |
 *   | Conference           | ✓         | ✓       | ✓       | ✓      |
 *
 * Tickets and travel are about how heavy the event page is: conferences keep
 * the whole ticket / travel / shared-cost / qualification toolkit, the monthly
 * meeting keeps tickets, and the smaller recurring events get a light roster
 * (who's coming, who came, in person or online).
 */
import type { CrmEvent, EventFormat, EventType } from "@/stores/eventsStore";
import type { AttendMode } from "@/stores/attendanceStore";
import type { Role } from "@/stores/sessionStore";

export interface EventTypeInfo {
  label: string;
  /** Plural for filters and headings ("Night Owls", "Trainings"). */
  plural: string;
  /** One line for the type picker. */
  hint: string;
  /** Can be joined online (otherwise in person only). */
  virtual: boolean;
  /** Uses tickets (buy-by dates, ticket reminders, the ticket funnel). */
  tickets: boolean;
  /** Uses travel plans, shared costs and qualifications. */
  travel: boolean;
}

/** Display order: the small recurring ones first, the conference last. */
export const EVENT_TYPES: readonly EventType[] = [
  "night_owls",
  "work_session",
  "info_session",
  "training",
  "monthly_meeting",
  "conference",
];

export const EVENT_TYPE_INFO: Record<EventType, EventTypeInfo> = {
  info_session: {
    label: "Info session",
    plural: "Info sessions",
    hint: "Introduce new people to the business",
    virtual: true,
    tickets: false,
    travel: false,
  },
  work_session: {
    label: "Work session",
    plural: "Work sessions",
    hint: "Work on the business together",
    virtual: false,
    tickets: false,
    travel: false,
  },
  night_owls: {
    label: "Night Owls",
    plural: "Night Owls",
    hint: "The weekly late-night get-together",
    virtual: false,
    tickets: false,
    travel: false,
  },
  training: {
    label: "Training",
    plural: "Trainings",
    hint: "Skills and how-tos",
    virtual: true,
    tickets: false,
    travel: false,
  },
  monthly_meeting: {
    label: "Monthly team meeting",
    plural: "Monthly team meetings",
    hint: "Recognition and the month ahead",
    virtual: true,
    tickets: true,
    travel: false,
  },
  conference: {
    label: "Conference",
    plural: "Conferences",
    hint: "Tickets, travel and shared costs",
    virtual: true,
    tickets: true,
    travel: true,
  },
};

export const EVENT_TYPE_LABEL: Record<EventType, string> = Object.fromEntries(
  EVENT_TYPES.map((t) => [t, EVENT_TYPE_INFO[t].label]),
) as Record<EventType, string>;

/** True for a known type code (rows from older clients are checked by the database). */
export const isEventType = (t: unknown): t is EventType =>
  typeof t === "string" && t in EVENT_TYPE_INFO;

export const allowsVirtual = (t: EventType) => EVENT_TYPE_INFO[t].virtual;
export const usesTickets = (t: EventType) => EVENT_TYPE_INFO[t].tickets;
export const usesTravel = (t: EventType) => EVENT_TYPE_INFO[t].travel;

/**
 * The event's format, made valid for its type: in person unless set, and
 * never virtual for a type that is in person only.
 */
export function eventFormat(e: Pick<CrmEvent, "type" | "format">): EventFormat {
  const f = e.format ?? "in_person";
  return allowsVirtual(e.type) ? f : "in_person";
}

/** The ways an event can be attended, in person first. */
export function eventModes(e: Pick<CrmEvent, "type" | "format">): AttendMode[] {
  const f = eventFormat(e);
  return f === "both" ? ["in_person", "virtual"] : [f];
}

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
 * `useCanManageEvents()` / `canManageEvents()`).
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
