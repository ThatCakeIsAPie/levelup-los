import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import type { Sale } from "@/stores/crmStore";
import {
  growthPath,
  hasReachedMilestone,
  isPersonalOrder,
  monthPv,
  registeredOn,
  saleSellerId,
  type GrowthInput,
} from "./engine";
import { GROWTH_MILESTONES, growthIndex, growthLabel, isGrowthCode } from "./milestones";
import {
  GROWTH_CODES,
  type GrowthMilestoneCode,
  type MilestoneMark,
  type PvOverride,
} from "./types";

const TODAY = "2026-10-13";

const ibo = (id: string, sponsorId: string | null, start: string, extra: Partial<CrmPerson> = {}) =>
  ({
    id,
    name: `Person ${id}`,
    bizClass: "ibo",
    sponsorId,
    businessStartDate: start,
    ...extra,
  }) as CrmPerson;
const prospect = (id: string, sponsorId: string): CrmPerson => ({
  id,
  name: `Prospect ${id}`,
  bizClass: "prospect",
  sponsorId,
});
const customer = (id: string, ownerId: string): CrmPerson => ({
  id,
  name: `Customer ${id}`,
  bizClass: "customer",
  ownerId,
});

let saleN = 0;
/** A sale to customer `customerId` (or a personal order when it's a business person). */
const sale = (customerId: string, date: string, pv: number, personId?: string): Sale => ({
  id: `s${saleN++}`,
  customerId,
  product: "Product",
  date,
  pv,
  ...(personId ? { personId } : {}),
});
const override = (personId: string, month: string, pv: number, setAt: string): PvOverride => ({
  personId,
  month,
  pv,
  setAt,
  setBy: "boss",
});
const mark = (personId: string, code: GrowthMilestoneCode, reachedOn: string): MilestoneMark => ({
  personId,
  code,
  reachedOn,
  markedBy: "boss",
  markedAt: "2026-10-01T10:00:00.000Z",
});

function input(
  people: CrmPerson[],
  sales: Sale[] = [],
  overrides: PvOverride[] = [],
  marks: MilestoneMark[] = [],
): GrowthInput {
  return { people, sales, overrides, marks };
}

const statusOf = (inp: GrowthInput, id: string, code: GrowthMilestoneCode, today = TODAY) =>
  growthPath(inp, id, today).milestones.find((m) => m.code === code)!;
const reachedOn = (inp: GrowthInput, id: string, code: GrowthMilestoneCode, today = TODAY) =>
  statusOf(inp, id, code, today).reachedOn;

/** `n` registered people under `sponsorId`, ids `${prefix}1..n`, registered on `start`. */
function frontline(prefix: string, sponsorId: string, n: number, start: string): CrmPerson[] {
  return Array.from({ length: n }, (_, i) => ibo(`${prefix}${i + 1}`, sponsorId, start));
}

describe("milestone list", () => {
  it("has the 13 milestones in the plan's order", () => {
    expect(GROWTH_MILESTONES.map((m) => m.label)).toEqual([
      "New apprentice",
      "First sale",
      "Core 150",
      "Core 300",
      "First sponsor",
      "Bronze foundation",
      "3/10",
      "Bronze builder",
      "6/25",
      "6/50",
      "7,500 Platinum",
      "Ruby",
      "12/100",
    ]);
    expect(GROWTH_MILESTONES.map((m) => m.code)).toEqual([...GROWTH_CODES]);
    expect(growthIndex("3_10")).toBe(6);
    expect(growthLabel("platinum")).toBe("7,500 Platinum");
    expect(isGrowthCode("ruby")).toBe(true);
    expect(isGrowthCode("diamond")).toBe(false);
  });
});

