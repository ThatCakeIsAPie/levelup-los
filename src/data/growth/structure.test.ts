import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import type { BizClass, CrmPerson } from "@/stores/peopleStore";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "../seed";
import { growthPath, teamStructure } from "./engine";

const P = (id: string, bizClass: BizClass, sponsorId: string | null): CrmPerson =>
  bizClass === "customer"
    ? { id, name: id, bizClass, ownerId: sponsorId }
    : { id, name: id, bizClass, sponsorId };

// me > a (IBO) > b (apprentice) > c (prospect)
// me > d (prospect) > e (apprentice: a prospect's recruit still counts toward me)
// me > f (customer, never counted)
const team = [
  P("me", "ibo", null),
  P("a", "ibo", "me"),
  P("b", "apprentice", "a"),
  P("c", "prospect", "b"),
  P("d", "prospect", "me"),
  P("e", "apprentice", "d"),
  P("f", "customer", "me"),
];

describe("team structure (frontline/total)", () => {
  it("counts registered people only, not the person", () => {
    expect(teamStructure(team, "me")).toEqual({ frontline: 1, total: 3 });
    expect(teamStructure(team, "a")).toEqual({ frontline: 1, total: 1 });
    expect(teamStructure(team, "c")).toEqual({ frontline: 0, total: 0 });
  });

  it("can include prospects", () => {
    expect(teamStructure(team, "me", { includeProspects: true })).toEqual({
      frontline: 2,
      total: 5,
    });
    expect(teamStructure(team, "a", { includeProspects: true })).toEqual({
      frontline: 1,
      total: 2,
    });
  });

  it("survives a sponsor loop", () => {
    const loop = [P("x", "ibo", "y"), P("y", "ibo", "x")];
    expect(teamStructure(loop, "x")).toEqual({ frontline: 1, total: 1 });
  });

  it("matches the growth path's headcount numbers for everyone in the demo", () => {
    const input = {
      people: seedPeople(),
      sales: seedSales(),
      overrides: seedPvOverrides(),
      marks: seedMilestoneMarks(),
    };
    const today = localDate();
    // 12/100 is held by nobody in the demo, so its progress shows the current counts.
    for (const p of input.people.filter(
      (x) => x.bizClass === "apprentice" || x.bizClass === "ibo",
    )) {
      const m = growthPath(input, p.id, today).milestones.find((x) => x.code === "12_100")!;
      const part = (k: string) => m.progress?.parts.find((x) => x.key === k)?.current;
      expect(m.held).toBe(false);
      expect(teamStructure(input.people, p.id), p.name).toEqual({
        frontline: part("sponsors"),
        total: part("people"),
      });
    }
    // Seed facts (docs/frontend-guide.md): Maria 6/43, Anita 4/21.
    expect(teamStructure(input.people, "1")).toEqual({ frontline: 6, total: 43 });
    expect(teamStructure(input.people, "2")).toEqual({ frontline: 4, total: 21 });
  });
});
