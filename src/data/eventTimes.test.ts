import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TIME_CASES, type TimeCase } from "./recurrence/cases";
import {
  cleanTime,
  compareStart,
  fitEndTime,
  formatTime,
  formatTimeSpan,
  lengthDaysOf,
  spanWithTimes,
  timeText,
  timesOk,
  timesProblem,
  withTime,
} from "./eventTimes";

describe("start and end times: the shared table of cases", () => {
  it.each(TIME_CASES.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(timesOk(c.lengthDays, c.start, c.end)).toBe(c.ok);
    expect(fitEndTime(c.lengthDays, c.start, c.end) ?? null).toBe(c.fit);
  });

  it("is the very table the database tests run (supabase/tests/050_event_times.test.sql)", () => {
    const sql = readFileSync(
      resolve(__dirname, "../../supabase/tests/050_event_times.test.sql"),
      "utf8",
    );
    const t = (v: string) => (v === "null" ? null : v.slice(1, -1));
    const rows: TimeCase[] = [
      ...sql.matchAll(
        /^\s*\('([^']+)', (\d+), (null|'\d\d:\d\d'), (null|'\d\d:\d\d'), (true|false), (null|'\d\d:\d\d')\),?\s*$/gm,
      ),
    ].map(([, name, len, start, end, ok, fit]) => ({
      name,
      lengthDays: Number(len),
      start: t(start),
      end: t(end),
      ok: ok === "true",
      fit: t(fit),
    }));
    expect(rows).toEqual(TIME_CASES.map((c) => ({ ...c })));
  });
});

describe("formatting", () => {
  it("writes a 12-hour clock", () => {
    expect(formatTime("19:00")).toBe("7:00 PM");
    expect(formatTime("08:05")).toBe("8:05 AM");
    expect(formatTime("00:00")).toBe("12:00 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("12:30")).toBe("12:30 PM");
    expect(formatTime("23:59")).toBe("11:59 PM");
  });

  it("writes a span with one am/pm when both are the same", () => {
    expect(formatTimeSpan("19:00", "20:30")).toBe("7:00 – 8:30 PM");
    expect(formatTimeSpan("09:00", "10:15")).toBe("9:00 – 10:15 AM");
    expect(formatTimeSpan("11:00", "13:00")).toBe("11:00 AM – 1:00 PM");
    expect(formatTimeSpan("11:00", "12:30")).toBe("11:00 AM – 12:30 PM");
  });

  it("puts a time after a date, and leaves an all-day event alone", () => {
    const day = { date: "2026-11-17" };
    expect(withTime("Nov 17, 2026", day)).toBe("Nov 17, 2026");
    expect(withTime("Nov 17, 2026", { ...day, startTime: "19:00" })).toBe("Nov 17, 2026 · 7:00 PM");
    expect(withTime("Nov 17, 2026", { ...day, startTime: "19:00", endTime: "20:30" })).toBe(
      "Nov 17, 2026 · 7:00 – 8:30 PM",
    );
    // On a multi-day event a single date is the first day: only the start time goes with it.
    expect(
      withTime("Nov 17", {
        date: "2026-11-17",
        endDate: "2026-11-19",
        startTime: "19:00",
        endTime: "11:00",
      }),
    ).toBe("Nov 17 · 7:00 PM");
    expect(timeText(day)).toBe("");
  });

  it("puts each end of a multi-day range with its own time", () => {
    expect(spanWithTimes("Nov 7", "Nov 9", { startTime: "19:00", endTime: "17:00" })).toBe(
      "Nov 7 · 7:00 PM – Nov 9 · 5:00 PM",
    );
    expect(spanWithTimes("Nov 7", "Nov 9", { startTime: "19:00" })).toBe("Nov 7 · 7:00 PM – Nov 9");
  });

  it("reads times from the database", () => {
    expect(cleanTime("19:00:00")).toBe("19:00");
    expect(cleanTime("07:05")).toBe("07:05");
    expect(cleanTime("")).toBeUndefined();
    expect(cleanTime(null)).toBeUndefined();
    expect(cleanTime("25:00")).toBeUndefined();
    expect(cleanTime("7:00 PM")).toBeUndefined();
  });
});

describe("what the form refuses", () => {
  const day = { date: "2026-11-17" };
  it("accepts no times, a start, and a later end", () => {
    expect(timesProblem(day)).toBeNull();
    expect(timesProblem({ ...day, startTime: "19:00" })).toBeNull();
    expect(timesProblem({ ...day, startTime: "19:00", endTime: "20:30" })).toBeNull();
  });
  it("refuses an end time without a start time", () => {
    expect(timesProblem({ ...day, endTime: "20:30" })).toBe("An end time needs a start time.");
  });
  it("refuses an end that is not after the start on one day", () => {
    const msg = "The end time must be after the start time.";
    expect(timesProblem({ ...day, startTime: "19:00", endTime: "19:00" })).toBe(msg);
    expect(timesProblem({ ...day, startTime: "19:00", endTime: "18:59" })).toBe(msg);
    // an end date equal to the date is still one day
    expect(timesProblem({ ...day, endDate: day.date, startTime: "19:00", endTime: "18:00" })).toBe(
      msg,
    );
  });
  it("lets the last day of a multi-day event end earlier in the day", () => {
    expect(
      timesProblem({ ...day, endDate: "2026-11-18", startTime: "19:00", endTime: "11:00" }),
    ).toBeNull();
  });
  it("counts the days an event runs past its first", () => {
    expect(lengthDaysOf(day)).toBe(0);
    expect(lengthDaysOf({ ...day, endDate: "2026-11-17" })).toBe(0);
    expect(lengthDaysOf({ ...day, endDate: "2026-11-20" })).toBe(3);
  });
});

describe("sorting", () => {
  it("orders by day, then by start time with all-day events first", () => {
    const ev = (id: string, date: string, startTime?: string) => ({ id, date, startTime });
    const list = [
      ev("late", "2026-11-17", "19:00"),
      ev("next-day", "2026-11-18"),
      ev("early", "2026-11-17", "08:30"),
      ev("allday", "2026-11-17"),
      ev("allday2", "2026-11-17"),
    ];
    expect([...list].sort(compareStart).map((e) => e.id)).toEqual([
      "allday",
      "allday2",
      "early",
      "late",
      "next-day",
    ]);
  });
});
