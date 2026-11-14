/**
 * The events calendar's maths: pure, no stores, no clock (today is passed in), no time zone.
 *
 * Dates are "YYYY-MM-DD" strings and are counted as whole days of the UTC calendar (`dayNumber`
 * in the repeat rules), so a daylight-saving change, a leap day or a year end can not move a day
 * between weeks. Weeks start on Sunday.
 *
 * What is drawn:
 *  - stored events, as they are;
 *  - PROJECTED occurrences: the dates of a repeating series that are not stored yet (stored
 *    occurrences only reach about `HORIZON_DAYS` ahead), computed from the series rule. They are
 *    never written anywhere; they are recomputed on every render and disappear once the real
 *    occurrence is stored (the stored one wins, so nothing is shown twice).
 */
import type { CrmEvent, EventSeries } from "@/stores/eventsStore";
import { compareStart } from "@/data/eventTimes";
import { addDaysTo, dayNumber, nthDate, weekdayOf } from "@/data/recurrence/rule";

/** Weeks before the current week and after it that the grid reaches. */
export const WEEKS_BACK = 28;
export const WEEKS_AHEAD = 80;
/** Event rows in a week that the grid shows before it says "+N more" (that line takes the last one). */
export const MAX_SLOTS = 4;
/** A week row is never shorter than this many event rows. */
export const MIN_SLOTS = 2;
/** Safety stop for walking a series. */
const MAX_STEPS = 5000;

/** The Sunday on or before `date`. */
export const weekStartOf = (date: string): string => addDaysTo(date, -weekdayOf(date));

/** The seven dates of the week that starts on `start`. */
export const weekDays = (start: string): string[] =>
  Array.from({ length: 7 }, (_, i) => addDaysTo(start, i));

/** The Sundays of every week the grid shows: `back` before the current week to `ahead` after it. */
export function gridWeeks(today: string, back = WEEKS_BACK, ahead = WEEKS_AHEAD): string[] {
  const first = addDaysTo(weekStartOf(today), -7 * back);
  return Array.from({ length: back + ahead + 1 }, (_, i) => addDaysTo(first, 7 * i));
}

/** The last date of a grid (the Saturday of its last week). */
export const gridEnd = (weeks: string[]): string => addDaysTo(weeks[weeks.length - 1], 6);

/** One thing on the calendar: a stored event, or a projected occurrence of a series. */
export interface CalItem {
  /** Unique on the calendar. */
  key: string;
  /** The stored event's id; none for a projected occurrence (it has no page). */
  eventId?: string;
  name: string;
  categoryId: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  seriesId?: string;
  projected: boolean;
}

const lastDay = (i: Pick<CalItem, "date" | "endDate">): string =>
  i.endDate && i.endDate > i.date ? i.endDate : i.date;

/** Whether an item covers more than one day. */
export const isMultiDay = (i: Pick<CalItem, "date" | "endDate">): boolean => lastDay(i) > i.date;

const itemOf = (e: CrmEvent): CalItem => ({
  key: e.id,
  eventId: e.id,
  name: e.name,
  categoryId: e.categoryId,
  date: e.date,
  endDate: e.endDate,
  startTime: e.startTime,
  endTime: e.endTime,
  seriesId: e.seriesId,
  projected: false,
});

/**
 * The dates of each series that are still to come and not stored: every rule date from `today`
 * to `until`, within the series' end, never a skipped date (an occurrence deleted by itself) and
 * never a date a stored occurrence already holds (an occurrence keeps its `seriesDate` when it
 * is moved, so a moved one is not shown again in its old place either).
 */
export function projectOccurrences(
  series: readonly EventSeries[],
  events: readonly CrmEvent[],
  today: string,
  until: string,
): CalItem[] {
  const have = new Set<string>();
  for (const e of events)
    if (e.seriesId && e.seriesDate) have.add(`${e.seriesId}\u0001${e.seriesDate}`);
  const out: CalItem[] = [];
  for (const s of series) {
    if (s.endsOn && s.endsOn < today) continue;
    const skipped = new Set(s.skipped);
    for (let n = 0; n < MAX_STEPS; n++) {
      const slot = nthDate(s.freq, s.startsOn, n);
      if (slot > until || (s.endsOn && slot > s.endsOn)) break;
      if (slot < today || skipped.has(slot) || have.has(`${s.id}\u0001${slot}`)) continue;
      out.push({
        key: `${s.id}:${slot}`,
        name: s.name,
        categoryId: s.categoryId,
        date: slot,
        endDate: s.lengthDays > 0 ? addDaysTo(slot, s.lengthDays) : undefined,
        startTime: s.startTime,
        endTime: s.endTime,
        seriesId: s.id,
        projected: true,
      });
    }
  }
  return out;
}

