import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import {
  bandBreakdown,
  bandOf,
  biggestGap,
  canEditStep,
  canHideStep,
  canRequestStats,
  canSeeStatsOf,
  canShareWith,
  chainOf,
  chainSteps,
  columnsFor,
  countReaches,
  countReachesByOwner,
  effectiveSettings,
  goalPace,
  isStale,
  monthActivity,
  rateTone,
  prospectDoNotContactIds,
  reachesOf,
  recruitingBand,
  registrationPatch,
  reorderOwnSteps,
  resolveColumn,
  stepLabelError,
  transitionStats,
  validateMove,
  boardCards,
  withUplines,
  comparisonPeriod,
} from "./rules";
import {
  DEFAULT_TARGETS,
  type PipelineCard,
  type PipelineMove,
  type PipelineStep,
  type StatShare,
  type StepHide,
} from "./types";

// Maria (1) ─┬─ Anita (2) ── Jamal (4) ── Carlos (9, prospect)
//            └─ David (3) ── Sarah (7)
const person = (
  id: string,
  bizClass: CrmPerson["bizClass"],
  sponsorId: string | null,
): CrmPerson => ({
  id,
  name: `P${id}`,
  bizClass,
  sponsorId,
});
const people: CrmPerson[] = [
  person("1", "ibo", null),
  person("2", "ibo", "1"),
  person("3", "ibo", "1"),
  person("4", "apprentice", "2"),
  person("7", "apprentice", "3"),
  person("9", "prospect", "4"),
];

const step = (
  id: string,
  ownerId: string,
  band: PipelineStep["band"],
  position: number,
): PipelineStep => ({
  id,
  ownerId,
  band,
  label: id,
  position,
  createdAt: "2026-01-01T00:00:00.000Z",
});
const steps: PipelineStep[] = [
  step("story", "1", "contact", 0),
  step("door", "1", "contact", 1),
  step("book", "1", "first_meeting", 0),
  step("f1", "1", "first_plan", 0),
  step("info3", "1", "first_plan", 1),
  step("threeway", "2", "first_meeting", 0),
];
const hides: StepHide[] = [
  { personId: "3", stepId: "info3", createdAt: "2026-01-01T00:00:00.000Z" },
];
const ids = (personId: string) =>
  columnsFor(chainOf(people, personId), steps, hides).map((c) => c.id);

describe("columns: milestones, bands and inherited steps", () => {
  it("chainOf is root-first and ends with the person", () => {
    expect(chainOf(people, "4")).toEqual(["1", "2", "4"]);
    expect(chainOf(people, "1")).toEqual(["1"]);
  });

  it("real accounts: a chain cut off at your own sponsor is completed with your uplines", () => {
    // Jamal's people list has no Maria: chainOf stops at his sponsor's id.
    const mine = people.filter((p) => p.id !== "1" && p.id !== "2");
    expect(chainOf(mine, "9")).toEqual(["2", "4", "9"]);
    expect(chainOf(mine, "9", ["1", "2", "4"])).toEqual(["1", "2", "4", "9"]);
    expect(withUplines(["4"], ["1", "2", "4"])).toEqual(["1", "2", "4"]);
    expect(withUplines(["1", "2", "4"], ["1", "2", "4"])).toEqual(["1", "2", "4"]); // already complete
    expect(withUplines(["2", "4"], [])).toEqual(["2", "4"]);
  });

  it("the four milestones are always there, in order, with steps in the band after their milestone", () => {
    expect(ids("1")).toEqual([
      "not_contacted",
      "contact",
      "story",
      "door",
      "first_meeting",
      "book",
      "first_plan",
      "f1",
      "info3",
      "registered",
      "not_interested",
      "do_not_contact",
    ]);
  });

  it("downlines inherit the whole chain's steps, uplines' first", () => {
    expect(ids("4")).toEqual([
      "not_contacted",
      "contact",
      "story",
      "door",
      "first_meeting",
      "book",
      "threeway",
      "first_plan",
      "f1",
      "info3",
      "registered",
      "not_interested",
      "do_not_contact",
    ]);
  });

  it('"Not contacted yet" comes first and the outcomes last, as on the customer board', () => {
    const cols = columnsFor(chainOf(people, "1"), steps, hides);
    expect(cols[0]).toMatchObject({ id: "not_contacted", band: "start", kind: "fixed" });
    expect(cols.slice(-2).map((c) => [c.id, c.band, c.kind])).toEqual([
      ["not_interested", "out", "fixed"],
      ["do_not_contact", "out", "fixed"],
    ]);
    expect(bandOf("not_contacted", steps)).toBe("start");
    expect(bandOf("do_not_contact", steps)).toBe("out");
    expect(recruitingBand("gone", steps)).toBe("contact");
  });

  it("won't let a step take a fixed column's name", () => {
    expect(stepLabelError("Not interested", [])).toMatch(/milestone/);
    expect(stepLabelError("do not contact", [])).toMatch(/milestone/);
  });

  it("a leader's own step is not seen by their upline or a crossline", () => {
    expect(ids("1")).not.toContain("threeway");
    expect(ids("3")).not.toContain("threeway");
  });

  it("a hidden step is gone for the hider and their downline, not for others", () => {
    expect(ids("3")).not.toContain("info3");
    expect(ids("7")).not.toContain("info3");
    expect(ids("2")).toContain("info3");
  });

  it("the steps editor shows who hides a step; an upline's hide wins", () => {
    const own = [...hides, { personId: "7", stepId: "info3", createdAt: "x" }];
    const list = chainSteps(chainOf(people, "7"), steps, own, "first_plan");
    expect(list.find((s) => s.step.id === "info3")?.hiddenBy).toBe("3");
    const anita = chainSteps(chainOf(people, "4"), steps, hides, "first_meeting");
    expect(anita.map((s) => [s.step.id, s.own])).toEqual([
      ["book", false],
      ["threeway", false],
    ]);
  });

  it("a card in a column this board doesn't have shows under its milestone", () => {
    const board = new Set(ids("1"));
    expect(resolveColumn("threeway", "first_meeting", board)).toBe("first_meeting");
    expect(resolveColumn("book", "first_meeting", board)).toBe("book");
    expect(resolveColumn("deleted-step", "first_plan", board)).toBe("first_plan");
  });
});

