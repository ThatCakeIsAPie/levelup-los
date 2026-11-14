/**
 * THE WHITELIST: everything an agent can do. One entry per `public.agent_<name>` SQL function
 * (supabase/migrations/20261105000200_agent_tools.sql); nothing else is reachable. To add a tool:
 *   1. a SECURITY INVOKER `agent_<name>` function that starts with `agent_private.ctx()` and
 *      writes one audit row (a new migration),
 *   2. one entry below (arguments, description, whether it changes data),
 *   3. tests: pgTAP for the function (and the catalog list in 043), vitest for the entry.
 * tools.test.ts fails when the registry and the migrations disagree.
 *
 * Arguments are validated here (clear 400s) and again in SQL (the function is the real gate).
 * The SQL text lives here as constants; nothing a caller sends ever becomes SQL.
 */

import { icsFromData, type IcsData } from "./ics.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface FieldSpec {
  /** `date`: a calendar date "YYYY-MM-DD"; `timestamp`: an ISO 8601 time WITH an offset or Z. */
  type: "string" | "integer" | "date" | "timestamp";
  description: string;
  /** string: length in characters; integer: value */
  min?: number;
  max?: number;
  default?: number;
  enum?: readonly string[];
  nullable?: boolean;
  required?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Changes data: needs a connection with write access. */
  write: boolean;
  properties: Record<string, FieldSpec>;
  /** `select public.agent_<name>($1…) as r`, with explicit casts. */
  sql: string;
  /** The SQL parameters, from validated arguments. */
  params: (args: Record<string, Json>) => unknown[];
  /** Turns what the SQL function returned into what the caller gets (formatting only; no data of its own). */
  format?: (raw: unknown, now: Date) => unknown;
}

const PATCH_FIELDS = ["name", "phone", "email", "location", "notes"] as const;

const EVENT_WINDOW_PROPERTIES = (withChangedSince: boolean): Record<string, FieldSpec> => ({
  from: {
    type: "date",
    description: "First day of the window, YYYY-MM-DD (default: today for the team).",
  },
  until: {
    type: "date",
    description:
      "Last day of the window, YYYY-MM-DD (default: 8 weeks after from; at most 26 weeks after from, a later date is cut back and `capped` says so).",
  },
  ...(withChangedSince
    ? {
        changed_since: {
          type: "timestamp" as const,
          description:
            "ISO 8601 time with an offset or Z, e.g. 2026-11-14T18:00:00Z: only events changed after it (series are always all listed).",
        },
      }
    : {}),
});

const LIST_EVENTS_DESCRIPTION = [
  "The team's events and repeating events in a date window, in the terms of iCalendar (RFC 5545), so they map onto Google, Apple and Outlook calendars without guessing.",
  "Arguments: from (YYYY-MM-DD, default the team's today), until (YYYY-MM-DD, default 8 weeks after from, at most 26 weeks after it: a later date is cut back and `capped` is true), changed_since (ISO 8601 time with an offset: only events changed after it, to ask what changed).",
  "Result: {from, until, capped, timezone (the team's IANA zone), truncated (true when more than 500 events matched), events, series}.",
  "Each event: id (the CRM's own id, for set_event_answer), uid (iCalendar UID: stable and globally unique, never changes when the event is edited or moved; use it to find your calendar copy), summary (the name), description (the notes), location, category (the category's name), url (the ticket link, if any), last_modified (LAST-MODIFIED, ISO 8601 UTC), my_answer (the connected person's own answer: yes, no, maybe or null) and partstat (that answer as ACCEPTED, DECLINED, TENTATIVE or NEEDS-ACTION). Fields an event has no value for are left out (my_answer is the exception: null when there is no answer). There is no sequence.",
  "All-day events (all_day true): start_date and end_date_exclusive, the day AFTER the last day (DTEND;VALUE=DATE).",
  "Timed events (all_day false): start and end as local wall-clock ISO 8601 without offset in `timezone` (DTSTART;TZID=timezone), and start_utc and end_utc as UTC instants (correct across daylight-saving changes). An event with a start time and no end time has no end and no end_utc: treat it as a point in time or apply your own default length. A multi-day timed event starts at its start time on the first day and ends at its end time on the last day; with no end time it runs to the end of its last day (end is midnight after it).",
  "An occurrence of a repeating event also has series_uid, recurrence_id (the occurrence's ORIGINAL slot in its series, a date for an all-day series or a local date-time for a timed one: RECURRENCE-ID) and is_exception (true when this occurrence was changed on its own, moved off its slot, or otherwise differs from the series: it must be an exception to the series in the calendar).",
  "series: every repeating event with an occurrence in the window or still running, always complete (changed_since does not filter it, since a deleted occurrence only shows in exdates): series_uid, summary, description, location, category, url, all_day, the FIRST occurrence's start_date and end_date_exclusive or start, end, start_utc and end_utc, timezone, rrule (the RFC 5545 RRULE value without the 'RRULE:' prefix, repeating the first start in local time, so a timed series keeps its wall-clock time across daylight-saving changes), exdates (skipped occurrences: dates for an all-day series, local date-times for a timed one) and until (when it ends: a date, or a UTC time for a timed series, the same as in the rrule).",
  "Make ONE repeating calendar entry per series from rrule and exdates, and one exception per occurrence with is_exception true (its recurrence_id names the slot it replaces). A deleted single event is not listed: compare uids with your calendar.",
].join(" ");