describe("registration and sales attribution", () => {
  it("registers on the business start date, else the stage history, else the join date", () => {
    expect(registeredOn(ibo("a", null, "2026-01-05"))).toBe("2026-01-05");
    expect(
      registeredOn({
        id: "b",
        name: "B",
        bizClass: "apprentice",
        stageHistory: [
          { stage: "prospect", at: "2025-01-01T10:00:00.000Z" },
          { stage: "apprentice", at: "2025-03-02T10:00:00.000Z" },
        ],
      }),
    ).toBe("2025-03-02");
    expect(
      registeredOn({ id: "c", name: "C", bizClass: "apprentice", joinedDate: "2025-04-04" }),
    ).toBe("2025-04-04");
    expect(registeredOn(prospect("p", "a"))).toBeNull();
  });

  it("credits a sale to its personId, else the customer's owner, else the buyer (personal order)", () => {
    const people = [ibo("a", null, "2026-01-01"), customer("c", "a")];
    const byId = new Map(people.map((p) => [p.id, p]));
    expect(saleSellerId(sale("c", TODAY, 10), byId)).toBe("a");
    expect(saleSellerId(sale("c", TODAY, 10, "z"), byId)).toBe("z");
    expect(saleSellerId(sale("a", TODAY, 10), byId)).toBe("a");
    expect(isPersonalOrder(sale("a", TODAY, 10), byId)).toBe(true);
    expect(isPersonalOrder(sale("c", TODAY, 10), byId)).toBe(false);
    expect(saleSellerId(sale("missing", TODAY, 10), byId)).toBeUndefined();
  });

  it("a prospect has no path yet: nothing is reached and registering is next", () => {
    const g = growthPath(input([ibo("a", null, "2026-01-01"), prospect("p", "a")]), "p", TODAY);
    expect(g.registered).toBe(false);
    expect(g.nextIndex).toBe(0);
    expect(g.next?.code).toBe("new_apprentice");
    expect(g.next?.progress?.summary).toBe("Not registered yet");
    expect(g.latest).toBeNull();
  });

  it("New apprentice is reached on the registration date", () => {
    const inp = input([ibo("a", null, "2026-10-01")]);
    expect(reachedOn(inp, "a", "new_apprentice")).toBe("2026-10-01");
    expect(statusOf(inp, "a", "new_apprentice").source).toBe("auto");
  });
});

describe("First sale", () => {
  const people = [ibo("a", null, "2026-09-01"), customer("c", "a"), customer("d", "a")];

  it("is the first sale to a customer", () => {
    const inp = input(people, [sale("d", "2026-10-06", 20), sale("c", "2026-09-20", 0)]);
    expect(reachedOn(inp, "a", "first_sale")).toBe("2026-09-20");
  });

  it("personal orders don't count, and future-dated sales are ignored", () => {
    const inp = input(people, [sale("a", "2026-09-05", 50), sale("c", "2026-11-01", 50)]);
    expect(reachedOn(inp, "a", "first_sale")).toBeNull();
    expect(statusOf(inp, "a", "first_sale").progress?.summary).toBe(
      "No sales to customers logged yet",
    );
  });

  it("is never before the person registered", () => {
    const inp = input(people, [sale("c", "2026-08-10", 20)]);
    expect(reachedOn(inp, "a", "first_sale")).toBe("2026-09-01");
  });
});

describe("Core 150 and Core 300 (personal PV in one calendar month)", () => {
  const people = [ibo("a", null, "2026-01-01"), customer("c", "a")];

  it("is reached on the day the month's running total crosses the line", () => {
    const inp = input(people, [
      sale("c", "2026-03-03", 60),
      sale("a", "2026-03-10", 50),
      sale("c", "2026-03-17", 45),
      sale("c", "2026-03-28", 200),
    ]);
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-03-17");
    expect(reachedOn(inp, "a", "core_300")).toBe("2026-03-28");
  });

  it("doesn't add up across a month boundary", () => {
    const inp = input(people, [sale("c", "2026-03-31", 100), sale("c", "2026-04-01", 100)]);
    expect(reachedOn(inp, "a", "core_150")).toBeNull();
  });

  it("stays reached after a quiet month, with this month's progress for Core 300", () => {
    const inp = input(people, [sale("c", "2026-05-12", 160), sale("c", "2026-10-02", 95)]);
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-05-12");
    const core300 = statusOf(inp, "a", "core_300");
    expect(core300.reachedOn).toBeNull();
    expect(core300.progress?.summary).toBe("95 / 300 PV this month");
    expect(core300.progress?.parts[0]).toMatchObject({ current: 95, target: 300 });
    expect(core300.progress?.best).toEqual({ month: "2026-05", value: 160 });
    expect(core300.progress?.month).toBe("2026-10");
  });

  it("this month's progress: 95 / 150 PV, ratio 95/150", () => {
    const inp = input(people, [sale("c", "2026-10-06", 60), sale("a", "2026-10-10", 35)]);
    const g = growthPath(inp, "a", TODAY);
    expect(g.next?.code).toBe("core_150");
    expect(g.next?.progress?.summary).toBe("95 / 150 PV this month");
    expect(g.next?.progress?.ratio).toBeCloseTo(95 / 150);
    expect(g.thisMonth).toMatchObject({ month: "2026-10", pv: 95, groupPv: 95, daysLeft: 18 });
  });
});

