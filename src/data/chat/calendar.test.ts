import { describe, expect, it } from "vitest";
import { brand } from "@/brand/brand";
import { eventIcs, googleCalendarUrl, zonedInstant } from "./calendar";

const NOW = new Date(2026, 9, 12, 9, 30);
const CHI = "America/Chicago";
const iso = (d: Date) => d.toISOString();

const allDay = {
  id: "e1",
  name: "Fall Leadership Weekend",
  date: "2026-11-07",
  endDate: "2026-11-08",
  location: "Dallas, TX",
  notes: "Van leaves 7am; bring snacks",
};

// What the all-day export produced before events could have times (verified against the code on main).
const ALL_DAY_ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  `PRODID:-//${brand.name}//Chats//EN`,
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "BEGIN:VEVENT",
  `UID:e1@${brand.slug}`,
  "DTSTAMP:20261012T093000",
  "DTSTART;VALUE=DATE:20261107",
  "DTEND;VALUE=DATE:20261109",
  "SUMMARY:Fall Leadership Weekend",
  "LOCATION:Dallas\\, TX",
  "DESCRIPTION:Van leaves 7am\\; bring snacks",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");
const ALL_DAY_URL =
  "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Fall+Leadership+Weekend&dates=20261107%2F20261109&location=Dallas%2C+TX&details=Van+leaves+7am%3B+bring+snacks";

describe("an all-day event exports exactly as before", () => {
  it("gives the same .ics, byte for byte", () => {
    expect(eventIcs(allDay, NOW)).toBe(ALL_DAY_ICS);
  });
  it("is not changed by a time zone", () => {
    expect(eventIcs(allDay, NOW, "Pacific/Auckland")).toBe(ALL_DAY_ICS);
  });
  it("gives the same Google link, with no ctz", () => {
    expect(googleCalendarUrl(allDay)).toBe(ALL_DAY_URL);
    expect(googleCalendarUrl(allDay, "Pacific/Auckland")).toBe(ALL_DAY_URL);
  });
  it("is the same with empty times", () => {
    const e = { ...allDay, startTime: undefined, endTime: undefined };
    expect(eventIcs(e, NOW)).toBe(ALL_DAY_ICS);
    expect(googleCalendarUrl(e)).toBe(ALL_DAY_URL);
  });
});