/**
 * Everything the calendar draws, in day order (same day: by start time, all-day first, stored
 * before projected). `categoryId` limits it to one category, projected ones included.
 */
export function calendarItems(
  events: readonly CrmEvent[],
  series: readonly EventSeries[],
  today: string,
  until: string,
  categoryId?: string,
): CalItem[] {
  const keep = (c: string) => !categoryId || c === categoryId;
  const stored = events.filter((e) => keep(e.categoryId)).map(itemOf);
  const projected = projectOccurrences(
    series.filter((s) => keep(s.categoryId)),
    events,
    today,
    until,
  );
  return [...stored, ...projected].sort(
    (a, b) => compareStart(a, b) || Number(a.projected) - Number(b.projected),
  );
}

/** The items of each week of the grid (by the week's Sunday), each list in the order it came in. */
export function bucketByWeek(items: readonly CalItem[], weeks: string[]): Map<string, CalItem[]> {
  const out = new Map<string, CalItem[]>(weeks.map((w) => [w, []]));
  const first = weeks[0];
  const end = gridEnd(weeks);
  for (const it of items) {
    const last = lastDay(it);
    if (last < first || it.date > end) continue;
    let w = weekStartOf(it.date < first ? first : it.date);
    const stop = weekStartOf(last > end ? end : last);
    for (; w <= stop; w = addDaysTo(w, 7)) out.get(w)?.push(it);
  }
  return out;
}

/** An item's stretch within one week: columns 0 (Sunday) to 6 (Saturday). */
export interface Segment {
  item: CalItem;
  col0: number;
  col1: number;
  /** Event row within the week (0 = the first under the day number). */
  lane: number;
  /** The item started in an earlier week. */
  before: boolean;
  /** The item goes on into the next week. */
  after: boolean;
  /** The item covers more than one day (drawn as a bar). */
  multi: boolean;
}

export interface WeekLayout {
  start: string;
  days: string[];
  /** The segments that are drawn, in the order a person would tab through them (day, then row). */
  segments: Segment[];
  /** Per column: how many items of that day are not drawn ("+N more"); 0 when all are. */
  hidden: number[];
  /** Per column: every item of that day (also the ones not drawn), in day order. */
  perDay: CalItem[][];
  /** Event rows the week row needs (the "+N more" line counts as one). */
  slots: number;
}

/**
 * Places a week's items. Multi-day items go first, so a bar keeps one row across the days it
 * covers; then single-day items fill the lowest free row of their day. A day that has more than
 * `cap` items (or would need a row beyond `cap`) shows `cap - 1` rows and "+N more" on the last;
 * a bar is drawn only if every day it covers has room for it, so one bar is never half hidden.
 * With `moreBelow` the "+N more" does not take one of the `cap` rows: a day shows up to `cap`
 * items and, when it has more, "+N more" in one extra row under them (`slots` is `cap + 1` then).
 *
 * `start` is any date, not only a Sunday: the seven columns are `start` and the six days after
 * it (Home's week ahead starts today).
 */