describe("monthly PV set by an upline", () => {
  const people = [ibo("a", null, "2026-01-01"), customer("c", "a")];

  it("replaces the logged total for that month (lower)", () => {
    const inp = input(
      people,
      [sale("c", "2026-06-05", 200)],
      [override("a", "2026-06", 100, "2026-07-02T09:00:00.000Z")],
    );
    expect(reachedOn(inp, "a", "core_150")).toBeNull();
    expect(monthPv(inp, "a", "2026-06", TODAY)).toMatchObject({ logged: 200, pv: 100 });
  });

  it("set after the month: counts from the month's last day", () => {
    const inp = input(people, [], [override("a", "2026-06", 320, "2026-07-02T09:00:00.000Z")]);
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-06-30");
    expect(reachedOn(inp, "a", "core_300")).toBe("2026-06-30");
  });

  it("set during the month: counts from the day it was set", () => {
    const inp = input(
      people,
      [sale("c", "2026-10-02", 20)],
      [override("a", "2026-10", 160, "2026-10-09T09:00:00.000Z")],
    );
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-10-09");
    const g = growthPath(inp, "a", TODAY);
    expect(g.thisMonth.pv).toBe(160);
    expect(g.thisMonth.override?.pv).toBe(160);
  });

  it("an upline's figure of 0 wipes out a month", () => {
    const inp = input(
      people,
      [sale("c", "2026-06-05", 400)],
      [override("a", "2026-06", 0, "2026-07-01T09:00:00.000Z")],
    );
    expect(reachedOn(inp, "a", "core_300")).toBeNull();
  });

  it("only touches that person and month", () => {
    const inp = input(
      [...people, ibo("b", "a", "2026-01-01")],
      [sale("c", "2026-05-05", 200)],
      [override("b", "2026-05", 10, "2026-06-01T09:00:00.000Z")],
    );
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-05-05");
    expect(monthPv(inp, "a", "2026-05", TODAY)).toEqual({ logged: 200, override: null, pv: 200 });
  });
});

describe("First sponsor and the count milestones", () => {
  it("First sponsor: the first registered personal sponsor; prospects don't count", () => {
    const inp = input([
      ibo("a", null, "2026-01-01"),
      prospect("p", "a"),
      ibo("b", "a", "2026-04-02"),
      ibo("c", "a", "2026-03-15"),
    ]);
    expect(reachedOn(inp, "a", "first_sponsor")).toBe("2026-03-15");
    const none = input([ibo("a", null, "2026-01-01"), prospect("p", "a")]);
    expect(statusOf(none, "a", "first_sponsor").progress?.summary).toBe(
      "Nobody you sponsored has registered yet",
    );
  });

  it("someone moved under you who registered earlier counts from your own registration", () => {
    const inp = input([ibo("a", null, "2026-05-01"), ibo("b", "a", "2024-02-02")]);
    expect(reachedOn(inp, "a", "first_sponsor")).toBe("2026-05-01");
  });

  it("3/10: the later of the 3rd sponsor's and the 10th person's registration", () => {
    const people = [
      ibo("a", null, "2025-01-01"),
      ibo("f1", "a", "2025-02-01"),
      ibo("f2", "a", "2025-03-01"),
      ibo("f3", "a", "2025-04-01"),
      // Deeper people (not counting a): 3 frontline + 7 below = 10.
      ...Array.from({ length: 7 }, (_, i) =>
        ibo(`d${i}`, i % 2 ? "f1" : "f2", `2025-0${5 + Math.min(i, 4)}-1${i}`),
      ),
      prospect("p1", "f1"),
      customer("cust", "a"),
    ];
    const inp = input(people);
    // The 10th registration is d6 (2025-09-16); a, the prospect and the customer don't count.
    expect(reachedOn(inp, "a", "3_10")).toBe("2025-09-16");
    expect(reachedOn(inp, "a", "6_25")).toBeNull();
    expect(statusOf(inp, "a", "6_25").progress?.summary).toBe(
      "3/6 personal sponsors, 10/25 people",
    );
  });

  it("3/10 needs both numbers", () => {
    const many = [ibo("a", null, "2025-01-01"), ...frontline("f", "a", 2, "2025-02-01")];
    for (let i = 0; i < 12; i++) many.push(ibo(`x${i}`, "f1", "2025-03-01"));
    const inp = input(many);
    expect(reachedOn(inp, "a", "3_10")).toBeNull();
    const s = statusOf(inp, "a", "3_10");
    expect(s.progress?.summary).toBe("2/3 personal sponsors, 10/10 people");
    expect(s.progress?.parts.map((p) => [p.key, p.current, p.target])).toEqual([
      ["sponsors", 2, 3],
      ["people", 14, 10],
    ]);
    expect(s.progress?.ratio).toBeCloseTo((2 / 3 + 1) / 2);
  });

  it("6/25, 6/50 and 12/100 count the whole group", () => {
    const people = [ibo("a", null, "2020-01-01"), ...frontline("f", "a", 12, "2021-01-01")];
    for (let i = 0; i < 88; i++) people.push(ibo(`g${i}`, `f${(i % 12) + 1}`, "2022-01-01"));
    const inp = input(people);
    expect(reachedOn(inp, "a", "6_25")).toBe("2022-01-01");
    expect(reachedOn(inp, "a", "6_50")).toBe("2022-01-01");
    expect(reachedOn(inp, "a", "12_100")).toBe("2022-01-01");
  });
});