const EXPORT_ICS_DESCRIPTION = [
  "The same window as list_upcoming_events (arguments from and until, same defaults and cap) as ONE complete iCalendar file (BEGIN:VCALENDAR, CRLF line ends, lines folded at 75 octets, text escaped) that a calendar can import, returned as the file's text.",
  "One VEVENT per repeating event carrying its RRULE and EXDATEs, one VEVENT with RECURRENCE-ID for each exception occurrence (UID = the series' uid), one VEVENT per other event; UID, DTSTAMP, LAST-MODIFIED, SUMMARY, DESCRIPTION, LOCATION, CATEGORIES and URL as the events have them. All-day events are VALUE=DATE with the exclusive end. Timed single events are UTC instants (DTSTART:...Z).",
  "A timed repeating event is ONE repeating entry, written as DTSTART;TZID=<the team's zone> with a VTIMEZONE, so it stays at the same wall-clock time across daylight-saving changes, but only when the zone's rules can be written as a yearly rule that matches the database's time zone data every year from the year before the series' first date for 31 years; otherwise, and for a timed repeating event that spans more than one day, its occurrences in the window are written as separate UTC events (each with its own uid, none repeating) and the file says so in a comment. An event with a start time and no end time has no DTEND: treat it as a point in time.",
  "A repeating event's master VEVENT has no LAST-MODIFIED (its occurrences' own times are on the exceptions).",
].join(" ");

export const TOOLS: readonly ToolDef[] = [
  {
    name: "whoami",
    description:
      "Who the connected person is: their name, stage and role, their team, today's date for the team, and what this connection may do (read or write). Call it first.",
    write: false,
    properties: {},
    sql: "select public.agent_whoami() as r",
    params: () => [],
  },
  {
    name: "list_prospects",
    description:
      "List the prospects the connected person can see: their own and their downline's. Each has id, name, phone, email, location, notes and sponsor_id.",
    write: false,
    properties: {
      limit: {
        type: "integer",
        description: "How many to return, 1 to 200 (default 50).",
        min: 1,
        max: 200,
        default: 50,
      },
    },
    sql: "select public.agent_list_prospects($1::int) as r",
    params: (a) => [a.limit ?? 50],
  },
  {
    name: "add_prospect",
    description:
      "Add a prospect under the connected person. Only a name and an optional phone number; use update_prospect to add more details afterwards.",
    write: true,
    properties: {
      name: {
        type: "string",
        description: "The prospect's name.",
        min: 1,
        max: 120,
        required: true,
      },
      phone: { type: "string", description: "Phone number (optional).", max: 40 },
    },
    sql: "select public.agent_add_prospect($1::text, $2::text) as r",
    params: (a) => [a.name, a.phone ?? null],
  },
  {
    name: "update_prospect",
    description:
      "Change a prospect's name, phone, email, location or notes. Send the id and only the fields to change; null clears a field (not the name). Nothing else about a person can be changed through this connector, and a field outside that list is refused.",
    write: true,
    properties: {
      id: {
        type: "string",
        description: "The prospect's id (from list_prospects).",
        min: 1,
        max: 100,
        required: true,
      },
      name: { type: "string", description: "New name.", min: 1, max: 120 },
      phone: {
        type: "string",
        description: "New phone number, or null to clear.",
        max: 40,
        nullable: true,
      },
      email: {
        type: "string",
        description: "New e-mail address, or null to clear.",
        max: 200,
        nullable: true,
      },
      location: {
        type: "string",
        description: "New location, or null to clear.",
        max: 200,
        nullable: true,
      },
      notes: {
        type: "string",
        description: "New notes (replaces the old text), or null to clear.",
        max: 4000,
        nullable: true,
      },
    },
    sql: "select public.agent_update_prospect($1::text, $2::text::jsonb) as r", // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
    params: (a) => {
      const patch: Record<string, Json> = {};
      for (const k of PATCH_FIELDS) if (k in a) patch[k] = a[k];
      return [a.id, JSON.stringify(patch)];
    },
  },
  {
    name: "list_upcoming_events",
    description: LIST_EVENTS_DESCRIPTION,
    write: false,
    properties: EVENT_WINDOW_PROPERTIES(true),
    sql: "select public.agent_list_upcoming_events($1::date, $2::date, $3::timestamptz) as r",
    params: (a) => [a.from ?? null, a.until ?? null, a.changed_since ?? null],
  },
  {
    name: "export_events_ics",
    description: EXPORT_ICS_DESCRIPTION,
    write: false,
    properties: EVENT_WINDOW_PROPERTIES(false),
    sql: "select public.agent_export_events_ics($1::date, $2::date) as r",
    params: (a) => [a.from ?? null, a.until ?? null],
    format: (raw, now) => icsFromData(raw as IcsData, now),
  },
  {
    name: "set_event_answer",
    description:
      "Set the connected person's own answer to an event: yes, no or maybe. It only ever sets their own answer, never anyone else's.",
    write: true,
    properties: {
      event_id: {
        type: "string",
        description: "The event's id (from list_upcoming_events).",
        min: 1,
        max: 100,
        required: true,
      },
      answer: {
        type: "string",
        description: "yes, no or maybe.",
        enum: ["yes", "no", "maybe"],
        required: true,
      },
    },
    sql: "select public.agent_set_event_answer($1::text, $2::text) as r",
    params: (a) => [a.event_id, a.answer],
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
}

export function inputSchema(t: ToolDef): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(t.properties)) {
    const p: Record<string, unknown> = {
      type: f.nullable ? [f.type, "null"] : f.type,
      description: f.description,
    };
    if (f.type === "string") {
      if (f.min !== undefined) p.minLength = f.min;
      if (f.max !== undefined) p.maxLength = f.max;
    } else if (f.type === "date" || f.type === "timestamp") {
      p.type = "string";
      p.format = f.type === "date" ? "date" : "date-time";
    } else {
      if (f.min !== undefined) p.minimum = f.min;
      if (f.max !== undefined) p.maximum = f.max;
    }
    if (f.default !== undefined) p.default = f.default;
    if (f.enum) p.enum = [...f.enum];
    properties[k] = p;
    if (f.required) required.push(k);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** The tool list as the plain HTTP surface and the pairing reply show it. */
export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    changes_data: t.write,
    input_schema: inputSchema(t),
  }));
}