describe("zonedInstant", () => {
  it("is right on each side of the spring daylight change (Chicago, 2026-03-08)", () => {
    expect(iso(zonedInstant("2026-03-07", "19:00", CHI))).toBe("2026-03-08T01:00:00.000Z"); // CST, -6
    expect(iso(zonedInstant("2026-03-08", "01:59", CHI))).toBe("2026-03-08T07:59:00.000Z"); // CST
    expect(iso(zonedInstant("2026-03-08", "03:00", CHI))).toBe("2026-03-08T08:00:00.000Z"); // CDT, -5
    expect(iso(zonedInstant("2026-03-09", "19:00", CHI))).toBe("2026-03-10T00:00:00.000Z"); // CDT
  });
  it("is right on each side of the autumn daylight change (Chicago, 2026-11-01)", () => {
    expect(iso(zonedInstant("2026-10-31", "19:00", CHI))).toBe("2026-11-01T00:00:00.000Z"); // CDT
    expect(iso(zonedInstant("2026-11-02", "19:00", CHI))).toBe("2026-11-03T01:00:00.000Z"); // CST
  });
  it("takes the first of a time that happens twice and moves on a time that never happens", () => {
    expect(iso(zonedInstant("2026-11-01", "01:30", CHI))).toBe("2026-11-01T06:30:00.000Z"); // the CDT one
    expect(iso(zonedInstant("2026-03-08", "02:30", CHI))).toBe("2026-03-08T08:30:00.000Z"); // 03:30 CDT
  });
  it("handles other zones (half-hour offsets, the other hemisphere, no daylight time)", () => {
    expect(iso(zonedInstant("2026-11-17", "19:00", "Asia/Kolkata"))).toBe(
      "2026-11-17T13:30:00.000Z",
    );
    expect(iso(zonedInstant("2026-11-17", "19:00", "Pacific/Auckland"))).toBe(
      "2026-11-17T06:00:00.000Z",
    );
    expect(iso(zonedInstant("2026-07-01", "12:00", "America/Phoenix"))).toBe(
      "2026-07-01T19:00:00.000Z",
    );
    expect(iso(zonedInstant("2026-11-17", "00:00", "UTC"))).toBe("2026-11-17T00:00:00.000Z");
  });
  it("does not depend on the machine's own zone", () => {
    const before = process.env.TZ;
    try {
      for (const tz of ["America/Chicago", "Pacific/Auckland", "Europe/London", "UTC"]) {
        process.env.TZ = tz;
        expect(iso(zonedInstant("2026-11-17", "19:00", CHI))).toBe("2026-11-18T01:00:00.000Z");
        expect(iso(zonedInstant("2026-03-09", "19:00", CHI))).toBe("2026-03-10T00:00:00.000Z");
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("a timed event", () => {
  const info = {
    id: "i1",
    name: "Info session",
    date: "2026-11-17",
    startTime: "19:00",
    endTime: "20:30",
  };

  it("is a timed .ics entry in UTC instants worked out from the team's zone", () => {
    const ics = eventIcs(info, NOW, CHI);
    expect(ics).toContain("DTSTART:20261118T010000Z");
    expect(ics).toContain("DTEND:20261118T023000Z");
    expect(ics).not.toContain("VALUE=DATE");
    expect(ics.split("\r\n").every((l) => l.length <= 75)).toBe(true);
  });
  it("has no end for a start time alone on one day", () => {
    const ics = eventIcs({ ...info, endTime: undefined }, NOW, CHI);
    expect(ics).toContain("DTSTART:20261118T010000Z");
    expect(ics).not.toContain("DTEND");
  });
  it("links to Google with local times and the team's zone", () => {
    const url = new URL(googleCalendarUrl(info, CHI));
    expect(url.searchParams.get("dates")).toBe("20261117T190000/20261117T203000");
    expect(url.searchParams.get("ctz")).toBe(CHI);
    const noEnd = new URL(googleCalendarUrl({ ...info, endTime: undefined }, CHI));
    expect(noEnd.searchParams.get("dates")).toBe("20261117T190000/20261117T190000");
  });
  it("stays at 7 PM local on both sides of a daylight change", () => {
    const before = { ...info, date: "2026-03-07", endTime: undefined };
    const after = { ...info, date: "2026-03-09", endTime: undefined };
    expect(eventIcs(before, NOW, CHI)).toContain("DTSTART:20260308T010000Z");
    expect(eventIcs(after, NOW, CHI)).toContain("DTSTART:20260310T000000Z");
    expect(new URL(googleCalendarUrl(before, CHI)).searchParams.get("dates")).toBe(
      "20260307T190000/20260307T190000",
    );
    expect(new URL(googleCalendarUrl(after, CHI)).searchParams.get("dates")).toBe(
      "20260309T190000/20260309T190000",
    );
  });
  it("takes the start from the first day and the end from the last on a multi-day event", () => {
    const multi = {
      ...info,
      date: "2026-03-07",
      endDate: "2026-03-09",
      startTime: "19:00",
      endTime: "11:00",
    };
    const ics = eventIcs(multi, NOW, CHI);
    expect(ics).toContain("DTSTART:20260308T010000Z"); // 7 PM CST
    expect(ics).toContain("DTEND:20260309T160000Z"); // 11 AM CDT, two days later across the change
    const url = new URL(googleCalendarUrl(multi, CHI));
    expect(url.searchParams.get("dates")).toBe("20260307T190000/20260309T110000");
    expect(url.searchParams.get("ctz")).toBe(CHI);
  });
  it("runs a multi-day event with a start time and no end time to the end of its last day", () => {
    const multi = { ...info, date: "2026-11-07", endDate: "2026-11-08", endTime: undefined };
    expect(eventIcs(multi, NOW, CHI)).toContain("DTEND:20261109T060000Z"); // 00:00 on the 9th, CST
    expect(new URL(googleCalendarUrl(multi, CHI)).searchParams.get("dates")).toBe(
      "20261107T190000/20261109T000000",
    );
  });
});
