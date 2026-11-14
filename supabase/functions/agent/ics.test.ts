import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fold,
  icsEscape,
  icsFromData,
  type IcsData,
  type IcsEvent,
  type IcsSeries,
} from "./ics.ts";

const GOLDEN = join(__dirname, "testdata/export.golden.ics");
const NOW = new Date("2026-11-14T12:00:00Z");

// The zone's rules exactly as agent_private.zone_definition('America/Chicago', 2025) returns them (pgTAP 046).
const CHICAGO = {
  tzid: "America/Chicago",
  observances: [
    {
      kind: "DAYLIGHT" as const,
      from: "-0600",
      to: "-0500",
      dtstart: "20250309T020000",
      rrule: "FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    },
    {
      kind: "STANDARD" as const,
      from: "-0500",
      to: "-0600",
      dtstart: "20251102T020000",
      rrule: "FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
    },
  ],
};

const base = { last_modified: "2026-11-01T12:00:00Z" };
const day = (id: string, summary: string, start: string, endExcl: string): IcsEvent => ({
  id,
  uid: `${id}@events.invalid`,
  summary,
  all_day: true,
  start_date: start,
  end_date_exclusive: endExcl,
  ...base,
});

const LONG_NOTES =
  "Bring your own notebook; we start with introductions, then the plan for the quarter, then questions. " +
  "Ünïcödé and emoji 🎉 are fine, but a line must never be cut inside a character: café, naïve, 日本語のメモ。" +
  "\nSecond paragraph with a backslash \\ and a comma, and a semicolon;";

const events: IcsEvent[] = [
  {
    ...day("ev-day", "Training day", "2026-11-10", "2026-11-11"),
    description: "Wear a badge",
    location: "Hall A",
    category: "Conference",
    url: "https://tickets.example.test/day",
  },
  {
    id: "ev-timed",
    uid: "ev-timed@events.invalid",
    summary: "Evening call",
    category: "Training",
    all_day: false,
    start: "2026-11-12T19:00:00",
    end: "2026-11-12T20:30:00",
    timezone: "America/Chicago",
    start_utc: "2026-11-13T01:00:00Z",
    end_utc: "2026-11-13T02:30:00Z",
    last_modified: "2026-06-15T08:30:45Z",
  },
  {
    id: "ev-noend",
    uid: "ev-noend@events.invalid",
    summary: "Open house",
    all_day: false,
    start: "2026-11-13T18:00:00",
    timezone: "America/Chicago",
    start_utc: "2026-11-14T00:00:00Z",
    ...base,
  },
  {
    id: "ev-multi",
    uid: "ev-multi@events.invalid",
    summary: "Summit",
    location: "Austin",
    all_day: false,
    start: "2026-11-27T17:00:00",
    end: "2026-11-29T11:00:00",
    timezone: "America/Chicago",
    start_utc: "2026-11-27T23:00:00Z",
    end_utc: "2026-11-29T17:00:00Z",
    ...base,
  },
  day("ev-multiday", "Convention", "2026-12-04", "2026-12-07"),
  {
    ...day("ev-text", 'Kick-off, Q1; "big" plans', "2026-12-10", "2026-12-11"),
    description: LONG_NOTES,
    location:
      "Room 4, Main Street 12; second floor, behind the café, next to the very long corridor",
  },
  // an exception of the weekly all-day series: the 28th moved to the 29th and renamed
  {
    ...day("wk-1128", "Saturday outreach (Sunday this week)", "2026-11-29", "2026-11-30"),
    series_uid: "wk-1@series.invalid",
    recurrence_id: "2026-11-28",
    is_exception: true,
    location: "Park",
  },
  // an untouched occurrence: the RRULE makes it, so the file has no VEVENT for it
  {
    ...day("wk-1107", "Saturday outreach", "2026-11-07", "2026-11-08"),
    series_uid: "wk-1@series.invalid",
    recurrence_id: "2026-11-07",
    is_exception: false,
    location: "Park",
  },
  // an exception of the timed weekly series: the 7 December briefing moved to Tuesday 18:00
  {
    id: "tw-1207",
    uid: "tw-1207@events.invalid",
    summary: "Evening briefing (moved)",
    location: "Room 5",
    all_day: false,
    start: "2026-12-08T18:00:00",
    end: "2026-12-08T19:00:00",
    timezone: "America/Chicago",
    start_utc: "2026-12-09T00:00:00Z",
    end_utc: "2026-12-09T01:00:00Z",
    series_uid: "tw-1@series.invalid",
    recurrence_id: "2026-12-07T19:00:00",
    is_exception: true,
    last_modified: "2026-11-10T09:15:00Z",
  },
  // occurrences of a timed series that spans days: sent as separate events
  {
    id: "mt-1120",
    uid: "mt-1120@events.invalid",
    summary: "Weekend retreat",
    all_day: false,
    start: "2026-11-20T17:00:00",
    end: "2026-11-22T11:00:00",
    timezone: "America/Chicago",
    start_utc: "2026-11-20T23:00:00Z",
    end_utc: "2026-11-22T17:00:00Z",
    series_uid: "mt-1@series.invalid",
    recurrence_id: "2026-11-20T17:00:00",
    is_exception: false,
    ...base,
  },
  {
    id: "mt-1127",
    uid: "mt-1127@events.invalid",
    summary: "Weekend retreat",
    all_day: false,
    start: "2026-11-27T17:00:00",
    end: "2026-11-29T11:00:00",
    timezone: "America/Chicago",
    start_utc: "2026-11-27T23:00:00Z",
    end_utc: "2026-11-29T17:00:00Z",
    series_uid: "mt-1@series.invalid",
    recurrence_id: "2026-11-27T17:00:00",
    is_exception: false,
    ...base,
  },
];

const series: IcsSeries[] = [
  {
    series_uid: "wk-1@series.invalid",
    summary: "Saturday outreach",
    location: "Park",
    category: "Outreach",
    all_day: true,
    start_date: "2026-11-07",
    end_date_exclusive: "2026-11-08",
    timezone: "America/Chicago",
    rrule: "FREQ=WEEKLY",
    exdates: ["2026-11-21"],
  },
  {
    series_uid: "tw-1@series.invalid",
    summary: "Evening briefing",
    description: "Bring a guest",
    location: "Room 5",
    all_day: false,
    start: "2026-02-23T19:00:00",
    end: "2026-02-23T20:00:00",
    start_utc: "2026-02-24T01:00:00Z",
    end_utc: "2026-02-24T02:00:00Z",
    timezone: "America/Chicago",
    rrule: "FREQ=WEEKLY",
    exdates: ["2026-12-28T19:00:00", "2027-01-04T19:00:00"],
  },
  {
    series_uid: "m31@series.invalid",
    summary: "Month end review",
    all_day: true,
    start_date: "2026-01-31",
    end_date_exclusive: "2026-02-01",
    timezone: "America/Chicago",
    rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
    exdates: [],
  },
  {
    series_uid: "tue2@series.invalid",
    summary: "Second Tuesday",
    all_day: true,
    start_date: "2026-11-10",
    end_date_exclusive: "2026-11-11",
    timezone: "America/Chicago",
    rrule: "FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270209",
    exdates: [],
  },
  {
    series_uid: "mt-1@series.invalid",
    summary: "Weekend retreat",
    all_day: false,
    start: "2026-11-20T17:00:00",
    end: "2026-11-22T11:00:00",
    start_utc: "2026-11-20T23:00:00Z",
    end_utc: "2026-11-22T17:00:00Z",
    timezone: "America/Chicago",
    rrule: "FREQ=WEEKLY",
    exdates: [],
  },
];

const data: IcsData = { timezone: "America/Chicago", events, series, timezone_definition: CHICAGO };

const unfold = (ics: string) => ics.replace(/\r\n /g, "");
const lines = (ics: string) => unfold(ics).split("\r\n");

describe("the export file", () => {
  const ics = icsFromData(data, NOW);

  it("matches the golden file (UPDATE_GOLDEN=1 rewrites it)", () => {
    if (process.env.UPDATE_GOLDEN === "1") writeFileSync(GOLDEN, ics);
    expect(ics).toBe(readFileSync(GOLDEN, "utf8"));
  });

  it("is one calendar with CRLF line ends and no line over 75 octets", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const l of ics.split("\r\n"))
      expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(ics.match(/BEGIN:VCALENDAR/g)).toHaveLength(1);
  });

  it("names no brand in PRODID", () => {
    expect(ics).toContain("PRODID:-//Team CRM agent connector//Events//EN");
  });

  it("has a VEVENT for each series, each exception and each event, and none for an untouched occurrence", () => {
    const l = lines(ics);
    const begins = l.filter((x) => x === "BEGIN:VEVENT").length;
    const ends = l.filter((x) => x === "END:VEVENT").length;
    // 4 repeating entries + 2 exceptions + 6 plain events + 2 occurrences sent separately
    expect(begins).toBe(14);
    expect(ends).toBe(14);
    expect(l.filter((x) => x.startsWith("UID:wk-1@series.invalid"))).toHaveLength(2); // master + exception
    expect(l).not.toContain("UID:wk-1107@events.invalid");
  });

  it("writes an all-day series with VALUE=DATE, RRULE and EXDATE", () => {
    const l = lines(ics);
    expect(l).toContain("RRULE:FREQ=WEEKLY");
    expect(l).toContain("EXDATE;VALUE=DATE:20261121");
    expect(l).toContain("RECURRENCE-ID;VALUE=DATE:20261128");
    expect(l).toContain("DTSTART;VALUE=DATE:20261129");
    expect(l).toContain("DTEND;VALUE=DATE:20261130");
  });

  it("writes a timed repeating series as ONE entry in the zone, with a VTIMEZONE, so it follows the clocks", () => {
    const l = lines(ics);
    expect(l.filter((x) => x === "BEGIN:VTIMEZONE")).toHaveLength(1);
    expect(l).toContain("TZID:America/Chicago");
    expect(l).toContain("DTSTART;TZID=America/Chicago:20260223T190000");
    expect(l).toContain("DTEND;TZID=America/Chicago:20260223T200000");
    expect(l).toContain("EXDATE;TZID=America/Chicago:20261228T190000,20270104T190000");
    expect(l).toContain("RECURRENCE-ID;TZID=America/Chicago:20261207T190000");
    expect(l).toContain("DTSTART;TZID=America/Chicago:20261208T180000");
    expect(l).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(l).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
    expect(l).toContain("TZOFFSETFROM:-0600");
    expect(l).toContain("TZOFFSETTO:-0500");
  });

  it("writes single timed events as UTC instants, with no DTEND when there is no end", () => {
    const l = lines(ics);
    expect(l).toContain("DTSTART:20261113T010000Z");
    expect(l).toContain("DTEND:20261113T023000Z");
    expect(l).toContain("DTSTART:20261114T000000Z");
    const i = l.indexOf("UID:ev-noend@events.invalid");
    const block = l.slice(i, l.indexOf("END:VEVENT", i));
    expect(block.some((x) => x.startsWith("DTEND"))).toBe(false);
  });

  it("writes a multi-day timed event from its start time on the first day to its end time on the last", () => {
    const l = lines(ics);
    expect(l).toContain("DTSTART:20261127T230000Z");
    expect(l).toContain("DTEND:20261129T170000Z");
  });

  it("sends a timed series that spans days as separate UTC events, each with its own UID and a comment", () => {
    const l = lines(ics);
    expect(l).toContain("UID:mt-1120@events.invalid");
    expect(l).toContain("UID:mt-1127@events.invalid");
    expect(l.some((x) => x.startsWith("UID:mt-1@series.invalid"))).toBe(false);
    expect(
      l.filter((x) => x.startsWith("COMMENT:An occurrence of a repeating event")),
    ).toHaveLength(2);
  });

  it("writes a monthly last-day series and a second-Tuesday series that ends", () => {
    const l = lines(ics);
    expect(l).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=-1");
    expect(l).toContain("RRULE:FREQ=MONTHLY;BYDAY=2TU;UNTIL=20270209");
  });

  it("escapes and folds text without cutting a character", () => {
    const raw = ics.split("\r\n");
    const l = lines(ics);
    expect(l).toContain('SUMMARY:Kick-off\\, Q1\\; "big" plans');
    const d = l.find((x) => x.startsWith("DESCRIPTION:Bring your own notebook"))!;
    expect(d).toContain("\\;");
    expect(d).toContain("\\n");
    expect(d).toContain("\\\\");
    expect(d).toContain("café");
    expect(d).toContain("🎉");
    expect(d).toContain("日本語のメモ。");
    expect(raw.some((x) => x.startsWith(" "))).toBe(true); // something was folded
    // a folded file decodes as valid UTF-8 with nothing replaced
    expect(Buffer.from(ics, "utf8").toString("utf8")).toBe(ics);
    expect(ics).not.toContain("\ufffd");
  });

  it("has LAST-MODIFIED on events and on exceptions, not on a series' master", () => {
    const l = lines(ics);
    expect(l).toContain("LAST-MODIFIED:20260615T083045Z");
    const i = l.indexOf("UID:tw-1@series.invalid");
    const master = l.slice(i, l.indexOf("END:VEVENT", i));
    expect(master.some((x) => x.startsWith("LAST-MODIFIED"))).toBe(false);
    expect(master).toContain("DTSTAMP:20261114T120000Z");
  });
});