export function layoutWeek(
  start: string,
  items: readonly CalItem[],
  cap = MAX_SLOTS,
  moreBelow = false,
): WeekLayout {
  const days = weekDays(start);
  const base = dayNumber(start);
  const segs: Segment[] = items.map((item) => {
    const last = lastDay(item);
    return {
      item,
      col0: Math.max(0, dayNumber(item.date) - base),
      col1: Math.min(6, dayNumber(last) - base),
      lane: -1,
      before: item.date < start,
      after: last > days[6],
      multi: last > item.date,
    };
  });

  const order = [...segs].sort((a, b) => {
    if (a.multi !== b.multi) return a.multi ? -1 : 1;
    if (a.multi)
      return (
        a.item.date.localeCompare(b.item.date) ||
        b.col1 - b.col0 - (a.col1 - a.col0) ||
        compareStart(a.item, b.item)
      );
    return compareStart(a.item, b.item);
  });
  const taken: boolean[][] = [];
  for (const s of order) {
    let lane = 0;
    for (;;) {
      const row = (taken[lane] ??= Array<boolean>(7).fill(false));
      let free = true;
      for (let c = s.col0; c <= s.col1; c++) if (row[c]) free = false;
      if (free) break;
      lane++;
    }
    s.lane = lane;
    for (let c = s.col0; c <= s.col1; c++) taken[lane][c] = true;
  }

  const count = Array<number>(7).fill(0);
  const deepest = Array<number>(7).fill(-1);
  for (const s of segs)
    for (let c = s.col0; c <= s.col1; c++) {
      count[c]++;
      deepest[c] = Math.max(deepest[c], s.lane);
    }
  // How many rows each day can show; a day that hides anything gives its last row to "+N more".
  const limit = count.map((n, c) => (moreBelow || (n <= cap && deepest[c] < cap) ? cap : cap - 1));
  let shown: Segment[] = segs;
  for (;;) {
    shown = segs.filter((s) => {
      for (let c = s.col0; c <= s.col1; c++) if (s.lane >= limit[c]) return false;
      return true;
    });
    const seen = Array<number>(7).fill(0);
    for (const s of shown) for (let c = s.col0; c <= s.col1; c++) seen[c]++;
    let changed = false;
    for (let c = 0; c < 7; c++)
      if (!moreBelow && seen[c] < count[c] && limit[c] > cap - 1) {
        limit[c] = cap - 1;
        changed = true;
      }
    if (!changed) break;
  }
  const seen = Array<number>(7).fill(0);
  for (const s of shown) for (let c = s.col0; c <= s.col1; c++) seen[c]++;
  const hidden = count.map((n, c) => n - seen[c]);

  const perDay: CalItem[][] = days.map(() => []);
  for (const s of [...segs].sort((a, b) => compareStart(a.item, b.item)))
    for (let c = s.col0; c <= s.col1; c++) perDay[c].push(s.item);

  const drawn = [...shown].sort((a, b) => a.col0 - b.col0 || a.lane - b.lane);
  const rows = drawn.reduce((m, s) => Math.max(m, s.lane + 1), 0);
  const slots = hidden.some((h) => h > 0)
    ? moreBelow
      ? cap + 1
      : cap
    : Math.max(rows, moreBelow ? 0 : MIN_SLOTS);
  return { start, days, segments: drawn, hidden, perDay, slots };
}

/** The items a day of Home's week ahead shows before "+N more". */
export const WEEK_AHEAD_SHOWN = 3;

/**
 * Home's week ahead: the seven days starting `today` (not Sunday to Saturday), laid out with the
 * calendar's own placement. Every stored event that touches those days, and every projected
 * occurrence of a repeating series (`calendarItems`), in the calendar's same-day order; a
 * multi-day item keeps one row across the days it covers, and one that began earlier is cut at
 * today (`before`). All categories: no filter.
 */
export function weekAhead(
  events: readonly CrmEvent[],
  series: readonly EventSeries[],
  today: string,
  shown = WEEK_AHEAD_SHOWN,
): WeekLayout {
  const end = addDaysTo(today, 6);
  const items = calendarItems(events, series, today, end).filter(
    (i) => i.date <= end && lastDay(i) >= today,
  );
  return layoutWeek(today, items, shown, true);
}

/** The items of one date (a day on the grid, from the grid's own buckets or the whole list). */
export const itemsOnDay = (items: readonly CalItem[], date: string): CalItem[] =>
  items.filter((i) => i.date <= date && lastDay(i) >= date);

// ---------------------------------------------------------------------------
// Labels (no Date objects: nothing here can move with the viewer's time zone)
// ---------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const WEEKDAY_NAMES = WEEKDAYS;
export const monthOf = (date: string): number => Number(date.slice(5, 7)) - 1;
export const dayOfMonth = (date: string): number => Number(date.slice(8, 10));
/** "Nov 14". */
export const shortDay = (date: string): string => `${MONTHS[monthOf(date)]} ${dayOfMonth(date)}`;
/** "Sat, Nov 14". */
export const weekdayDay = (date: string): string =>
  `${WEEKDAYS[weekdayOf(date)]}, ${shortDay(date)}`;

/** What a cell says: "Today, Nov 14", "Dec 1, 2026" on the first of a month, otherwise the day number. */
export function dayLabel(
  date: string,
  today: string,
): { text: string; kind: "today" | "month" | "day" } {
  if (date === today) return { text: `Today, ${shortDay(date)}`, kind: "today" };
  if (dayOfMonth(date) === 1)
    return { text: `${shortDay(date)}, ${date.slice(0, 4)}`, kind: "month" };
  return { text: String(dayOfMonth(date)), kind: "day" };
}