describe("steps editor rules", () => {
  it("only the owner edits a step; inherited steps can be hidden, own ones can't", () => {
    const threeway = steps.find((s) => s.id === "threeway")!;
    const story = steps.find((s) => s.id === "story")!;
    expect(canEditStep(threeway, "2")).toBe(true);
    expect(canEditStep(story, "2")).toBe(false);
    expect(canHideStep(story, chainOf(people, "2"), "2")).toBe(true);
    expect(canHideStep(threeway, chainOf(people, "2"), "2")).toBe(false);
    expect(canHideStep(threeway, chainOf(people, "3"), "3")).toBe(false); // crossline's step
  });

  it("milestone names, blanks, long names and duplicates are refused", () => {
    expect(stepLabelError("  ", [])).toMatch(/name/);
    expect(stepLabelError("first meeting", [])).toMatch(/milestone/);
    expect(stepLabelError("Registered", [])).toMatch(/milestone/);
    expect(stepLabelError("x".repeat(25), [])).toMatch(/24/);
    expect(stepLabelError("Book", ["Book"])).toMatch(/already/);
    expect(stepLabelError("Book", ["Book"], "Book")).toBeNull(); // renaming to itself
    expect(stepLabelError("Coffee chat", ["Book"])).toBeNull();
  });

  it("reordering only moves the owner's own steps within the band", () => {
    const moved = reorderOwnSteps(steps, "1", "door", -1);
    expect(moved.map((s) => [s.id, s.position])).toEqual([
      ["door", 0],
      ["story", 1],
    ]);
    expect(reorderOwnSteps(steps, "1", "story", -1)).toEqual([]); // already first
    expect(reorderOwnSteps(steps, "2", "story", 1)).toEqual([]); // not theirs
  });
});

