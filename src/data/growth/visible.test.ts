import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "../seed";
import { growthPath } from "./engine";
import { GROWTH_MILESTONES } from "./milestones";
import type { GrowthPath, MilestoneState, MilestoneStatus } from "./types";
import { visibleMilestones } from "./visible";

/** A path with the given state per milestone index (the rest "never"); the next is the first not held. */
function fake(states: Record<number, MilestoneState>): GrowthPath {
  const milestones = GROWTH_MILESTONES.map((def, index) => {
    const state = states[index] ?? "never";
    return {
      code: def.code,
      label: def.label,
      index,
      hold: def.hold,
      state,
      held: state === "held",
      firstReachedOn: state === "never" ? null : "2026-01-05",
    } as MilestoneStatus;
  });
  const nextIndex = milestones.findIndex((m) => !m.held);
  return {
    personId: "p",
    registered: true,
    milestones,
    nextIndex,
    next: nextIndex === -1 ? null : milestones[nextIndex],
  } as GrowthPath;
}
const held = (n: number): Record<number, MilestoneState> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [i, "held" as const]));
const own = (p: GrowthPath) => visibleMilestones(p, { own: true }).map((m) => m.index);
const all13 = Array.from({ length: 13 }, (_, i) => i);

describe("visibleMilestones: your own path", () => {
  it("next in the middle: what you reached plus the next one, nothing beyond", () => {
    const p = fake(held(5)); // next is Bronze foundation (5)
    expect(p.nextIndex).toBe(5);
    expect(own(p)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("the first milestone as the next one shows just that", () => {
    expect(own(fake({}))).toEqual([0]);
  });

  it("next is the last milestone: everything shows", () => {
    const p = fake(held(12));
    expect(p.nextIndex).toBe(12);
    expect(own(p)).toEqual(all13);
  });

  it("nothing left to earn (all held): everything shows", () => {
    const p = fake(held(13));
    expect(p.nextIndex).toBe(-1);
    expect(own(p)).toEqual(all13);
  });

  it("a held milestone beyond the next one shows, the ones around it stay hidden", () => {
    const p = fake({ ...held(4), 5: "held" }); // next is First sponsor (4); Bronze foundation (5) held
    expect(p.nextIndex).toBe(4);
    expect(own(p)).toEqual([0, 1, 2, 3, 4, 5]);
    const q = fake({ ...held(4), 7: "held" }); // held further on: 5 and 6 stay hidden
    expect(own(q)).toEqual([0, 1, 2, 3, 4, 7]);
  });

  it("a milestone reached before but not held now, beyond the next one, shows", () => {
    const p = fake({ ...held(4), 6: "lost" }); // next is First sponsor (4); 3/10 was held once
    expect(own(p)).toEqual([0, 1, 2, 3, 4, 6]);
  });

  it("the next one itself may be one reached before (earn it again)", () => {
    const p = fake({ ...held(4), 4: "lost", 8: "lost" });
    expect(p.nextIndex).toBe(4);
    expect(own(p)).toEqual([0, 1, 2, 3, 4, 8]);
  });

  it("keeps each milestone's original index, in path order", () => {
    const p = fake({ ...held(4), 9: "held", 10: "held" });
    expect(visibleMilestones(p, { own: true }).map((m) => [m.index, m.label])).toEqual([
      [0, "New apprentice"],
      [1, "First sale"],
      [2, "Core 150"],
      [3, "Core 300"],
      [4, "First sponsor"],
      [9, "6/50"],
      [10, "7,500 Platinum"],
    ]);
  });

  it("when the next one is reached, the new next appears and nothing else changes", () => {
    const before = own(fake({ ...held(4), 5: "held" })); // next is 4, and 5 is held
    const after = own(fake(held(6))); // 4 reached too: 5 stays, the next is 6
    expect(after).toEqual([...before, 6]);
  });
});

describe("visibleMilestones: someone else's path", () => {
  it("an upline sees the whole path, whatever the person's state", () => {
    for (const p of [fake({}), fake(held(5)), fake({ ...held(4), 6: "lost" }), fake(held(13))]) {
      expect(visibleMilestones(p, { own: false })).toEqual(p.milestones);
    }
  });

  it("own and upline views differ only past the next milestone", () => {
    const p = fake({ ...held(4), 8: "held" });
    const mine = own(p);
    const theirs = visibleMilestones(p, { own: false }).map((m) => m.index);
    expect(theirs).toEqual(all13);
    expect(mine).toEqual([0, 1, 2, 3, 4, 8]);
    expect(mine.filter((i) => i <= p.nextIndex)).toEqual(theirs.filter((i) => i <= p.nextIndex));
  });
});

describe("visibleMilestones on the demo seed", () => {
  const input = {
    people: seedPeople(),
    sales: seedSales(),
    overrides: seedPvOverrides(),
    marks: seedMilestoneMarks(),
  };
  const today = localDate();
  const labels = (id: string) =>
    visibleMilestones(growthPath(input, id, today), { own: true }).map((m) => m.label);

  it("Tasha (next Core 150) sees two milestones", () => {
    expect(labels("700")).toEqual(["New apprentice", "First sale", "Core 150"]);
  });

  it("Maria (6/50 next; Platinum and Ruby held beyond it) sees them, and not 12/100", () => {
    const l = labels("1");
    expect(l.slice(-3)).toEqual(["6/50", "7,500 Platinum", "Ruby"]);
    expect(l).not.toContain("12/100");
  });
});
