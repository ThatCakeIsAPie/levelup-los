/**
 * The maths of dragging an event to another day on the Events calendar (pure; tested in calendarDrag.test.ts).
 * The pointer handling is in useCalendarDrag.ts, the question and the write in calendarMove.tsx.
 *
 * The calendar has no time axis (a day is a cell, the events in it are rows), so a drop only ever changes the
 * DATE of an event: its start and end time stay, and so does its length in days.
 */
import { addDaysTo, daysBetween } from "@/data/recurrence/rule";
import { weekdayDay, type CalItem } from "./calendar";

/** Touch: how long a finger holds on an event before it is picked up (moving earlier scrolls). */
export const HOLD_MS = 350;
/** Mouse and pen: how far the pointer moves before the event is picked up. */
export const MOUSE_SLOP = 5;
/** Touch: how far a finger may drift during the hold before it counts as a scroll. */
export const TOUCH_SLOP = 8;
/** How close to the top or bottom of the calendar's scroller (px) counts as its edge. */
export const EDGE_PX = 44;
/** How far outside the scroller (px) the pointer still counts as being at its edge. */
export const EDGE_SLACK_PX = 16;
/** How long the pointer holds at an edge before the calendar pages (and again for each further page). */
export const EDGE_HOLD_MS = 700;

/**
 * Whether the viewer can pick this item up: they may edit events (the one check, `useCanManageEvents`) and it is a
 * stored event. A projected occurrence (computed from the series rule, not saved yet) has no event to move.
 */
export const canPickUp = (item: CalItem, canManage: boolean): boolean =>
  canManage && !item.projected && !!item.eventId;

/** The column (0 = Sunday to 6) a horizontal position falls in for a row that is `width` wide from `left`; -1 outside. */
export function columnAt(left: number, width: number, x: number): number {
  if (width <= 0 || x < left || x >= left + width) return -1;
  return Math.min(6, Math.floor(((x - left) / width) * 7));
}

/** The date under a point in the week row that starts on `weekStart`, or null when the point is outside the row. */
export function dayAt(weekStart: string, left: number, width: number, x: number): string | null {
  const c = columnAt(left, width, x);
  return c < 0 ? null : addDaysTo(weekStart, c);
}

/** The days an event moves when the day it was picked up on (`grabDay`) is dropped on `dropDay`. */
export const dayDelta = (grabDay: string, dropDay: string): number => daysBetween(grabDay, dropDay);

/**
 * The new date and end date of an item picked up on `grabDay` and dropped on `dropDay`, or null when that is the
 * same day (nothing moves). The item keeps its length: a multi-day event keeps its number of days, and the
 * day it is held by is the one that lands on the target (so a bar can be taken by its last day).
 */
export function dropDates(
  item: Pick<CalItem, "date" | "endDate">,
  grabDay: string,
  dropDay: string,
): { date: string; endDate?: string } | null {
  const delta = dayDelta(grabDay, dropDay);
  if (delta === 0) return null;
  return {
    date: addDaysTo(item.date, delta),
    endDate: item.endDate ? addDaysTo(item.endDate, delta) : undefined,
  };
}

/** Which way the pointer is pushing at the edge of a scroller: -1 up, 1 down, 0 neither. */
export function edgeDirection(
  rect: { left: number; right: number; top: number; bottom: number },
  x: number,
  y: number,
  edge = EDGE_PX,
  slack = EDGE_SLACK_PX,
): -1 | 0 | 1 {
  if (x < rect.left || x > rect.right) return 0;
  if (y < rect.top - slack || y > rect.bottom + slack) return 0;
  if (y < rect.top + edge) return -1;
  if (y > rect.bottom - edge) return 1;
  return 0;
}

/** How far one page of the calendar scrolls: most of what is visible, so the row at the edge stays in view. */
export const pageDistance = (clientHeight: number): number =>
  Math.max(48, Math.round(clientHeight * 0.84));

/** "Moved to Thu, Nov 19" for one event, "Moved 6 events" for several. */
export const movedToast = (date: string, moved: number): string =>
  moved > 1 ? `Moved ${moved} events` : `Moved to ${weekdayDay(date)}`;

/** "3 days later" / "1 day earlier". */
export function daysShift(days: number): string {
  const n = Math.abs(days);
  return `${n} ${n === 1 ? "day" : "days"} ${days > 0 ? "later" : "earlier"}`;
}