describe("moves", () => {
  const card: PipelineCard = {
    personId: "9",
    column: "story",
    enteredAt: "2026-10-01T10:00:00.000Z",
    nextColumn: null,
    nextStepDate: null,
    nextStepTime: null,
    note: null,
    hot: false,
    source: null,
    droppedAt: null,
    updatedAt: "2026-10-01T10:00:00.000Z",
  };
  const cols = columnsFor(chainOf(people, "4"), steps, hides);

  it("moves to any column on the board, including milestones and the band's steps", () => {
    const r = validateMove(card, "first_meeting", cols);
    expect(r.ok && r.to.band).toBe("first_meeting");
    const s = validateMove(card, "threeway", cols);
    expect(s.ok && s.to.band).toBe("first_meeting");
  });

  it("refuses unknown columns, the same column and cards off the board", () => {
    expect(validateMove(card, "nope", cols)).toEqual({ ok: false, reason: "unknown-column" });
    expect(validateMove(card, "story", cols)).toEqual({ ok: false, reason: "same-column" });
    expect(validateMove({ ...card, droppedAt: "x" }, "door", cols)).toEqual({
      ok: false,
      reason: "not-on-board",
    });
    expect(validateMove(undefined, "door", cols)).toEqual({ ok: false, reason: "not-on-board" });
  });

  it("registering makes the person an apprentice from today", () => {
    expect(registrationPatch("2026-10-13")).toEqual({
      bizClass: "apprentice",
      pipelineStage: "apprentice",
      businessStartDate: "2026-10-13",
    });
  });

  it("prospects without a card sit in Contact made; dropped cards and non-prospects are off the board", () => {
    const p = { ...people[5], joinedDate: "2026-10-02" };
    const list = boardCards([p, people[3]], []);
    expect(list).toHaveLength(1);
    expect(list[0].card.column).toBe("contact");
    expect(boardCards([p], [{ ...card, droppedAt: "x" }])).toHaveLength(0);
  });
});

// Local noon on a day, as the store writes timestamps.
const at = (day: string, hour = 12) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour).toISOString();
};
let n = 0;
const mv = (
  personId: string,
  ownerId: string,
  to: string,
  milestone: PipelineMove["milestone"],
  day: string,
  from: string | null = null,
): PipelineMove => ({
  id: `m${n++}`,
  personId,
  ownerId,
  from,
  to,
  milestone,
  movedAt: at(day),
  movedBy: ownerId,
});

