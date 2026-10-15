import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import type { Sale } from "@/stores/crmStore";
import {
  addMonths,
  growthPath,
  hasEverReachedMilestone,
  historyUpdates,
  isMilestoneHeld,
  isPersonalOrder,
  lastDayOf,
  monthPv,
  registeredOn,
  saleSellerId,
  type GrowthInput,
} from "./engine";
import {
  GROWTH_MILESTONES,
  growthHold,
  growthIndex,
  growthLabel,
  isGrowthCode,
} from "./milestones";
import {
  GROWTH_CODES,
  type GrowthMilestoneCode,
  type MilestoneHistory,
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
  history: MilestoneHistory[] = [],
): GrowthInput {
  return { people, sales, overrides, marks, history };
}

const statusOf = (inp: GrowthInput, id: string, code: GrowthMilestoneCode, today = TODAY) =>
  growthPath(inp, id, today).milestones.find((m) => m.code === code)!;
/** The first day it was ever reached (history; not whether it's held now). */
const reachedOn = (inp: GrowthInput, id: string, code: GrowthMilestoneCode, today = TODAY) =>
  statusOf(inp, id, code, today).firstReachedOn;
const stateOf = (inp: GrowthInput, id: string, code: GrowthMilestoneCode, today = TODAY) =>
  statusOf(inp, id, code, today).state;

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

  it("each milestone has its hold class: permanent, live (headcount) or monthly (volume)", () => {
    const by = (hold: string) =>
      GROWTH_MILESTONES.filter((m) => m.hold === hold).map((m) => m.code);
    expect(by("permanent")).toEqual(["new_apprentice", "first_sale", "first_sponsor"]);
    expect(by("live")).toEqual(["3_10", "6_25", "6_50", "12_100"]);
    expect(by("monthly")).toEqual([
      "core_150",
      "core_300",
      "bronze_foundation",
      "bronze_builder",
      "platinum",
      "ruby",
    ]);
    expect(growthHold("ruby")).toBe("monthly");
    expect(growthHold("6_50")).toBe("live");
  });

  it("month arithmetic crosses year ends", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-10", -13)).toBe("2025-09");
    expect(addMonths("2026-10", 0)).toBe("2026-10");
    expect(lastDayOf("2024-02")).toBe("2024-02-29");
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2025-12")).toBe("2025-12-31");
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

  it("after quiet months the first date stays as history, but it isn't held; Core 300 shows this month", () => {
    const inp = input(people, [sale("c", "2026-05-12", 160), sale("c", "2026-10-02", 95)]);
    expect(reachedOn(inp, "a", "core_150")).toBe("2026-05-12");
    expect(statusOf(inp, "a", "core_150")).toMatchObject({
      state: "lost",
      held: false,
      lastMetOn: "2026-05-12",
      heldVia: null,
    });
    expect(statusOf(inp, "a", "core_150").progress?.summary).toBe("95 / 150 PV this month");
    const core300 = statusOf(inp, "a", "core_300");
    expect(core300.firstReachedOn).toBeNull();
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
      firstReachedOn: "2024-03-01",
      source: "manual",
      autoOn: "2026-02-10",
      // A mark on a volume milestone is history: February is neither this month nor last.
      state: "lost",
    });
    const later = input(
      people,
      [sale("c", "2024-02-10", 200)],
      [],
      [mark("a", "core_150", "2024-03-01")],
    );
    expect(statusOf(later, "a", "core_150")).toMatchObject({
      firstReachedOn: "2024-02-10",
      source: "auto",
    });
    expect(statusOf(later, "a", "core_150").mark?.markedBy).toBe("boss");
  });

  it("next is the first milestone not reached; later ones reached out of order still show", () => {
    const inp = input([ibo("a", null, "2026-01-01"), ibo("b", "a", "2026-02-01")], [], [], []);
    const g = growthPath(inp, "a", TODAY);
    expect(g.next?.code).toBe("first_sale");
    expect(g.nextIndex).toBe(1);
    expect(statusOf(inp, "a", "first_sponsor").firstReachedOn).toBe("2026-02-01");
    expect(statusOf(inp, "a", "first_sponsor").held).toBe(true);
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
    // Core 150 was met in March: history now, and the path's next goal again.
    expect(by("core_150").state).toBe("lost");
    expect(g.next?.code).toBe("core_150");
    expect(g.workingDays).toBeNull(); // being earned again, not new
  });

  it("hasEverReachedMilestone and isMilestoneHeld answer for one milestone", () => {
    const inp = input(
      [ibo("a", null, "2026-01-01"), ibo("b", "a", "2026-02-01"), customer("c", "a")],
      [sale("c", "2026-05-05", 200)],
    );
    expect(hasEverReachedMilestone(inp, "a", "first_sponsor", TODAY)).toBe(true);
    expect(isMilestoneHeld(inp, "a", "first_sponsor", TODAY)).toBe(true);
    expect(hasEverReachedMilestone(inp, "a", "core_150", TODAY)).toBe(true);
    expect(isMilestoneHeld(inp, "a", "core_150", TODAY)).toBe(false);
    expect(hasEverReachedMilestone(inp, "a", "3_10", TODAY)).toBe(false);
    expect(hasEverReachedMilestone(inp, "b", "first_sponsor", TODAY)).toBe(false);
    expect(hasEverReachedMilestone(inp, "nobody", "new_apprentice", TODAY)).toBe(false);
    expect(isMilestoneHeld(inp, "nobody", "new_apprentice", TODAY)).toBe(false);
  });

  it("marks alone hold only the permanent milestones", () => {
    const marks = GROWTH_CODES.map((code) => mark("a", code, "2025-01-01"));
    const g = growthPath(input([ibo("a", null, "2024-01-01")], [], [], marks), "a", TODAY);
    expect(g.milestones.filter((m) => m.held).map((m) => m.code)).toEqual([
      "new_apprentice",
      "first_sale",
      "first_sponsor",
    ]);
    expect(g.milestones.every((m) => m.firstReachedOn !== null)).toBe(true);
    expect(g.next?.code).toBe("core_150");
    expect(g.next?.state).toBe("lost");
    expect(g.latest?.code).toBe("first_sponsor");
  });

  it("with everything held there is no next milestone", () => {
    // 12 frontline, 100 people, 15,900 group PV this month, 300 of it a's own.
    const people = [ibo("a", null, "2020-01-01"), customer("c", "a")];
    people.push(...frontline("f", "a", 12, "2021-01-01"));
    for (let i = 0; i < 88; i++) people.push(ibo(`g${i}`, `f${(i % 12) + 1}`, "2022-01-01"));
    const sales = [sale("c", "2026-10-02", 300)];
    for (let i = 1; i <= 12; i++) sales.push(sale(`f${i}`, "2026-10-05", 1300));
    const g = growthPath(input(people, sales), "a", TODAY);
    expect(g.milestones.every((m) => m.held)).toBe(true);
    expect(g.nextIndex).toBe(-1);
    expect(g.next).toBeNull();
    expect(g.latest?.code).toBe("12_100");
    expect(g.workingDays).toBeNull();
    expect(g.keepUp).toEqual([]);
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

// ---------------------------------------------------------------------------
// Held now vs. history: the three hold classes
// ---------------------------------------------------------------------------

/** a (registered 2025-01-01) at 3/10: three frontline, the 10th person (d7) registered 2025-05-10. */
const tenPeople = (): CrmPerson[] => [
  ibo("a", null, "2025-01-01"),
  customer("c", "a"),
  ...frontline("f", "a", 3, "2025-02-01"),
  ...Array.from({ length: 6 }, (_, i) => ibo(`d${i + 1}`, "f1", "2025-04-01")),
  ibo("d7", "f2", "2025-05-10"),
];
/** This month: a's own 300 and three legs at 300 (Core 150/300 and Bronze foundation held, not Bronze builder). */
const october = (): Sale[] => [
  sale("c", "2026-10-02", 300),
  sale("f1", "2026-10-03", 300),
  sale("f2", "2026-10-03", 300),
  sale("f3", "2026-10-03", 300),
];
const recorded = (rows: ReturnType<typeof historyUpdates>, at = "2026-06-15T10:00:00.000Z") =>
  rows.map((r) => ({ ...r, recordedAt: at, recordedBy: "a" }));

describe("headcount milestones are live", () => {
  const dropped = () => tenPeople().filter((p) => p.id !== "d7");

  it("held while the numbers meet them", () => {
    expect(statusOf(input(tenPeople()), "a", "3_10")).toMatchObject({
      hold: "live",
      state: "held",
      held: true,
      firstReachedOn: "2025-05-10",
      source: "auto",
      lastMetOn: TODAY,
      heldVia: null,
      heldUntil: null,
      progress: null,
    });
  });

  it("dropping below un-holds them; with nothing recorded the data can't tell they were met", () => {
    const s = statusOf(input(dropped()), "a", "3_10");
    expect(s.state).toBe("never");
    expect(s.progress?.summary).toBe("3/3 personal sponsors, 9/10 people");
  });

  it("with the history the app recorded, a drop keeps the first date: earned before, earn it again", () => {
    const rows = historyUpdates(input(tenPeople()), ["a"], "2026-06-15");
    expect(rows).toEqual([
      {
        personId: "a",
        code: "first_sponsor",
        firstReachedOn: "2025-02-01",
        lastMetOn: "2026-06-15",
      },
      { personId: "a", code: "3_10", firstReachedOn: "2025-05-10", lastMetOn: "2026-06-15" },
    ]);
    const after = input(dropped(), october(), [], [], recorded(rows));
    expect(statusOf(after, "a", "3_10")).toMatchObject({
      state: "lost",
      held: false,
      firstReachedOn: "2025-05-10",
      source: "auto",
      lastMetOn: "2026-06-15",
    });
    const g = growthPath(after, "a", TODAY);
    // Everything before it is held, so 3/10 is the goal again, with its numbers.
    expect(g.next?.code).toBe("3_10");
    expect(g.next?.progress?.summary).toBe("3/3 personal sponsors, 9/10 people");
    expect(g.workingDays).toBeNull();
    expect(g.latest?.code).toBe("bronze_foundation");
  });

  it("re-earned when the numbers are back; the first date stays the first", () => {
    const rows = recorded(historyUpdates(input(tenPeople()), ["a"], "2026-06-15"));
    const back = input([...dropped(), ibo("d8", "f3", "2026-10-10")], october(), [], [], rows);
    expect(statusOf(back, "a", "3_10")).toMatchObject({
      state: "held",
      firstReachedOn: "2025-05-10",
      lastMetOn: TODAY,
    });
    // Without the record the first date would be the re-earn day.
    expect(reachedOn(input([...dropped(), ibo("d8", "f3", "2026-10-10")]), "a", "3_10")).toBe(
      "2026-10-10",
    );
  });

  it("First sponsor is permanent: recorded once, it stays when the sponsor leaves", () => {
    const rows = recorded(historyUpdates(input(tenPeople()), ["a"], "2026-06-15"));
    const alone = input([ibo("a", null, "2025-01-01")], [], [], [], rows);
    expect(statusOf(alone, "a", "first_sponsor")).toMatchObject({
      state: "held",
      firstReachedOn: "2025-02-01",
    });
  });
});

describe("recording history (historyUpdates)", () => {
  const rec = (code: GrowthMilestoneCode, first: string, last: string): MilestoneHistory => ({
    personId: "a",
    code,
    firstReachedOn: first,
    lastMetOn: last,
    recordedAt: "2026-10-01T10:00:00.000Z",
  });

  it("writes nothing new once recorded this month", () => {
    const history = [
      rec("first_sponsor", "2025-02-01", "2026-10-01"),
      rec("3_10", "2025-05-10", "2026-10-02"),
    ];
    expect(historyUpdates(input(tenPeople(), [], [], [], history), ["a"], TODAY)).toEqual([]);
  });

  it("refreshes the last-met day once a month and keeps the earlier first day", () => {
    const history = [
      rec("first_sponsor", "2025-02-01", "2026-10-01"),
      rec("3_10", "2024-12-01", "2026-09-30"),
    ];
    expect(historyUpdates(input(tenPeople(), [], [], [], history), ["a"], TODAY)).toEqual([
      { personId: "a", code: "3_10", firstReachedOn: "2024-12-01", lastMetOn: TODAY },
    ]);
  });

  it("moves the first day earlier when the data shows an earlier one", () => {
    const history = [
      rec("first_sponsor", "2025-02-01", "2026-10-01"),
      rec("3_10", "2025-08-01", "2026-10-01"),
    ];
    expect(historyUpdates(input(tenPeople(), [], [], [], history), ["a"], TODAY)).toEqual([
      { personId: "a", code: "3_10", firstReachedOn: "2025-05-10", lastMetOn: TODAY },
    ]);
  });

  it("only registered people, only count milestones met now", () => {
    const people = [...tenPeople(), prospect("p", "a")];
    const sales = [sale("c", "2026-10-02", 900)];
    expect(historyUpdates(input(people, sales), ["p", "nobody", "f1"], TODAY)).toEqual([
      { personId: "f1", code: "first_sponsor", firstReachedOn: "2025-04-01", lastMetOn: TODAY },
    ]);
  });
});

describe("volume milestones are held for the month after", () => {
  const people = [ibo("a", null, "2025-01-01"), customer("c", "a")];
  const september = input(people, [sale("c", "2026-09-20", 200)]);

  it("met last month: held through the end of this month, with a heads-up and this month's numbers", () => {
    const s = statusOf(september, "a", "core_150", "2026-10-13");
    expect(s).toMatchObject({
      hold: "monthly",
      state: "held",
      held: true,
      heldVia: "last_month",
      heldUntil: "2026-10-31",
      firstReachedOn: "2026-09-20",
      lastMetOn: "2026-09-20",
    });
    expect(s.progress?.summary).toBe("0 / 150 PV this month");
    expect(growthPath(september, "a", "2026-10-13").keepUp.map((k) => k.code)).toEqual([
      "core_150",
    ]);
    expect(isMilestoneHeld(september, "a", "core_150", "2026-10-31")).toBe(true);
  });

  it("falls back on the 1st of the month after unless met again", () => {
    expect(statusOf(september, "a", "core_150", "2026-11-01")).toMatchObject({
      state: "lost",
      held: false,
      heldVia: null,
      heldUntil: null,
      firstReachedOn: "2026-09-20",
      lastMetOn: "2026-09-20",
    });
    const g = growthPath(september, "a", "2026-11-01");
    expect(g.keepUp).toEqual([]);
    expect(g.next?.code).toBe("core_150");
    expect(hasEverReachedMilestone(september, "a", "core_150", "2026-11-01")).toBe(true);
  });

  it("met again: held from that day through the end of the next month", () => {
    const again = input(people, [sale("c", "2026-09-20", 200), sale("c", "2026-11-03", 150)]);
    expect(stateOf(again, "a", "core_150", "2026-11-02")).toBe("lost");
    expect(statusOf(again, "a", "core_150", "2026-11-05")).toMatchObject({
      state: "held",
      heldVia: "this_month",
      heldUntil: "2026-12-31",
      firstReachedOn: "2026-09-20",
      lastMetOn: "2026-11-03",
      progress: null,
    });
  });

  it("met this month and last: held through next month (this month counts)", () => {
    const both = input(people, [sale("c", "2026-09-20", 200), sale("c", "2026-10-05", 200)]);
    expect(statusOf(both, "a", "core_150")).toMatchObject({
      heldVia: "this_month",
      heldUntil: "2026-11-30",
      lastMetOn: "2026-10-05",
    });
    expect(growthPath(both, "a", TODAY).keepUp).toEqual([]);
  });

  it("across the year end: December holds January; January holds February", () => {
    const dec = input(people, [sale("c", "2025-12-30", 160)]);
    expect(statusOf(dec, "a", "core_150", "2026-01-15")).toMatchObject({
      heldVia: "last_month",
      heldUntil: "2026-01-31",
    });
    expect(isMilestoneHeld(dec, "a", "core_150", "2026-01-31")).toBe(true);
    expect(stateOf(dec, "a", "core_150", "2026-02-01")).toBe("lost");

    const nov = input(people, [sale("c", "2025-11-15", 160)]);
    expect(statusOf(nov, "a", "core_150", "2025-12-31")).toMatchObject({
      heldVia: "last_month",
      heldUntil: "2025-12-31",
    });
    expect(stateOf(nov, "a", "core_150", "2026-01-01")).toBe("lost");

    const jan = input(people, [sale("c", "2026-01-10", 160)]);
    expect(statusOf(jan, "a", "core_150", "2026-01-20")).toMatchObject({
      heldVia: "this_month",
      heldUntil: "2026-02-28",
    });
    expect(statusOf(jan, "a", "core_150", "2026-02-28").heldVia).toBe("last_month");
    expect(stateOf(jan, "a", "core_150", "2026-03-01")).toBe("lost");
    // Before the sale it isn't held yet (nothing counts ahead of today).
    expect(stateOf(jan, "a", "core_150", "2026-01-09")).toBe("never");
  });

  it("an upline's figure for this month counts from the day it was set, not before", () => {
    const inp = input(people, [], [override("a", "2026-10", 200, "2026-10-20T09:00:00.000Z")]);
    expect(stateOf(inp, "a", "core_150", "2026-10-13")).toBe("never");
    expect(statusOf(inp, "a", "core_150", "2026-10-21")).toMatchObject({
      heldVia: "this_month",
      firstReachedOn: "2026-10-20",
    });
  });

  it("group PV and leg rules work the same way", () => {
    const team = [
      ibo("a", null, "2025-01-01"),
      ibo("b", "a", "2025-02-01"),
      ibo("c", "a", "2025-02-01"),
      ibo("d", "a", "2025-02-01"),
    ];
    const inp = input(team, [
      sale("b", "2026-09-04", 3000),
      sale("c", "2026-09-04", 3000),
      sale("d", "2026-09-04", 2000),
    ]);
    const g = growthPath(inp, "a", TODAY);
    expect(g.keepUp.map((s) => s.code)).toEqual([
      "bronze_foundation",
      "bronze_builder",
      "platinum",
    ]);
    expect(statusOf(inp, "a", "ruby").state).toBe("never");
    expect(statusOf(inp, "a", "platinum").progress?.summary).toBe("0 / 7,500 group PV this month");
    expect(stateOf(inp, "a", "bronze_builder", "2026-11-01")).toBe("lost");
  });
});

describe("hand marks by class", () => {
  it("permanent: a mark counts as reached", () => {
    const inp = input(
      [ibo("a", null, "2024-01-01")],
      [],
      [],
      [mark("a", "first_sale", "2024-02-01"), mark("a", "first_sponsor", "2024-03-01")],
    );
    expect(statusOf(inp, "a", "first_sale")).toMatchObject({ state: "held", source: "manual" });
    expect(statusOf(inp, "a", "first_sponsor")).toMatchObject({
      state: "held",
      firstReachedOn: "2024-03-01",
      source: "manual",
    });
  });

  it("live: a mark is history only; it's held only while the numbers meet it", () => {
    const marked = input([ibo("a", null, "2024-01-01")], [], [], [mark("a", "3_10", "2024-06-01")]);
    expect(statusOf(marked, "a", "3_10")).toMatchObject({
      state: "lost",
      held: false,
      firstReachedOn: "2024-06-01",
      source: "manual",
      lastMetOn: null,
    });
    expect(hasEverReachedMilestone(marked, "a", "3_10", TODAY)).toBe(true);
    const met = input(tenPeople(), [], [], [mark("a", "3_10", "2025-03-01")]);
    expect(statusOf(met, "a", "3_10")).toMatchObject({
      state: "held",
      firstReachedOn: "2025-03-01",
      source: "manual",
      autoOn: "2025-05-10",
    });
  });

  it("monthly: a mark is history only; PV this month or last holds it", () => {
    const team = [ibo("a", null, "2024-01-01"), ibo("b", "a", "2024-02-01")];
    const marks = [mark("a", "platinum", "2025-06-01")];
    expect(statusOf(input(team, [], [], marks), "a", "platinum")).toMatchObject({
      state: "lost",
      firstReachedOn: "2025-06-01",
      source: "manual",
    });
    const now = input(team, [sale("b", "2026-10-04", 8000)], [], marks);
    expect(statusOf(now, "a", "platinum")).toMatchObject({
      state: "held",
      heldVia: "this_month",
      firstReachedOn: "2025-06-01",
      source: "manual",
      autoOn: "2026-10-04",
    });
  });
});

describe("the next milestone", () => {
  /**
   * Like Maria: 6 sponsors and 43 people (6/25 held, 6/50 lost, marked as
   * first hit in June 2025), Bronze builder this month, 15,600 group PV last
   * month (7,500 Platinum and Ruby held through this month).
   */
  function leader(): GrowthInput {
    const people = [ibo("a", null, "2020-01-01"), customer("c", "a")];
    people.push(...frontline("f", "a", 6, "2021-01-01"));
    for (let i = 0; i < 37; i++) people.push(ibo(`g${i}`, `f${(i % 6) + 1}`, "2022-01-01"));
    const sales = [sale("c", "2026-10-02", 300)];
    for (let i = 1; i <= 6; i++) {
      sales.push(sale(`f${i}`, "2026-10-05", 500));
      sales.push(sale(`f${i}`, "2026-09-10", 2600));
    }
    return input(people, sales, [], [mark("a", "6_50", "2025-06-01")]);
  }

  it("is the first milestone not held now; later ones held out of order still show as held", () => {
    const g = growthPath(leader(), "a", TODAY);
    expect(g.next?.code).toBe("6_50");
    expect(g.nextIndex).toBe(9);
    expect(g.next).toMatchObject({ state: "lost", firstReachedOn: "2025-06-01" });
    expect(g.next?.progress?.summary).toBe("6/6 personal sponsors, 43/50 people");
    expect(g.workingDays).toBeNull();
    const by = (code: GrowthMilestoneCode) => g.milestones.find((m) => m.code === code)!;
    expect(by("platinum")).toMatchObject({ held: true, heldVia: "last_month" });
    expect(by("ruby")).toMatchObject({
      held: true,
      heldVia: "last_month",
      heldUntil: "2026-10-31",
    });
    expect(by("ruby").progress?.summary).toBe("3,300 / 15,000 group PV this month");
    expect(by("6_25").held).toBe(true);
    expect(by("12_100").state).toBe("never");
    expect(g.keepUp.map((s) => s.code)).toEqual(["platinum", "ruby"]);
    expect(g.latest?.code).toBe("ruby");
  });

  it("a never-reached next milestone counts working days from the one before", () => {
    const g = growthPath(input(tenPeople(), october()), "a", TODAY);
    expect(g.next?.code).toBe("bronze_builder");
    expect(g.next?.state).toBe("never");
    expect(g.workingDays).toBe(521); // since 3/10 (2025-05-10)
  });
});

describe("unlocks go by ever reached", () => {
  it("dropping below 3/10 keeps it as reached once (history or a mark), not held", () => {
    const rows = recorded(historyUpdates(input(tenPeople()), ["a"], "2026-06-15"));
    const dropped = input(
      tenPeople().filter((p) => p.id !== "d7"),
      [],
      [],
      [],
      rows,
    );
    expect(hasEverReachedMilestone(dropped, "a", "3_10", TODAY)).toBe(true);
    expect(isMilestoneHeld(dropped, "a", "3_10", TODAY)).toBe(false);
    expect(hasEverReachedMilestone(dropped, "a", "first_sponsor", TODAY)).toBe(true);
    const marked = input(
      tenPeople().filter((p) => p.id !== "d7"),
      [],
      [],
      [mark("a", "3_10", "2025-05-10")],
    );
    expect(hasEverReachedMilestone(marked, "a", "3_10", TODAY)).toBe(true);
    expect(isMilestoneHeld(marked, "a", "3_10", TODAY)).toBe(false);
  });
});
