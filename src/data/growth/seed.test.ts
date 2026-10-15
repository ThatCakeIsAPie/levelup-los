import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "../seed";
import { addMonths, growthPath, hasEverReachedMilestone, monthPv } from "./engine";
import type { GrowthMilestoneCode, GrowthPath } from "./types";

const input = {
  people: seedPeople(),
  sales: seedSales(),
  overrides: seedPvOverrides(),
  marks: seedMilestoneMarks(),
};
const today = localDate();
const lastMonth = addMonths(today.slice(0, 7), -1);
const path = (id: string) => growthPath(input, id, today);
const status = (g: GrowthPath, code: GrowthMilestoneCode) =>
  g.milestones.find((m) => m.code === code)!;
const held = (g: GrowthPath) => g.milestones.filter((m) => m.held).map((m) => m.code);
/** Group PV for a whole past month (the path as of its last day). */
const groupPvIn = (id: string, month: string) =>
  growthPath(input, id, `${month}-${new Date(+month.slice(0, 4), +month.slice(5), 0).getDate()}`)
    .thisMonth.groupPv;

describe("growth path demo seed", () => {
  it("Tasha (new apprentice under Jamal) is at 95 / 150 PV toward Core 150", () => {
    const g = path("700");
    expect(input.people.find((p) => p.id === "700")?.sponsorId).toBe("4");
    expect(g.next?.code).toBe("core_150");
    expect(g.next?.state).toBe("never");
    expect(g.next?.progress?.summary).toBe("95 / 150 PV this month");
    expect(held(g)).toEqual(["new_apprentice", "first_sale"]);
    expect(g.keepUp).toEqual([]);
  });

  it("Jamal first hit Core 150 and 300 months ago, holds them with this month's PV and works on Bronze foundation", () => {
    const g = path("4");
    expect(held(g)).toEqual([
      "new_apprentice",
      "first_sale",
      "core_150",
      "core_300",
      "first_sponsor",
    ]);
    expect(status(g, "core_150").firstReachedOn! < status(g, "core_300").firstReachedOn!).toBe(
      true,
    );
    expect(status(g, "core_300").firstReachedOn! < `${lastMonth}-01`).toBe(true);
    expect(status(g, "core_300").heldVia).toBe("this_month");
    expect(g.next?.code).toBe("bronze_foundation");
    expect(g.next?.state).toBe("never");
    expect(g.thisMonth.groupPv).toBeLessThan(600);
    expect(g.keepUp).toEqual([]);
  });

  it("Anita works on 6/25 with 4 of 6 sponsors, after Bronze builder (first hit marked by Maria, held from last month)", () => {
    const g = path("2");
    expect(g.next?.code).toBe("6_25");
    expect(g.next?.state).toBe("never");
    expect(g.next?.progress?.summary).toBe("4/6 personal sponsors, 21/25 people");
    const builder = status(g, "bronze_builder");
    expect(builder).toMatchObject({ held: true, heldVia: "last_month", source: "manual" });
    expect(builder.mark?.markedBy).toBe("1");
    expect(status(g, "3_10").held).toBe(true);
    // An upline sees the heads-up on her path: Core 300 and Bronze builder count from last month.
    expect(g.keepUp.map((s) => s.code)).toEqual(["core_300", "bronze_builder"]);
    expect(status(g, "platinum").progress?.best?.value).toBeGreaterThan(4000);
    expect(status(g, "platinum").state).toBe("never");
  });

  it("Maria is down to 43 people: 6/50 is her goal again, first hit long ago", () => {
    const g = path("1");
    expect(g.next?.code).toBe("6_50");
    expect(g.nextIndex).toBe(9);
    expect(g.next).toMatchObject({ state: "lost", source: "manual" });
    expect(g.next?.firstReachedOn).toBe(
      seedMilestoneMarks().find((m) => m.personId === "1" && m.code === "6_50")?.reachedOn,
    );
    expect(g.next?.progress?.summary).toBe("6/6 personal sponsors, 43/50 people");
    expect(g.workingDays).toBeNull();
    expect(status(g, "6_25").held).toBe(true);
    expect(status(g, "12_100").state).toBe("never");
  });

  it("Maria holds 7,500 Platinum and Ruby only through last month's group PV (the heads-up)", () => {
    const g = path("1");
    expect(groupPvIn("1", lastMonth)).toBeGreaterThanOrEqual(15000);
    expect(g.thisMonth.groupPv).toBeLessThan(7500);
    expect(status(g, "platinum")).toMatchObject({ held: true, heldVia: "last_month" });
    expect(status(g, "ruby")).toMatchObject({ held: true, heldVia: "last_month" });
    expect(g.keepUp.map((s) => s.code)).toEqual(["platinum", "ruby"]);
    // Everything before 6/50 is held now, the volume ones from this month.
    for (const code of ["core_150", "core_300", "bronze_foundation", "bronze_builder"] as const)
      expect(status(g, code)).toMatchObject({ held: true, heldVia: "this_month" });
    expect(g.latest?.code).toBe("ruby");
  });

  it("unlocks still go by ever reached for the demo cast", () => {
    for (const id of ["1", "2"]) {
      expect(hasEverReachedMilestone(input, id, "3_10", today)).toBe(true);
      expect(hasEverReachedMilestone(input, id, "first_sponsor", today)).toBe(true);
    }
    expect(hasEverReachedMilestone(input, "4", "first_sponsor", today)).toBe(true);
    expect(hasEverReachedMilestone(input, "4", "3_10", today)).toBe(false);
    expect(hasEverReachedMilestone(input, "700", "first_sponsor", today)).toBe(false);
  });
});

describe("Priya on the demo seed", () => {
  it("only counts registered people toward 3/10 (prospects on the map don't)", () => {
    const g = path("8");
    const tenThree = status(g, "3_10");
    expect(tenThree.state).toBe("never");
    expect(tenThree.progress?.summary).toBe("2/3 personal sponsors, 2/10 people");
    expect(g.thisMonth.pv).toBe(monthPv(input, "8", today.slice(0, 7), today).pv);
  });
});
