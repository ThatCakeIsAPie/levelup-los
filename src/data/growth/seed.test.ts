import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "../seed";
import { growthPath } from "./engine";

const input = {
  people: seedPeople(),
  sales: seedSales(),
  overrides: seedPvOverrides(),
  marks: seedMilestoneMarks(),
};
const path = (id: string) => growthPath(input, id, localDate());

describe("growth path demo seed", () => {
  it("Tasha (new apprentice under Jamal) is at 95 / 150 PV toward Core 150", () => {
    const g = path("700");
    expect(input.people.find((p) => p.id === "700")?.sponsorId).toBe("4");
    expect(g.next?.code).toBe("core_150");
    expect(g.next?.progress?.summary).toBe("95 / 150 PV this month");
    expect(g.milestones[1].reachedOn).not.toBeNull(); // first sale
  });

  it("Jamal has Core 300 and First sponsor and works on Bronze foundation", () => {
    const g = path("4");
    const reached = g.milestones.filter((m) => m.reachedOn).map((m) => m.code);
    expect(reached).toEqual([
      "new_apprentice",
      "first_sale",
      "core_150",
      "core_300",
      "first_sponsor",
    ]);
    expect(g.next?.code).toBe("bronze_foundation");
  });

  it("Anita works on 6/25 with 4 of 6 sponsors, after Bronze builder (marked by Maria)", () => {
    const g = path("2");
    expect(g.next?.code).toBe("6_25");
    expect(g.next?.progress?.summary).toBe("4/6 personal sponsors, 21/25 people");
    const builder = g.milestones.find((m) => m.code === "bronze_builder")!;
    expect(builder.source).toBe("manual");
    expect(builder.mark?.markedBy).toBe("1");
    expect(g.milestones.find((m) => m.code === "platinum")?.progress?.best?.value).toBeGreaterThan(
      4000,
    );
  });

  it("Maria has reached everything up to Ruby and works on 12/100", () => {
    const g = path("1");
    expect(g.nextIndex).toBe(12);
    expect(g.next?.code).toBe("12_100");
  });
});
