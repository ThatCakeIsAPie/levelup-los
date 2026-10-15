import { describe, expect, it } from "vitest";
import type { Learning } from "@/data";
import { totalsSummary, weekStart, weekTotals } from "./learning";

const today = "2026-10-14";
let n = 0;
const entry = (l: Omit<Learning, "id" | "personId" | "date"> & { date?: string }): Learning => ({
  id: `t${n++}`,
  personId: "1",
  date: today,
  ...l,
});

const week: Learning[] = [
  // Logged before units existed: pages and one episode.
  entry({ kind: "pages", title: "A", amount: 20 }),
  entry({ kind: "podcast", title: "B", amount: 1 }),
  entry({ kind: "pages", title: "A", amount: 3, unit: "chapters" }),
  entry({ kind: "pages", title: "A", amount: 25, unit: "minutes" }),
  entry({ kind: "podcast", title: "C", amount: 2, unit: "episodes" }),
  entry({ kind: "podcast", title: "D", amount: 45, unit: "minutes" }),
  entry({ kind: "workshop", title: "E", amount: 1 }),
  // Outside the rolling week.
  entry({ kind: "pages", title: "A", amount: 99, date: "2026-10-01" }),
];

describe("weekTotals", () => {
  it("adds each entry to its unit, reading missing units as pages and episodes", () => {
    expect(weekTotals(week, today)).toEqual({
      pages: 20,
      chapters: 3,
      readingMinutes: 25,
      podcasts: 3,
      listeningMinutes: 45,
      workshops: 1,
    });
  });
});

// The weekly goal's own counting and progress: src/data/weeklyGoal.test.ts.
describe("weekStart", () => {
  it("is six days before today (the same week the weekly goal counts)", () => {
    expect(weekStart(today)).toBe("2026-10-08");
  });
});

describe("totalsSummary", () => {
  it("names every unit logged", () => {
    expect(totalsSummary(weekTotals(week, today))).toBe(
      "20 pages · 3 chapters · 25 min reading · 3 podcasts · 45 min listening · 1 workshop",
    );
  });
});
