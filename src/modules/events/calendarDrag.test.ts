import { describe, expect, it } from "vitest";
import {
  canPickUp,
  columnAt,
  dayAt,
  dayDelta,
  daysShift,
  dropDates,
  edgeDirection,
  movedToast,
  pageDistance,
  EDGE_HOLD_MS,
  HOLD_MS,
  MOUSE_SLOP,
} from "./calendarDrag";
import type { CalItem } from "./calendar";

const item = (over: Partial<CalItem> = {}): CalItem => ({
  key: "e1",
  eventId: "e1",
  name: "Info session",
  categoryId: "c1",
  date: "2026-11-17",
  startTime: "19:00",
  endTime: "20:30",
  projected: false,
  ...over,
});

describe("dropDates", () => {
  it("changes only the date: one day on, the same length", () => {
    expect(dropDates(item(), "2026-11-17", "2026-11-19")).toEqual({
      date: "2026-11-19",
      endDate: undefined,
    });
    expect(dropDates(item(), "2026-11-17", "2026-11-10")).toEqual({
      date: "2026-11-10",
      endDate: undefined,
    });
  });
  it("does nothing on the same day", () => {
    expect(dropDates(item(), "2026-11-17", "2026-11-17")).toBeNull();
  });
  it("keeps a multi-day event's number of days, whichever day of it was held", () => {
    const bar = item({ date: "2026-11-27", endDate: "2026-11-30" }); // four days across a month end
    expect(dropDates(bar, "2026-11-27", "2026-12-02")).toEqual({
      date: "2026-12-02",
      endDate: "2026-12-05",
    });
    // held by its last day (Nov 30) and dropped on Dec 5: that day lands there
    expect(dropDates(bar, "2026-11-30", "2026-12-05")).toEqual({
      date: "2026-12-02",
      endDate: "2026-12-05",
    });
    expect(dropDates(bar, "2026-11-29", "2026-11-29")).toBeNull();
  });
  it("counts whole days across a daylight change, a year end and a leap day", () => {
    expect(dayDelta("2026-11-01", "2026-11-02")).toBe(1);
    expect(dropDates(item({ date: "2026-12-31" }), "2026-12-31", "2027-01-01")?.date).toBe(
      "2027-01-01",
    );
    expect(dropDates(item({ date: "2028-02-28" }), "2028-02-28", "2028-03-01")?.date).toBe(
      "2028-03-01",
    );
  });
});

describe("the day under a point", () => {
  it("is the column of a week row, Sunday first", () => {
    expect(columnAt(100, 700, 99)).toBe(-1);
    expect(columnAt(100, 700, 100)).toBe(0);
    expect(columnAt(100, 700, 199)).toBe(0);
    expect(columnAt(100, 700, 200)).toBe(1);
    expect(columnAt(100, 700, 799)).toBe(6);
    expect(columnAt(100, 700, 800)).toBe(-1);
    expect(columnAt(100, 0, 100)).toBe(-1);
    expect(dayAt("2026-11-15", 100, 700, 450)).toBe("2026-11-18");
    expect(dayAt("2026-11-15", 100, 700, 50)).toBeNull();
  });
});

describe("the edge of the calendar", () => {
  const rect = { left: 0, right: 700, top: 100, bottom: 500 };
  it("pushes up near the top, down near the bottom, nowhere in the middle", () => {
    expect(edgeDirection(rect, 300, 120)).toBe(-1);
    expect(edgeDirection(rect, 300, 480)).toBe(1);
    expect(edgeDirection(rect, 300, 300)).toBe(0);
  });
  it("counts a little outside, but not far (a finger on the list under the grid does not page it)", () => {
    expect(edgeDirection(rect, 300, 90)).toBe(-1);
    expect(edgeDirection(rect, 300, 510)).toBe(1);
    expect(edgeDirection(rect, 300, 600)).toBe(0);
    expect(edgeDirection(rect, 300, 40)).toBe(0);
    expect(edgeDirection(rect, 720, 120)).toBe(0);
  });
  it("pages by most of what is visible", () => {
    expect(pageDistance(500)).toBe(420);
    expect(pageDistance(10)).toBe(48);
  });
  it("the feel matches the pipeline board: 5 px, 350 ms, about 700 ms at an edge", () => {
    expect([MOUSE_SLOP, HOLD_MS, EDGE_HOLD_MS]).toEqual([5, 350, 700]);
  });
});

describe("who may pick up an event", () => {
  it("only people who may edit events, and only a stored event", () => {
    expect(canPickUp(item(), true)).toBe(true);
    expect(canPickUp(item(), false)).toBe(false);
    expect(canPickUp(item({ projected: true, eventId: undefined }), true)).toBe(false);
  });
  it("a past event and an occurrence of a series can be", () => {
    expect(canPickUp(item({ date: "2020-01-01" }), true)).toBe(true);
    expect(canPickUp(item({ seriesId: "S1" }), true)).toBe(true);
  });
});

describe("the words", () => {
  it("names what moved", () => {
    expect(movedToast("2026-11-19", 1)).toBe("Moved to Thu, Nov 19");
    expect(movedToast("2026-11-19", 6)).toBe("Moved 6 events");
  });
  it("says how far, and which way", () => {
    expect(daysShift(3)).toBe("3 days later");
    expect(daysShift(-1)).toBe("1 day earlier");
  });
});
