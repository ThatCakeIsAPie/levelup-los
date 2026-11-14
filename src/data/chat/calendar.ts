/**
 * "Add to calendar" for event cards: an .ics file generated in the browser
 * and a Google Calendar link. An event without a time is all-day ("YYYY-MM-DD" dates), so there is no
 * time zone to get wrong. An event with a start time is a timed entry; its wall-clock times are in the
 * team's time zone (src/data/workspaceTimezone), and the two exports say so differently:
 *
 *  - .ics: UTC instants (`DTSTART:20261118T010000Z`), worked out from the team's zone with the browser's
 *    own time zone data. RFC 5545 requires a VTIMEZONE component for every TZID a file uses, and a
 *    VTIMEZONE needs that zone's whole rule history; a bare `DTSTART;TZID=America/Chicago:...` is
 *    accepted by Apple and Google but is not a valid file and Outlook reads it as a floating time. A UTC
 *    instant needs no definition, is right on both sides of a daylight-saving change and for a
 *    multi-day event that spans one, and every calendar shows it in the viewer's own zone.
 *  - Google link: local times with `ctz` (the team's zone), which is Google's own form for it.
 *
 * With a start time and no end time the entry has no end (a point in time) on a one-day event and
 * runs to the end of the last day on a multi-day one. Pure (download helper aside).
 */
import { brand } from "@/brand/brand";
import { addDays, format } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmEvent } from "@/stores/eventsStore";
import { getWorkspaceTimezone } from "@/data/workspaceTimezone";

type Dated = Pick<CrmEvent, "date" | "endDate" | "startTime" | "endTime">;

const compact = (d: string) => d.replaceAll("-", "");
/** All-day end dates are exclusive in both iCalendar and Google Calendar. */
const endExclusive = (e: Pick<CrmEvent, "date" | "endDate">) =>
  format(addDays(parseDate(e.endDate ?? e.date), 1), "yyyyMMdd");

const HOUR = 3_600_000;
const formats = new Map<string, Intl.DateTimeFormat>();

/** How far `tz` is ahead of UTC at an instant, in ms. */
function offsetMs(utcMs: number, tz: string): number {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return wall - Math.floor(utcMs / 1000) * 1000;
}

/**
 * The instant a wall-clock date and time ("YYYY-MM-DD", "HH:mm") is in a time zone. A time that happens
 * twice (the clocks go back) is the first one; a time that never happens (the clocks go forward) is
 * moved on by the length of the gap, as calendar apps do.
 */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const before = offsetMs(wall - 24 * HOUR, tz);
  const after = offsetMs(wall + 24 * HOUR, tz);
  const fits = [before, after].filter((o) => offsetMs(wall - o, tz) === o);
  return new Date(wall - (fits.length ? Math.max(...fits) : before));
}

const stampUtc = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
const nextDay = (date: string) => format(addDays(parseDate(date), 1), "yyyy-MM-dd");

/** Where a timed event ends, as a wall-clock date and time: its end time, the end of its last day, or nowhere. */
function endOf(e: Dated): { date: string; time: string } | null {
  const last = e.endDate && e.endDate > e.date ? e.endDate : e.date;
  if (e.endTime) return { date: last, time: e.endTime };
  return last > e.date ? { date: nextDay(last), time: "00:00" } : null;
}

/** Escape text for an iCalendar property value (RFC 5545 3.3.11). */
export function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold lines longer than 75 octets (RFC 5545 3.1). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join("\r\n");
}

/** An iCalendar file with one event: all-day, or timed when it has a start time (the team's zone, see above). */
export function eventIcs(
  e: Pick<CrmEvent, "id" | "name" | "location" | "notes"> & Dated,
  now: Date = new Date(),
  timeZone?: string,
): string {
  let when = [`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${endExclusive(e)}`];
  if (e.startTime) {
    const tz = timeZone ?? getWorkspaceTimezone();
    const end = endOf(e);
    when = [
      `DTSTART:${stampUtc(zonedInstant(e.date, e.startTime, tz))}`,
      ...(end ? [`DTEND:${stampUtc(zonedInstant(end.date, end.time, tz))}`] : []),
    ];
  }
  const stamp = format(now, "yyyyMMdd'T'HHmmss");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${brand.name}//Chats//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@${brand.slug}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${icsEscape(e.name)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.notes ? [`DESCRIPTION:${icsEscape(e.notes)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar "create event" link: an all-day event, or a timed one with `dates` in local time and `ctz` the team's zone. */
export function googleCalendarUrl(
  e: Pick<CrmEvent, "name" | "location" | "notes"> & Dated,
  timeZone?: string,
): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.name,
    dates: `${compact(e.date)}/${endExclusive(e)}`,
  });
  if (e.startTime) {
    const local = (date: string, time: string) => `${compact(date)}T${time.replace(":", "")}00`;
    const end = endOf(e) ?? { date: e.date, time: e.startTime };
    q.set("dates", `${local(e.date, e.startTime)}/${local(end.date, end.time)}`);
    q.set("ctz", timeZone ?? getWorkspaceTimezone());
  }
  if (e.location) q.set("location", e.location);
  if (e.notes) q.set("details", e.notes);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Download the .ics for an event (browser only). */
export function downloadEventIcs(
  e: Pick<CrmEvent, "id" | "name" | "location" | "notes"> & Dated,
  timeZone?: string,
): void {
  const blob = new Blob([eventIcs(e, new Date(), timeZone)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.name.replace(/[^\w\- ]+/g, "").trim() || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
