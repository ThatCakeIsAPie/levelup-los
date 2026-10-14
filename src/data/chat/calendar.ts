/**
 * "Add to calendar" for event cards: an .ics file generated in the browser
 * and a Google Calendar link. Events are all-day ("YYYY-MM-DD" dates), so
 * there are no time zones to get wrong. Pure (download helper aside).
 */
import { addDays, format } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmEvent } from "@/stores/eventsStore";

const compact = (d: string) => d.replaceAll("-", "");
/** All-day end dates are exclusive in both iCalendar and Google Calendar. */
const endExclusive = (e: Pick<CrmEvent, "date" | "endDate">) =>
  format(addDays(parseDate(e.endDate ?? e.date), 1), "yyyyMMdd");

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

/** An iCalendar file with one all-day event. */
export function eventIcs(
  e: Pick<CrmEvent, "id" | "name" | "date" | "endDate" | "location" | "notes">,
  now: Date = new Date(),
): string {
  const stamp = format(now, "yyyyMMdd'T'HHmmss");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LevelUp LOS//Chats//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@levelup-los`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(e.date)}`,
    `DTEND;VALUE=DATE:${endExclusive(e)}`,
    `SUMMARY:${icsEscape(e.name)}`,
    ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
    ...(e.notes ? [`DESCRIPTION:${icsEscape(e.notes)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** Google Calendar "create event" link for an all-day event. */
export function googleCalendarUrl(
  e: Pick<CrmEvent, "name" | "date" | "endDate" | "location" | "notes">,
): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.name,
    dates: `${compact(e.date)}/${endExclusive(e)}`,
  });
  if (e.location) q.set("location", e.location);
  if (e.notes) q.set("details", e.notes);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** Download the .ics for an event (browser only). */
export function downloadEventIcs(
  e: Pick<CrmEvent, "id" | "name" | "date" | "endDate" | "location" | "notes">,
): void {
  const blob = new Blob([eventIcs(e)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${e.name.replace(/[^\w\- ]+/g, "").trim() || "event"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