describe("activity: milestones reached", () => {
  it("counts each milestone once per person, on the first day it was reached", () => {
    const moves = [
      mv("a", "4", "contact", "contact", "2026-09-28"),
      mv("a", "4", "first_meeting", "first_meeting", "2026-10-02"),
      mv("a", "4", "story", "contact", "2026-10-03"), // moved back
      mv("a", "4", "first_meeting", "first_meeting", "2026-10-05"), // and forward again
    ];
    const c = countReaches(reachesOf(moves), null, "2026-10-01", "2026-10-31");
    expect(c).toEqual({ contact: 0, first_meeting: 1, first_plan: 0, registered: 0 });
  });

  it("skipping ahead reaches the milestones in between on the same day", () => {
    const moves = [mv("b", "4", "first_plan", "first_plan", "2026-10-04")];
    const c = countReaches(reachesOf(moves), null, "2026-10-01", "2026-10-31");
    expect(c).toEqual({ contact: 1, first_meeting: 1, first_plan: 1, registered: 0 });
  });

  it("filters by owner and splits per owner", () => {
    const moves = [
      mv("c", "4", "contact", "contact", "2026-10-01"),
      mv("d", "7", "contact", "contact", "2026-10-01"),
      mv("d", "7", "first_meeting", "first_meeting", "2026-10-03"),
    ];
    const r = reachesOf(moves);
    expect(countReaches(r, new Set(["4"]), "2026-10-01", "2026-10-31").contact).toBe(1);
    const by = countReachesByOwner(r, ["4", "7"], "2026-10-01", "2026-10-31");
    expect(by.get("7")?.first_meeting).toBe(1);
    expect(by.get("4")?.first_meeting).toBe(0);
  });

  it("this month so far is compared with the whole of last month", () => {
    const moves = [
      mv("e", "4", "first_meeting", "first_meeting", "2026-10-05"),
      mv("f", "4", "first_meeting", "first_meeting", "2026-09-05"),
      mv("g", "4", "first_meeting", "first_meeting", "2026-09-20"),
      mv("h", "4", "first_meeting", "first_meeting", "2026-10-20"), // later this month: not yet
    ];
    const a = monthActivity(reachesOf(moves), null, "2026-10", "2026-10-13");
    expect(a.partial).toBe(true);
    expect(a.counts.first_meeting).toBe(1);
    expect(a.previous.first_meeting).toBe(2);
    const full = monthActivity(reachesOf(moves), null, "2026-09", "2026-10-13");
    expect(full.partial).toBe(false);
    expect(full.counts.first_meeting).toBe(2);
  });

  it("a month is compared with the whole previous month (one place to change it)", () => {
    expect(comparisonPeriod("2026-10", "2026-10-13")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(comparisonPeriod("2026-03", "2026-10-13")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("goal pace: what's left over the days left, today included", () => {
    expect(goalPace(62, 80, "2026-10-13")).toEqual({
      remaining: 18,
      daysLeft: 19,
      perDay: 18 / 19,
      reached: false,
    });
    expect(goalPace(85, 80, "2026-10-31").reached).toBe(true);
  });
});

describe("conversions", () => {
  it("tones: at or above target good, 1–4 points below warn, 5 or more below bad", () => {
    expect(rateTone(30, 30)).toBe("good");
    expect(rateTone(33, 30)).toBe("good");
    expect(rateTone(29, 30)).toBe("warn");
    expect(rateTone(26, 30)).toBe("warn");
    expect(rateTone(25, 30)).toBe("bad");
  });

  it("rates are next / previous milestone, and fewer than 10 people shows no rate", () => {
    const s = transitionStats(
      { contact: 620, first_meeting: 172, first_plan: 76, registered: 18 },
      DEFAULT_TARGETS,
    );
    expect(s.map((x) => x.pct)).toEqual([28, 44, 24]);
    expect(s.map((x) => x.tone)).toEqual(["warn", "warn", "bad"]);
    expect(s[0].lost).toBe(448);
    const small = transitionStats(
      { contact: 30, first_meeting: 9, first_plan: 4, registered: 1 },
      DEFAULT_TARGETS,
    );
    expect(small.map((x) => x.pct)).toEqual([30, null, null]);
    expect(small[1].tone).toBeNull();
  });

  it("the biggest gap is the rate furthest below target; none when all are on target", () => {
    const s = transitionStats(
      { contact: 620, first_meeting: 172, first_plan: 76, registered: 18 },
      DEFAULT_TARGETS,
    );
    expect(biggestGap(s)?.key).toBe("planToRegistered");
    const good = transitionStats(
      { contact: 100, first_meeting: 40, first_plan: 20, registered: 10 },
      DEFAULT_TARGETS,
    );
    expect(biggestGap(good)).toBeNull();
  });

  it("inside the steps: how far each person who reached the milestone got, and the biggest stall", () => {
    const cols = columnsFor(chainOf(people, "1"), steps, hides);
    const moves: PipelineMove[] = [];
    // 4 reach First plan; 3 get to F1; 1 to Info 3; 1 registers.
    for (const p of ["p1", "p2", "p3", "p4"])
      moves.push(mv(p, "1", "first_plan", "first_plan", "2026-10-02"));
    for (const p of ["p1", "p2", "p3"]) moves.push(mv(p, "1", "f1", "first_plan", "2026-10-04"));
    moves.push(mv("p1", "1", "info3", "first_plan", "2026-10-06"));
    moves.push(mv("p1", "1", "registered", "registered", "2026-10-09"));
    const b = bandBreakdown(
      moves,
      reachesOf(moves),
      cols,
      null,
      "first_plan",
      "2026-10-01",
      "2026-10-31",
    );
    expect(b.cohort).toBe(4);
    expect(b.items.map((i) => [i.column.id, i.count])).toEqual([
      ["first_plan", 4],
      ["f1", 3],
      ["info3", 1],
    ]);
    expect(b.next).toEqual({ milestone: "registered", count: 1 });
    expect(b.worst).toMatchObject({ stalled: 2, of: 3 });
    expect(b.worst?.column.id).toBe("f1");
  });

  it("inside the steps: moving to Not interested or Do not contact isn't progress", () => {
    const cols = columnsFor(chainOf(people, "1"), steps, hides);
    const moves = [
      mv("p1", "1", "first_plan", "first_plan", "2026-10-02"),
      mv("p2", "1", "first_plan", "first_plan", "2026-10-02"),
      mv("p2", "1", "f1", "first_plan", "2026-10-03"),
      mv("p1", "1", "not_interested", "out", "2026-10-04"),
      mv("p2", "1", "do_not_contact", "out", "2026-10-05"),
    ];
    const b = bandBreakdown(
      moves,
      reachesOf(moves),
      cols,
      null,
      "first_plan",
      "2026-10-01",
      "2026-10-31",
    );
    expect(b.items.map((i) => [i.column.id, i.count])).toEqual([
      ["first_plan", 2],
      ["f1", 1],
      ["info3", 0],
    ]);
    expect(b.next.count).toBe(0);
  });
});

describe("not contacted yet and the outcomes", () => {
  it("reach no milestone", () => {
    const moves = [
      mv("a", "4", "not_contacted", "start", "2026-10-01"),
      mv("a", "4", "contact", "contact", "2026-10-02", "not_contacted"),
      mv("a", "4", "not_interested", "out", "2026-10-03", "contact"),
      mv("b", "4", "do_not_contact", "out", "2026-10-03"),
    ];
    expect(reachesOf(moves).map((r) => [r.personId, r.milestone])).toEqual([["a", "contact"]]);
  });

  it("Do not contact hides the prospect from reminders (cards still on the board)", () => {
    const c = (personId: string, column: string, droppedAt: string | null = null) =>
      ({ personId, column, droppedAt }) as PipelineCard;
    expect([
      ...prospectDoNotContactIds([
        c("a", "do_not_contact"),
        c("b", "not_interested"),
        c("c", "do_not_contact", "2026-10-01T00:00:00.000Z"),
      ]),
    ]).toEqual(["a"]);
  });
});

describe("who sees whose numbers", () => {
  const shares: StatShare[] = [{ id: "s", ownerId: "3", viewerId: "2", createdAt: "x" }];
  const v = (personId: string, role: "leader" | "ibo" | "apprentice" | "candidate" = "ibo") => ({
    personId,
    role,
  });

  it("yourself and your downline, never crosslines or uplines", () => {
    expect(canSeeStatsOf(people, v("2"), "2", [])).toBe(true);
    expect(canSeeStatsOf(people, v("2"), "4", [])).toBe(true);
    expect(canSeeStatsOf(people, v("1", "leader"), "4", [])).toBe(true);
    expect(canSeeStatsOf(people, v("2"), "3", [])).toBe(false); // crossline
    expect(canSeeStatsOf(people, v("4", "apprentice"), "2", [])).toBe(false); // upline
    expect(canSeeStatsOf(people, v("4", "apprentice"), "1", [])).toBe(false);
  });

  it("anyone who shared with you, and nobody for candidates", () => {
    expect(canSeeStatsOf(people, v("2"), "3", shares)).toBe(true);
    expect(canSeeStatsOf(people, v("7", "apprentice"), "2", shares)).toBe(false);
    expect(canSeeStatsOf(people, v("9", "candidate"), "9", [])).toBe(false);
    expect(canSeeStatsOf(people, null, "1", [])).toBe(false);
  });

  it("requests: not yourself, not someone you already see, not twice", () => {
    expect(canRequestStats(people, v("4", "apprentice"), "1", [], [])).toEqual({ ok: true });
    expect(canRequestStats(people, v("2"), "4", [], [])).toEqual({ ok: false, reason: "already" });
    expect(canRequestStats(people, v("2"), "2", [], [])).toEqual({ ok: false, reason: "self" });
    const pending = [
      {
        id: "r",
        requesterId: "2",
        ownerId: "3",
        status: "pending" as const,
        createdAt: "x",
        decidedAt: null,
      },
    ];
    expect(canRequestStats(people, v("2"), "3", [], pending)).toEqual({
      ok: false,
      reason: "pending",
    });
  });

  it("sharing: not with yourself, not with an upline (they already see it), not twice", () => {
    expect(canShareWith(people, "4", "1", [])).toBe(false);
    expect(canShareWith(people, "4", "2", [])).toBe(false);
    expect(canShareWith(people, "4", "4", [])).toBe(false);
    expect(canShareWith(people, "4", "7", [])).toBe(true);
    expect(canShareWith(people, "3", "2", shares)).toBe(false);
  });
});

describe("team settings and stale cards", () => {
  it("goal and targets come from the nearest leader up the chain who set them, else defaults", () => {
    const at0 = "2026-01-01T00:00:00.000Z";
    const settings = [
      {
        personId: "1",
        mg1Goal: 80,
        targets: { ...DEFAULT_TARGETS, contactToMeeting: 32 },
        updatedAt: at0,
      },
      { personId: "2", mg1Goal: 35, targets: null, updatedAt: at0 },
    ];
    const jamal = effectiveSettings(chainOf(people, "4"), settings);
    expect(jamal.mg1Goal).toBe(35);
    expect(jamal.goalFrom).toBe("2");
    expect(jamal.targets.contactToMeeting).toBe(32);
    expect(jamal.targetsFrom).toBe("1");
    const nobody = effectiveSettings(["x"], []);
    expect(nobody).toEqual({
      mg1Goal: 80,
      goalFrom: null,
      targets: DEFAULT_TARGETS,
      targetsFrom: null,
    });
  });

  it("stale after 14 days without movement or contact", () => {
    expect(isStale(at("2026-09-29"), undefined, "2026-10-13")).toBe(true);
    expect(isStale(at("2026-09-30"), undefined, "2026-10-13")).toBe(false);
    expect(isStale(at("2026-09-01"), "2026-10-05", "2026-10-13")).toBe(false);
  });
});