describe("leg milestones and group PV", () => {
  // a with three legs: b (with b1 under them), c and d.
  const people = [
    ibo("a", null, "2025-01-01"),
    ibo("b", "a", "2025-02-01"),
    ibo("b1", "b", "2025-03-01"),
    ibo("c", "a", "2025-02-01"),
    ibo("d", "a", "2025-02-01"),
  ];

  it("Bronze foundation: 3 legs at 150+ and 600 group PV in the same month; a leg is the whole line", () => {
    const inp = input(people, [
      sale("b", "2026-04-02", 100),
      sale("b1", "2026-04-05", 60), // b's leg: 160
      sale("c", "2026-04-08", 150),
      sale("d", "2026-04-12", 149),
      sale("a", "2026-04-15", 100), // group 559
      sale("d", "2026-04-20", 41), // d: 190, group 600
    ]);
    expect(reachedOn(inp, "a", "bronze_foundation")).toBe("2026-04-20");
    expect(reachedOn(inp, "a", "bronze_builder")).toBeNull();
  });

  it("your own PV counts toward group PV (not toward a leg)", () => {
    const inp = input(people, [
      sale("b", "2026-04-02", 150),
      sale("c", "2026-04-02", 150),
      sale("d", "2026-04-02", 150),
      sale("a", "2026-04-09", 150),
    ]);
    expect(reachedOn(inp, "a", "bronze_foundation")).toBe("2026-04-09");
  });

  it("legs in different months don't add up", () => {
    const inp = input(people, [
      sale("b", "2026-04-02", 300),
      sale("c", "2026-04-02", 300),
      sale("d", "2026-05-02", 300),
    ]);
    expect(reachedOn(inp, "a", "bronze_foundation")).toBeNull();
  });

  it("two legs can't make up for a missing third, whatever the total", () => {
    const inp = input(people, [sale("b", "2026-04-02", 5000), sale("c", "2026-04-02", 5000)]);
    expect(reachedOn(inp, "a", "bronze_foundation")).toBeNull();
    // ...but group PV milestones only need the total.
    expect(reachedOn(inp, "a", "platinum")).toBe("2026-04-02");
    expect(reachedOn(inp, "a", "ruby")).toBeNull();
  });

  it("Bronze builder: 3 legs at 300+ and 2,500 group PV", () => {
    const inp = input(people, [
      sale("b1", "2026-06-01", 300),
      sale("c", "2026-06-01", 300),
      sale("d", "2026-06-01", 1000),
      sale("a", "2026-06-25", 900),
    ]);
    expect(reachedOn(inp, "a", "bronze_builder")).toBe("2026-06-25");
  });

  it("upline figures count for legs too", () => {
    const inp = input(
      people,
      [sale("b", "2026-08-03", 200), sale("c", "2026-08-03", 200)],
      [
        override("d", "2026-08", 250, "2026-09-01T10:00:00.000Z"),
        override("b", "2026-08", 100, "2026-09-01T10:00:00.000Z"), // replaces b's 200
      ],
    );
    expect(reachedOn(inp, "a", "bronze_foundation")).toBeNull();
    const fixed = input(
      people,
      [sale("b", "2026-08-03", 200), sale("c", "2026-08-03", 200)],
      [override("d", "2026-08", 250, "2026-09-01T10:00:00.000Z")],
    );
    expect(reachedOn(fixed, "a", "bronze_foundation")).toBe("2026-08-31");
  });

  it("progress lists this month's legs, highest first", () => {
    const inp = input(people, [
      sale("b1", "2026-10-02", 80),
      sale("c", "2026-10-03", 200),
      sale("a", "2026-10-04", 30),
    ]);
    const p = statusOf(inp, "a", "bronze_foundation").progress!;
    expect(p.legs?.map((l) => [l.personId, l.pv])).toEqual([
      ["c", 200],
      ["b", 80],
      ["d", 0],
    ]);
    expect(p.summary).toBe("1/3 legs at 150+ PV, 310 / 600 group PV this month");
    const plat = statusOf(inp, "a", "platinum").progress!;
    expect(plat.summary).toBe("310 / 7,500 group PV this month");
  });

  it("a group PV best month is reported", () => {
    const inp = input(people, [sale("c", "2026-02-02", 4180), sale("c", "2026-10-02", 10)]);
    expect(statusOf(inp, "a", "platinum").progress?.best).toEqual({
      month: "2026-02",
      value: 4180,
    });
  });
});

