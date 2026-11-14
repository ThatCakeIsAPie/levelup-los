/**
 * Writes the data of `public.agent_export_events_ics()` out as one iCalendar file (RFC 5545). Plain
 * TypeScript, no dependencies, nothing it can reach but its argument: the data comes from the SQL
 * function (run as the person, audited); this file only formats it.
 *
 *  - CRLF line ends, content lines folded at 75 octets (never inside a UTF-8 character), text escaped
 *    (backslash, semicolon, comma, newline).
 *  - One VEVENT per repeating event (RRULE, EXDATE), one VEVENT with RECURRENCE-ID per exception
 *    occurrence (same UID as its series), one VEVENT per other event.
 *  - All-day events are VALUE=DATE with the exclusive end date. Timed single events are UTC instants.
 *  - A timed repeating event is ONE repeating entry with `DTSTART;TZID=<zone>` and a VTIMEZONE built from
 *    the zone's yearly rules (the database proves them: see agent_private.zone_definition), so it stays at
 *    the same wall-clock time across daylight-saving changes. When the database could not write the zone's
 *    rules as a yearly rule (`timezone_definition` is null), or the series spans more than one day (RFC 5545
 *    repeats an exact duration, which would move the end by an hour across a clock change), its occurrences
 *    are written as separate UTC events, each with its own UID and a COMMENT saying so. A wrong repeat is
 *    never written.
 *  - PRODID names no brand; the UID of a single event is its own, of an exception its series'.
 */

export interface IcsTzObservance {
  kind: "STANDARD" | "DAYLIGHT";
  /** e.g. "-0500" */
  from: string;
  to: string;
  /** local date-time, basic format, e.g. "20251102T020000" */
  dtstart: string;
  rrule?: string;
}
export interface IcsTzDefinition {
  tzid: string;
  observances: IcsTzObservance[];
}
interface IcsWhen {
  all_day: boolean;
  start_date?: string;
  end_date_exclusive?: string;
  start?: string;
  end?: string;
  start_utc?: string;
  end_utc?: string;
}
export interface IcsEvent extends IcsWhen {
  id: string;
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  category?: string;
  url?: string;
  timezone?: string;
  last_modified: string;
  series_uid?: string;
  recurrence_id?: string;
  is_exception?: boolean;
}
export interface IcsSeries extends IcsWhen {
  series_uid: string;
  summary: string;
  description?: string;
  location?: string;
  category?: string;
  url?: string;
  timezone: string;
  rrule: string;
  exdates: string[];
}
export interface IcsData {
  timezone: string;
  events: IcsEvent[];
  series: IcsSeries[];
  timezone_definition: IcsTzDefinition | null;
}

export const PRODID = "-//Team CRM agent connector//Events//EN";

/** Escape text for a property value (RFC 5545 3.3.11). */
export function icsEscape(s: string): string {
  return Array.from(s.replace(/\r\n?/g, "\n"))
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c === 9 || c === 10 || (c >= 32 && c !== 127); // tab and newline stay; other controls go
    })
    .join("")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

const enc = new TextEncoder();