const chars = (s: string) => Array.from(s).length;

/** A real calendar date, "YYYY-MM-DD" (2000 to 2100 is checked again in SQL). */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** An ISO 8601 date-time that names its offset (Z or +hh:mm), so it is one instant. */
export function isTimestamp(s: string): boolean {
  const m =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.exec(
      s,
    );
  return m !== null && isDate(m[1]) && !Number.isNaN(Date.parse(s));
}

export type Validated = { ok: true; args: Record<string, Json> } | { ok: false; error: string };

/** Check a call's arguments against the entry; unknown fields are refused, never ignored. */
export function validateArgs(t: ToolDef, raw: unknown): Validated {
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid arguments: send a JSON object." };
  }
  const given = input as Record<string, unknown>;
  const names = Object.keys(t.properties);
  const problems: string[] = [];
  for (const k of Object.keys(given)) {
    if (!Object.hasOwn(t.properties, k)) {
      problems.push(
        `${k}: not a field of ${t.name}` +
          (names.length ? ` (allowed: ${names.join(", ")})` : " (it takes no arguments)"),
      );
    }
  }
  const args: Record<string, Json> = {};
  for (const [k, f] of Object.entries(t.properties)) {
    if (!Object.hasOwn(given, k) || given[k] === undefined) {
      if (f.required) problems.push(`${k}: required`);
      else if (f.default !== undefined) args[k] = f.default;
      continue;
    }
    const v = given[k];
    if (v === null) {
      if (f.nullable) args[k] = null;
      else problems.push(`${k}: cannot be null`);
      continue;
    }
    if (f.type === "date") {
      if (typeof v !== "string" || !isDate(v)) problems.push(`${k}: must be a date, YYYY-MM-DD`);
      else args[k] = v;
    } else if (f.type === "timestamp") {
      if (typeof v !== "string" || !isTimestamp(v))
        problems.push(
          `${k}: must be an ISO 8601 time with an offset or Z, e.g. 2026-11-14T18:00:00Z`,
        );
      else args[k] = v;
    } else if (f.type === "string") {
      if (typeof v !== "string") problems.push(`${k}: must be text`);
      else if (f.enum && !f.enum.includes(v))
        problems.push(`${k}: must be one of ${f.enum.join(", ")}`);
      else if (f.min !== undefined && chars(v.trim()) < f.min)
        problems.push(`${k}: must not be empty`);
      else if (f.max !== undefined && chars(v) > f.max)
        problems.push(`${k}: at most ${f.max} characters`);
      else args[k] = v;
    } else if (typeof v !== "number" || !Number.isInteger(v)) {
      problems.push(`${k}: must be a whole number`);
    } else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
      problems.push(`${k}: must be between ${f.min} and ${f.max}`);
    } else args[k] = v;
  }
  if (
    t.name === "update_prospect" &&
    problems.length === 0 &&
    !PATCH_FIELDS.some((k) => k in args)
  ) {
    problems.push("nothing to change: give at least one of " + PATCH_FIELDS.join(", "));
  }
  if (problems.length) return { ok: false, error: "Invalid arguments: " + problems.join("; ") };
  return { ok: true, args };
}