describe("without a zone definition", () => {
  it("writes a timed repeating series as separate UTC events, never as a wrong repeat", () => {
    const tw = series.find((s) => s.series_uid === "tw-1@series.invalid")!;
    const occurrences: IcsEvent[] = [
      {
        id: "tw-1102",
        uid: "tw-1102@events.invalid",
        summary: "Evening briefing",
        all_day: false,
        start: "2026-11-02T19:00:00",
        end: "2026-11-02T20:00:00",
        timezone: "America/Chicago",
        start_utc: "2026-11-03T01:00:00Z",
        end_utc: "2026-11-03T02:00:00Z",
        series_uid: tw.series_uid,
        recurrence_id: "2026-11-02T19:00:00",
        is_exception: false,
        ...base,
      },
    ];
    const ics = icsFromData(
      { timezone: "America/Chicago", events: occurrences, series: [tw], timezone_definition: null },
      NOW,
    );
    expect(ics).not.toContain("VTIMEZONE");
    expect(ics).not.toContain("RRULE");
    expect(ics).not.toContain("TZID");
    expect(ics).toContain("UID:tw-1102@events.invalid");
    expect(ics).toContain("DTSTART:20261103T010000Z");
  });

  it("still repeats all-day series, which need no zone", () => {
    const ics = icsFromData(
      { timezone: "UTC", events: [], series: [series[0]], timezone_definition: null },
      NOW,
    );
    expect(ics).toContain("RRULE:FREQ=WEEKLY");
    expect(ics).not.toContain("VTIMEZONE");
  });

  it("is a valid empty calendar for an empty window", () => {
    const ics = icsFromData(
      { timezone: "UTC", events: [], series: [], timezone_definition: null },
      NOW,
    );
    expect(ics).toBe(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Team CRM agent connector//Events//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nEND:VCALENDAR\r\n",
    );
  });
});

describe("text helpers", () => {
  it("escapes backslash, semicolon, comma and newlines (of every kind) and drops control characters", () => {
    expect(icsEscape("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
    expect(icsEscape("x\u0000y\u0007z\t")).toBe("xyz\t");
  });

  it("folds at 75 octets and continues with one space, never inside a character", () => {
    const short = "X".repeat(75);
    expect(fold(short)).toBe(short);
    const folded = fold("X".repeat(76));
    expect(folded).toBe("X".repeat(75) + "\r\n X");
    const wide = "SUMMARY:" + "é".repeat(100); // 2 octets each
    const parts = fold(wide).split("\r\n");
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(wide);
    const emoji = "D:" + "🎉".repeat(40); // 4 octets each
    const ep = fold(emoji).split("\r\n");
    for (const p of ep) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
    expect(ep.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(emoji);
  });
});
