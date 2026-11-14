/**
 * The time of day of an event: pure, no stores, no clock, no time zone.
 *
 * An event has an optional start time and an optional end time, each a wall-clock "HH:mm" (24-hour
 * string, so it sorts as text) in the team's time zone (the workspace's). No time at all means the event
 * is all-day, exactly as events were before times existed. Rules:
 *
 *  - an end time needs a start time;
 *  - on a one-day event the end time is after the start time;
 *  - on a multi-day event the start time belongs to the first day and the end time to the last day, so
 *    the end time may be earlier than the start time.
 *
 * `timesOk` is the rule the database checks as `public.event_times_ok()` (migration
 * `20261030000100_event_times`); both are tested against the one table in `recurrence/cases.ts`.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/;

/** A time as "HH:mm" (a database "HH:mm:ss" loses its seconds), or undefined when it is empty or not a time. */
export function cleanTime(s: string | null | undefined): string | undefined {
  const m = TIME.exec((s ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : undefined;
}

/** "19:00" -> "7:00 PM"; "00:05" -> "12:05 AM". */
export function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "7:00 – 8:30 PM" (one am/pm when both are the same) or "11:00 AM – 1:00 PM". */
export function formatTimeSpan(start: string, end: string): string {
  const a = formatTime(start);
  const b = formatTime(end);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}

/** Whole days an event runs past its first day (0 for a one-day event). */
export const lengthDaysOf = (e: { date: string; endDate?: string }): number =>
  e.endDate && e.endDate > e.date
    ? Math.round((Date.parse(`${e.endDate}T00:00:00Z`) - Date.parse(`${e.date}T00:00:00Z`)) / 864e5)
    : 0;

/**
 * Whether these times are allowed on an event that runs `lengthDays` past its first day: no end time
 * without a start time, and on a one-day event the end is after the start.
 */
export function timesOk(lengthDays: number, start?: string | null, end?: string | null): boolean {
  if (!end) return true;
  if (!start) return false;
  return lengthDays > 0 || end > start;
}

/**
 * The end time an occurrence can keep when its start time or length changes underneath it: the end time
 * as it is when the pair is allowed, otherwise none (a time that no longer fits is dropped, never made up).
 */
export function fitEndTime(
  lengthDays: number,
  start?: string | null,
  end?: string | null,
): string | undefined {
  return end && timesOk(lengthDays, start, end) ? end : undefined;
}

/** What is wrong with the times of an event, in the words of the form; null when they are fine. */
export function timesProblem(e: {
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}): string | null {
  if (e.endTime && !e.startTime) return "An end time needs a start time.";
  if (!timesOk(lengthDaysOf(e), e.startTime, e.endTime))
    return "The end time must be after the start time.";
  return null;
}

/** The clock of an event's first day: "7:00 PM" (or "7:00 – 8:30 PM" on a one-day event); "" when all-day. */
export function timeText(e: {
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
}): string {
  if (!e.startTime) return "";
  if (e.endTime && lengthDaysOf(e) === 0) return formatTimeSpan(e.startTime, e.endTime);
  return formatTime(e.startTime);
}

/** `text` (a date as the caller writes it) with the event's time after it: "Nov 17 · 7:00 PM". Unchanged for an all-day event. */
export function withTime(
  text: string,
  e: { date: string; endDate?: string; startTime?: string; endTime?: string },
): string {
  const t = timeText(e);
  return t ? `${text} · ${t}` : text;
}

/**
 * A multi-day range with its times, each day's date as the caller writes it: "Nov 7 · 7:00 PM – Nov 9 · 5:00 PM".
 * The start time goes with the first day, the end time with the last.
 */
export function spanWithTimes(
  first: string,
  last: string,
  e: { startTime?: string; endTime?: string },
): string {
  const a = e.startTime ? `${first} · ${formatTime(e.startTime)}` : first;
  const b = e.endTime ? `${last} · ${formatTime(e.endTime)}` : last;
  return `${a} – ${b}`;
}

/** Orders events by first day, then by start time with all-day events first. Ties stay as they were. */
export function compareStart(
  a: { date: string; startTime?: string },
  b: { date: string; startTime?: string },
): number {
  return a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? "");
}
