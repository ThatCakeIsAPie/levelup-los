import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNING_GOAL, type Learning } from "@/data";
import { goalProgress, totalsSummary, weekTotals } from "./learning";

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

describe("goalProgress", () => {
  const totals = weekTotals(week, today);

  it("counts pages and episodes by default", () => {
    // 20/60 pages, 3/3 podcasts, 1/1 workshop.
    expect(goalProgress(totals, DEFAULT_LEARNING_GOAL)).toBeCloseTo((20 / 60 + 1 + 1) / 3);
  });

  it("counts the units the goal picks", () => {
    const goal = {
      ...DEFAULT_LEARNING_GOAL,
      pages: 100,
      readingUnit: "minutes" as const,
      podcasts: 90,
      podcastUnit: "minutes" as const,
    };
    expect(goalProgress(totals, goal)).toBeCloseTo((25 / 100 + 45 / 90 + 1) / 3);
  });
});

describe("totalsSummary", () => {
  it("names every unit logged", () => {
    expect(totalsSummary(weekTotals(week, today))).toBe(
      "20 pages · 3 chapters · 25 min reading · 3 podcasts · 45 min listening · 1 workshop",
    );
  });
});
