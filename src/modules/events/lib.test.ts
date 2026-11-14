import { describe, expect, it } from "vitest";
import { formatEventRange } from "./lib";
import { dateRange } from "@/modules/dashboard/format";
import type { CrmEvent } from "@/data";

const ev = (over: Partial<CrmEvent>): CrmEvent => ({
  id: "e",
  name: "Info session",
  categoryId: "c",
  date: "2026-11-17",
  ...over,
});

describe("an event's date with its time", () => {
  it("leaves an all-day event exactly as it was", () => {
    expect(formatEventRange(ev({}))).toBe("Nov 17, 2026");
    expect(formatEventRange(ev({ date: "2026-11-07", endDate: "2026-11-08" }))).toBe(
      "Nov 7–8, 2026",
    );
    expect(formatEventRange(ev({ date: "2026-10-31", endDate: "2026-11-01" }))).toBe(
      "Oct 31 – Nov 1, 2026",
    );
    expect(formatEventRange(ev({ date: "2026-12-31", endDate: "2027-01-01" }))).toBe(
      "Dec 31, 2026 – Jan 1, 2027",
    );
    expect(formatEventRange(ev({ endDate: "2026-11-17" }))).toBe("Nov 17, 2026");
    expect(dateRange(ev({}))).toBe("Nov 17");
    expect(dateRange(ev({ date: "2026-11-07", endDate: "2026-11-08" }))).toBe("Nov 7–8");
    expect(dateRange(ev({ date: "2026-10-31", endDate: "2026-11-01" }))).toBe("Oct 31 – Nov 1");
  });

  it("shows a start time, and a start and end time, on a one-day event", () => {
    expect(formatEventRange(ev({ startTime: "19:00" }))).toBe("Nov 17, 2026 · 7:00 PM");
    expect(formatEventRange(ev({ startTime: "19:00", endTime: "20:30" }))).toBe(
      "Nov 17, 2026 · 7:00 – 8:30 PM",
    );
    expect(formatEventRange(ev({ startTime: "11:00", endTime: "13:00" }))).toBe(
      "Nov 17, 2026 · 11:00 AM – 1:00 PM",
    );
    expect(dateRange(ev({ startTime: "19:00" }))).toBe("Nov 17 · 7:00 PM");
    expect(dateRange(ev({ startTime: "19:00", endTime: "20:30" }))).toBe("Nov 17 · 7:00 – 8:30 PM");
  });

  it("puts the start time on the first day and the end time on the last of a multi-day event", () => {
    const multi = ev({
      date: "2026-11-07",
      endDate: "2026-11-09",
      startTime: "19:00",
      endTime: "17:00",
    });
    expect(formatEventRange(multi)).toBe("Nov 7, 2026 · 7:00 PM – Nov 9, 2026 · 5:00 PM");
    expect(dateRange(multi)).toBe("Nov 7 · 7:00 PM – Nov 9 · 5:00 PM");
    expect(formatEventRange({ ...multi, endTime: undefined })).toBe(
      "Nov 7, 2026 · 7:00 PM – Nov 9, 2026",
    );
  });
});