describe("hand marks and the path", () => {
  const people = [ibo("a", null, "2024-01-01"), customer("c", "a")];

  it("a hand mark counts; the earlier of the data and the mark wins", () => {
    const inp = input(
      people,
      [sale("c", "2026-02-10", 200)],
      [],
      [mark("a", "core_150", "2024-03-01"), mark("a", "core_300", "2024-05-01")],
    );
    expect(statusOf(inp, "a", "core_150")).toMatchObject({
      reachedOn: "2024-03-01",
      source: "manual",
      autoOn: "2026-02-10",
    });
    const later = input(
      people,
      [sale("c", "2024-02-10", 200)],
      [],
      [mark("a", "core_150", "2024-03-01")],
    );
    expect(statusOf(later, "a", "core_150")).toMatchObject({
      reachedOn: "2024-02-10",
      source: "auto",
    });
    expect(statusOf(later, "a", "core_150").mark?.markedBy).toBe("boss");
  });

  it("next is the first milestone not reached; later ones reached out of order still show", () => {
    const inp = input([ibo("a", null, "2026-01-01"), ibo("b", "a", "2026-02-01")], [], [], []);
    const g = growthPath(inp, "a", TODAY);
    expect(g.next?.code).toBe("first_sale");
    expect(g.nextIndex).toBe(1);
    expect(statusOf(inp, "a", "first_sponsor").reachedOn).toBe("2026-02-01");
    expect(g.latest?.code).toBe("first_sponsor");
    expect(g.workingDays).toBe(285); // since New apprentice (2026-01-01)
  });

  it("days taken run from the previous reached milestone; out-of-order ones have none", () => {
    const inp = input(
      [ibo("a", null, "2026-01-01"), customer("c", "a"), ibo("b", "a", "2026-01-20")],
      [sale("c", "2026-01-11", 10), sale("c", "2026-03-05", 160)],
    );
    const g = growthPath(inp, "a", TODAY);
    const by = (code: GrowthMilestoneCode) => g.milestones.find((m) => m.code === code)!;
    expect(by("new_apprentice").daysTaken).toBeNull();
    expect(by("first_sale").daysTaken).toBe(10);
    expect(by("core_150").daysTaken).toBe(53);
    expect(by("first_sponsor").daysTaken).toBeNull(); // before Core 150
    expect(by("core_150").progress).toBeNull();
    expect(g.next?.code).toBe("core_300");
  });

  it("hasReachedMilestone answers for one milestone", () => {
    const inp = input([ibo("a", null, "2026-01-01"), ibo("b", "a", "2026-02-01")]);
    expect(hasReachedMilestone(inp, "a", "first_sponsor", TODAY)).toBe(true);
    expect(hasReachedMilestone(inp, "a", "3_10", TODAY)).toBe(false);
    expect(hasReachedMilestone(inp, "b", "first_sponsor", TODAY)).toBe(false);
    expect(hasReachedMilestone(inp, "nobody", "new_apprentice", TODAY)).toBe(false);
  });

  it("with everything reached there is no next milestone", () => {
    const marks = GROWTH_CODES.map((code) => mark("a", code, "2025-01-01"));
    const g = growthPath(input([ibo("a", null, "2024-01-01")], [], [], marks), "a", TODAY);
    expect(g.nextIndex).toBe(-1);
    expect(g.next).toBeNull();
    expect(g.latest?.code).toBe("12_100");
    expect(g.workingDays).toBeNull();
  });

  it("recomputes when the data changes (no stale cache)", () => {
    const people2 = [ibo("a", null, "2026-01-01"), customer("c", "a")];
    const sales1 = [sale("c", "2026-10-02", 100)];
    const a = input(people2, sales1);
    expect(reachedOn(a, "a", "core_150")).toBeNull();
    const b = input(people2, [...sales1, sale("c", "2026-10-05", 60)]);
    expect(reachedOn(b, "a", "core_150")).toBe("2026-10-05");
    // A different day is a different answer too.
    expect(growthPath(b, "a", "2026-10-31").thisMonth.daysLeft).toBe(0);
  });
});