/** Fold a content line at 75 octets (RFC 5545 3.1); a continuation starts with one space. Never splits a character. */
export function fold(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = " ";
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

/** "2026-11-02T19:00:00" or "2026-11-02T19:00:00Z" or "2026-11-02" -> "20261102T190000" / "...Z" / "20261102". */
const compact = (s: string): string => s.replace(/[-:]/g, "");
const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
const tzParam = (tzid: string): string => (/[;:,"]/.test(tzid) ? `"${tzid}"` : tzid);

const prop = (name: string, value: string): string => `${name}:${value}`;
const text = (name: string, value: string | undefined): string[] =>
  value === undefined || value === "" ? [] : [prop(name, icsEscape(value))];

const sameDay = (a: string, b: string): boolean => a.slice(0, 10) === b.slice(0, 10);

/** Whether a series can be ONE repeating entry: all-day always; timed only with a zone definition and within one day. */
function repeatsAsOne(s: IcsSeries, tz: IcsTzDefinition | null): boolean {
  if (s.all_day) return true;
  if (!tz || !s.start) return false;
  return s.end === undefined || sameDay(s.start, s.end);
}

/** DTSTART/DTEND lines for a start and end. `local` = write timed values as TZID local times, else as UTC instants. */
function whenLines(w: IcsWhen, tzid: string | null): string[] {
  if (w.all_day) {
    return [
      `DTSTART;VALUE=DATE:${compact(w.start_date ?? "")}`,
      ...(w.end_date_exclusive ? [`DTEND;VALUE=DATE:${compact(w.end_date_exclusive)}`] : []),
    ];
  }
  if (tzid) {
    return [
      `DTSTART;TZID=${tzParam(tzid)}:${compact(w.start ?? "")}`,
      ...(w.end ? [`DTEND;TZID=${tzParam(tzid)}:${compact(w.end)}`] : []),
    ];
  }
  return [
    `DTSTART:${compact(w.start_utc ?? "")}`,
    ...(w.end_utc ? [`DTEND:${compact(w.end_utc)}`] : []),
  ];
}

function details(e: {
  summary: string;
  description?: string;
  location?: string;
  category?: string;
  url?: string;
}): string[] {
  return [
    ...text("SUMMARY", e.summary),
    ...text("DESCRIPTION", e.description),
    ...text("LOCATION", e.location),
    ...text("CATEGORIES", e.category),
    ...(e.url ? [prop("URL", e.url)] : []),
  ];
}

function vtimezone(tz: IcsTzDefinition): string[] {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${tzParam(tz.tzid)}`];
  for (const o of tz.observances) {
    lines.push(
      `BEGIN:${o.kind}`,
      `DTSTART:${o.dtstart}`,
      `TZOFFSETFROM:${o.from}`,
      `TZOFFSETTO:${o.to}`,
      ...(o.rrule ? [`RRULE:${o.rrule}`] : []),
      `END:${o.kind}`,
    );
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** The whole file for the data a window produced; `now` is the DTSTAMP of every event. */
export function icsFromData(data: IcsData, now: Date = new Date()): string {
  const tz = data.timezone_definition;
  const dtstamp = prop("DTSTAMP", stamp(now));
  const seriesByUid = new Map(data.series.map((s) => [s.series_uid, s]));
  const asOne = new Set(data.series.filter((s) => repeatsAsOne(s, tz)).map((s) => s.series_uid));
  const needsTz = data.series.some((s) => asOne.has(s.series_uid) && !s.all_day);
  /** The zone to write local times in: only when a VTIMEZONE is in the file. */
  const tzOn = needsTz && tz ? tz : null;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(tzOn ? vtimezone(tzOn) : []),
  ];

  // One entry per repeating event.
  for (const s of data.series) {
    if (!asOne.has(s.series_uid)) continue;
    lines.push(
      "BEGIN:VEVENT",
      prop("UID", s.series_uid),
      dtstamp,
      ...whenLines(s, s.all_day ? null : (tz?.tzid ?? null)),
      prop("RRULE", s.rrule),
      ...(s.exdates.length
        ? [
            s.all_day
              ? `EXDATE;VALUE=DATE:${s.exdates.map(compact).join(",")}`
              : `EXDATE;TZID=${tzParam(tz?.tzid ?? s.timezone)}:${s.exdates.map(compact).join(",")}`,
          ]
        : []),
      ...details(s),
      "END:VEVENT",
    );
  }

  // Exceptions, and every event that is not an occurrence of a repeating entry above.
  for (const e of data.events) {
    const s = e.series_uid ? seriesByUid.get(e.series_uid) : undefined;
    const inSeries = s !== undefined && asOne.has(s.series_uid);
    if (inSeries && !e.is_exception) continue; // the RRULE makes it
    lines.push("BEGIN:VEVENT");
    if (inSeries && s && e.recurrence_id) {
      lines.push(prop("UID", s.series_uid), dtstamp);
      const rid = s.all_day
        ? `RECURRENCE-ID;VALUE=DATE:${compact(e.recurrence_id)}`
        : `RECURRENCE-ID;TZID=${tzParam(tzOn?.tzid ?? s.timezone)}:${compact(e.recurrence_id)}`;
      lines.push(rid, ...whenLines(e, e.all_day ? null : (tzOn?.tzid ?? null)));
    } else {
      lines.push(prop("UID", e.uid), dtstamp, ...whenLines(e, null));
      if (e.series_uid)
        lines.push(
          prop(
            "COMMENT",
            icsEscape("An occurrence of a repeating event, sent as a separate event."),
          ),
        );
    }
    lines.push(...details(e), prop("LAST-MODIFIED", compact(e.last_modified)), "END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
