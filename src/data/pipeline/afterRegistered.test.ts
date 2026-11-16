import { describe, expect, it } from "vitest";
import {
  afterRegistered,
  registeredInProgressIds,
  zonedDay,
  type AfterRegisteredInput,
  type InProgressState,
} from "./afterRegistered";
import {
  bandOf,
  chainSteps,
  columnsFor,
  implicitRegisteredCard,
  registeredColumnOf,
  validateMove,
  validateProspectMove,
  validateRegisteredMove,
} from "./rules";
import { CUSTOMER_BOARD } from "../customerPipeline/types";
import { RECRUITING_BOARD, type PipelineCard, type PipelineStep, type StepHide } from "./types";
import type { CrmPerson } from "@/stores/peopleStore";

const TZ = "Asia/Kolkata"; // UTC+5:30, no daylight saving: month edges are easy to place
const TODAY = "2026-11-16";
const NOW = new Date("2026-11-16T09:00:00.000Z");

const step = (
  id: string,
  ownerId: string,
  position: number,
  createdAt: string,
  band = "registered",
) => ({ id, ownerId, band, label: id.toUpperCase(), position, createdAt }) as PipelineStep;
const card = (
  personId: string,
  column: string,
  enteredAt: string,
  droppedAt: string | null = null,
): PipelineCard => ({
  personId,
  column,
  enteredAt,
  rating: null,
  source: null,
  droppedAt,
  updatedAt: enteredAt,
});
const reg = (
  id: string,
  businessStartDate: string,
  bizClass: CrmPerson["bizClass"] = "apprentice",
  sponsorId = "2",
) => ({ id, bizClass, businessStartDate, sponsorId, lastUpdatedAt: undefined }) as CrmPerson;

// Cards, in the team's calendar: this month is November 2026 (TODAY).
const THIS_MONTH = "2026-11-05T10:00:00.000Z";
const LAST_MONTH = "2026-10-20T10:00:00.000Z";
// Maria (1) leads Anita (2). Maria has two steps after Registered, Anita one.
const STEPS = [
  step("s-act", "1", 0, "2026-11-02T10:00:00.000Z"),
  step("s-90", "1", 1, "2026-11-03T10:00:00.000Z"),
  step("s-call", "2", 0, "2026-11-04T10:00:00.000Z"),
  step("s-info", "1", 0, "2026-09-01T10:00:00.000Z", "first_plan"),
];
const colsFor = (chain: string[], steps = STEPS, hides: StepHide[] = []) =>
  columnsFor(chain, steps, hides, RECRUITING_BOARD);
const input = (over: Partial<AfterRegisteredInput> = {}): AfterRegisteredInput => ({
  columns: colsFor(["1", "2"]),
  steps: STEPS,
  people: [],
  cards: [],
  moves: [],
  today: TODAY,
  timeZone: TZ,
  ...over,
});
const ids = (r: ReturnType<typeof afterRegistered>, col: string) =>
  r.columns.find((c) => c.column.id === col)?.cards.map((c) => c.personId);

describe("steps after Registered: the columns", () => {
  it("come after Registered, uplines' first, then the outcome columns", () => {
    expect(colsFor(["1", "2"]).map((c) => c.id)).toEqual([
      "not_contacted",
      "contact",
      "first_meeting",
      "first_plan",
      "s-info",
      "registered",
      "s-act",
      "s-90",
      "s-call",
      "referral_source",
      "not_interested",
      "do_not_contact",
    ]);
    expect(colsFor(["1"]).map((c) => c.id)).not.toContain("s-call");
    const c = colsFor(["1", "2"]).find((x) => x.id === "s-act")!;
    expect(c).toMatchObject({ band: "registered", kind: "step", ownerId: "1" });
  });

  it("with none, the columns are exactly what they were", () => {
    const none = colsFor(
      ["1", "2"],
      STEPS.filter((s) => s.band !== "registered"),
    );
    expect(none.map((c) => c.id)).toEqual([
      "not_contacted",
      "contact",
      "first_meeting",
      "first_plan",
      "s-info",
      "registered",
      "referral_source",
      "not_interested",
      "do_not_contact",
    ]);
    expect(colsFor(["1"], []).map((c) => c.id)).toEqual([
      "not_contacted",
      "contact",
      "first_meeting",
      "first_plan",
      "registered",
      "referral_source",
      "not_interested",
      "do_not_contact",
    ]);
  });

  it("a hidden one is left out, and a hide by an upline wins", () => {
    const hide: StepHide = { personId: "1", stepId: "s-90", createdAt: "2026-11-05T00:00:00.000Z" };
    expect(colsFor(["1", "2"], STEPS, [hide]).map((c) => c.id)).not.toContain("s-90");
    const rows = chainSteps(["1", "2"], STEPS, [hide], "registered");
    expect(rows.map((r) => [r.step.id, r.own, r.hiddenBy])).toEqual([
      ["s-act", false, null],
      ["s-90", false, "1"],
      ["s-call", true, null],
    ]);
  });

  it("the customer board gets nothing: a step in that band is not one of its columns", () => {
    const cols = columnsFor(["1", "2"], STEPS, [], CUSTOMER_BOARD as never);
    expect(cols.map((c) => c.id)).not.toContain("s-act");
    expect(cols.map((c) => c.id)).not.toContain("s-call");
  });

  it("bandOf finds the band of a step after Registered", () => {
    expect(bandOf("s-act", STEPS)).toBe("registered");
    expect(bandOf("s-info", STEPS)).toBe("first_plan");
  });
});

describe("afterRegistered: who is on the board", () => {
  it("a board with no step after Registered has nobody after it", () => {
    const people = [reg("a", "2026-11-10"), reg("b", "2026-01-01", "ibo")];
    const r = afterRegistered(input({ columns: colsFor(["1", "2"], []), people }));
    expect(r.enabled).toBe(false);
    expect(r.cutoff).toBeNull();
    expect(r.columns).toEqual([]);
    expect(r.inProgress.size).toBe(0);
  });

  it("the cutoff is the 1st of the month, in the team's zone, of the earliest step on the board", () => {
    const r = afterRegistered(input());
    expect(r.enabled).toBe(true);
    expect(r.cutoff).toBe("2026-11-01");
    const early = (createdAt: string) => [
      step("s-x", "2", 0, createdAt),
      step("s-y", "2", 1, "2026-11-10T00:00:00.000Z"),
    ];
    // 2026-10-31T19:00Z is 2026-11-01 00:30 in Kolkata: this month. 18:00Z is 23:30 on Oct 31: last month.
    for (const [at, cutoff] of [
      ["2026-10-31T19:00:00.000Z", "2026-11-01"],
      ["2026-10-31T18:00:00.000Z", "2026-10-01"],
      ["2026-11-30T18:29:00.000Z", "2026-11-01"],
    ] as const) {
      const steps = early(at);
      expect(afterRegistered(input({ steps, columns: colsFor(["2"], steps) })).cutoff).toBe(cutoff);
    }
  });

  it("only the earliest step counts, whichever owner it belongs to", () => {
    const steps = [
      step("s-late", "1", 0, "2026-11-12T00:00:00.000Z"),
      step("s-early", "2", 0, "2026-09-05T00:00:00.000Z"),
    ];
    expect(afterRegistered(input({ steps, columns: colsFor(["1", "2"], steps) })).cutoff).toBe(
      "2026-09-01",
    );
    // a step the board doesn't show (another leader's) does not date it
    expect(afterRegistered(input({ steps, columns: colsFor(["1"], steps) })).cutoff).toBe(
      "2026-11-01",
    );
  });

  it("Registered lists people who registered on or after the cutoff, newest first; earlier ones are finished", () => {
    const people = [
      reg("on", "2026-11-01"),
      reg("new", "2026-11-12", "ibo"),
      reg("before", "2026-10-31"),
      reg("old", "2024-03-01"),
      reg("nodate", "", "apprentice"),
      { ...reg("p", "2026-11-10"), bizClass: "prospect" } as CrmPerson,
      { ...reg("c", "2026-11-10"), bizClass: "customer" } as CrmPerson,
    ];
    const r = afterRegistered(input({ people }));
    expect(ids(r, "registered")).toEqual(["new", "on"]);
    expect([...r.inProgress.keys()].sort()).toEqual(["new", "on"]);
    expect(r.columns[0]).toMatchObject({ total: 2, finishing: false });
    expect(r.columns[0].cards[0]).toMatchObject({
      day: "2026-11-12",
      stored: false,
      cardColumn: null,
    });
  });

  it("a stored card in Registered follows the same rule as no card", () => {
    const people = [reg("a", "2026-11-03"), reg("b", "2025-01-01")];
    const cards = [card("a", "registered", THIS_MONTH), card("b", "registered", THIS_MONTH)];
    expect(ids(afterRegistered(input({ people, cards })), "registered")).toEqual(["a"]);
  });

  it("the registration move's day wins over the start date (the team's day)", () => {
    const people = [reg("a", "2026-11-10"), reg("b", "2025-01-01")];
    const moves = [
      { personId: "a", milestone: "registered" as const, movedAt: "2026-10-31T18:00:00.000Z" }, // Oct 31 in Kolkata
      { personId: "a", milestone: "registered" as const, movedAt: "2026-11-09T10:00:00.000Z" }, // a later move into the band
      { personId: "b", milestone: "registered" as const, movedAt: "2026-11-02T10:00:00.000Z" },
      { personId: "b", milestone: "first_plan" as const, movedAt: "2020-01-01T10:00:00.000Z" },
    ];
    const r = afterRegistered(input({ people, moves }));
    expect(ids(r, "registered")).toEqual(["b"]);
    expect(r.columns[0].cards[0].registeredDay).toBe("2026-11-02");
  });

  it("a card in a step is in progress however long ago they registered; taken off the board, it is gone", () => {
    const people = [reg("a", "2019-05-01", "ibo"), reg("b", "2019-05-01"), reg("c", "2019-05-01")];
    const cards = [
      card("a", "s-act", LAST_MONTH),
      card("b", "s-call", THIS_MONTH, "2026-11-06T00:00:00.000Z"),
      card("c", "s-90", THIS_MONTH),
    ];
    const r = afterRegistered(input({ people, cards }));
    expect(ids(r, "s-act")).toEqual(["a"]);
    expect(ids(r, "s-90")).toEqual(["c"]);
    expect(r.inProgress.has("b")).toBe(false);
  });

  it("the last column is the finishing column: this month's cards are listed, older ones counted and finished", () => {
    const people = [
      reg("a", "2019-01-01"),
      reg("b", "2019-01-01"),
      reg("c", "2019-01-01"),
      reg("d", "2019-01-01"),
    ];
    const cards = [
      card("a", "s-call", THIS_MONTH),
      card("b", "s-call", LAST_MONTH),
      card("c", "s-call", "2026-10-31T18:00:00.000Z"), // Oct 31 23:30 in Kolkata: last month
      card("d", "s-90", LAST_MONTH), // not the finishing column
    ];
    const r = afterRegistered(input({ people, cards }));
    const fin = r.columns.find((c) => c.finishing)!;
    expect(fin.column.id).toBe("s-call");
    expect(fin.cards.map((c) => c.personId)).toEqual(["a"]);
    expect(fin.total).toBe(3);
    expect([...r.finished].sort()).toEqual(["b", "c"]);
    expect(ids(r, "s-90")).toEqual(["d"]);
    expect(r.columns.find((c) => c.column.id === "s-90")!.total).toBe(1);
    expect(r.inProgress.has("b")).toBe(false);
    // the first moment of the month counts as this month
    const edge = afterRegistered(
      input({ people: [people[0]], cards: [card("a", "s-call", "2026-10-31T18:30:00.000Z")] }),
    );
    expect(edge.columns.find((c) => c.finishing)!.cards).toHaveLength(1);
  });

  it("with one step, that step is the finishing column and Registered is not", () => {
    const steps = [step("only", "1", 0, "2026-11-02T10:00:00.000Z")];
    const r = afterRegistered(
      input({
        steps,
        columns: colsFor(["1"], steps),
        people: [reg("a", "2020-01-01")],
        cards: [card("a", "only", LAST_MONTH)],
      }),
    );
    expect(r.columns.map((c) => [c.column.id, c.finishing])).toEqual([
      ["registered", false],
      ["only", true],
    ]);
    expect(r.finished.has("a")).toBe(true);
    expect(r.columns[1]).toMatchObject({ total: 1, cards: [] });
  });

  it("a card whose step was deleted or is hidden falls back to Registered, and the cutoff applies", () => {
    const people = [reg("new", "2026-11-08"), reg("old", "2022-01-01")];
    const cards = [card("new", "s-gone", THIS_MONTH), card("old", "s-gone", THIS_MONTH)];
    const r = afterRegistered(input({ people, cards }));
    expect(ids(r, "registered")).toEqual(["new"]);
    expect(r.columns[0].cards[0]).toMatchObject({
      column: "registered",
      cardColumn: "s-gone",
      stored: true,
    });
    // hidden: the board's columns lack it, the card still names it
    const hide: StepHide = { personId: "2", stepId: "s-90", createdAt: THIS_MONTH };
    const hidden = afterRegistered(
      input({
        columns: colsFor(["1", "2"], STEPS, [hide]),
        people,
        cards: [card("old", "s-90", THIS_MONTH), card("new", "s-90", THIS_MONTH)],
      }),
    );
    expect(ids(hidden, "registered")).toEqual(["new"]);
    expect(hidden.inProgress.get("old")).toBeUndefined();
  });

  it("someone else's step (not on this board) falls back the same way", () => {
    const people = [reg("a", "2026-11-08")];
    const r = afterRegistered(
      input({ columns: colsFor(["1"]), people, cards: [card("a", "s-call", THIS_MONTH)] }),
    );
    expect(r.inProgress.get("a")).toBe("registered");
  });
});

describe("registeredInProgressIds: each person on their sponsor's board", () => {
  const maria = { id: "1", bizClass: "ibo", sponsorId: null } as CrmPerson;
  const anita = { id: "2", bizClass: "ibo", sponsorId: "1" } as CrmPerson;
  const state = (over: Partial<InProgressState> = {}): InProgressState => ({
    people: [
      maria,
      anita,
      reg("a", "2026-11-09"),
      reg("b", "2025-01-01"),
      reg("m", "2026-11-09", "apprentice", "1"),
    ],
    steps: STEPS,
    hides: [],
    cards: [],
    moves: [],
    uplines: [],
    def: RECRUITING_BOARD,
    timeZone: TZ,
    now: NOW,
    ...over,
  });
  it("is empty when no team has a step after Registered", () => {
    const s = state({ steps: STEPS.filter((x) => x.band !== "registered") });
    expect(registeredInProgressIds(s.people, s).size).toBe(0);
  });
  it("applies the rule per sponsor", () => {
    const s = state();
    expect([...registeredInProgressIds(s.people, s)].sort()).toEqual(["a", "m"]);
    expect([...registeredInProgressIds([s.people[3]], s)]).toEqual([]);
  });
  it("a hide by the sponsor's chain changes which step a card is in", () => {
    const hide: StepHide = { personId: "2", stepId: "s-act", createdAt: THIS_MONTH };
    const s = state({ hides: [hide], cards: [card("b", "s-act", THIS_MONTH)] });
    expect(registeredInProgressIds([s.people[3]], s).size).toBe(0);
    expect(registeredInProgressIds([s.people[3]], { ...s, hides: [] }).has("b")).toBe(true);
  });
});

describe("zonedDay", () => {
  it("is the calendar day in the zone", () => {
    expect(zonedDay("2026-10-31T18:00:00.000Z", "Asia/Kolkata")).toBe("2026-10-31");
    expect(zonedDay("2026-10-31T18:30:00.000Z", "Asia/Kolkata")).toBe("2026-11-01");
    expect(zonedDay("2026-10-31T18:30:00.000Z", "UTC")).toBe("2026-10-31");
  });
});

describe("moving a card: a prospect's and a registered person's", () => {
  const cols = colsFor(["1", "2"]);
  it("a registered person moves only between Registered and the steps after it", () => {
    const stored = card("a", "s-act", THIS_MONTH);
    expect(validateRegisteredMove(undefined, "s-act", cols)).toMatchObject({ ok: true });
    expect(validateRegisteredMove(stored, "registered", cols)).toMatchObject({ ok: true }); // backwards
    expect(validateRegisteredMove(stored, "s-call", cols)).toMatchObject({ ok: true });
    expect(validateRegisteredMove(stored, "s-act", cols)).toEqual({
      ok: false,
      reason: "same-column",
    });
    expect(validateRegisteredMove(undefined, "registered", cols)).toEqual({
      ok: false,
      reason: "same-column",
    });
    expect(validateRegisteredMove(card("a", "s-gone", THIS_MONTH), "registered", cols)).toEqual({
      ok: false,
      reason: "same-column",
    });
    for (const to of [
      "not_contacted",
      "contact",
      "first_meeting",
      "first_plan",
      "s-info",
      "referral_source",
      "not_interested",
      "do_not_contact",
    ])
      expect(validateRegisteredMove(stored, to, cols)).toEqual({
        ok: false,
        reason: "after-registered-only",
      });
    expect(validateRegisteredMove(stored, "s-nowhere", cols)).toEqual({
      ok: false,
      reason: "unknown-column",
    });
    expect(
      validateRegisteredMove(
        card("a", "s-act", THIS_MONTH, "2026-11-06T00:00:00.000Z"),
        "registered",
        cols,
      ),
    ).toEqual({ ok: false, reason: "not-on-board" });
  });
  it("a prospect cannot go to a step after Registered, but registers by moving into Registered", () => {
    const prospect = card("p", "first_plan", THIS_MONTH);
    expect(validateProspectMove(prospect, "s-act", cols)).toEqual({
      ok: false,
      reason: "registered-only",
    });
    expect(validateProspectMove(prospect, "registered", cols)).toMatchObject({ ok: true });
    expect(validateProspectMove(prospect, "s-info", cols)).toMatchObject({ ok: true });
  });
  it("validateMove (shared with the customer board) is untouched", () => {
    expect(validateMove(card("p", "contact", THIS_MONTH), "s-act", cols)).toMatchObject({
      ok: true,
    });
    expect(validateMove(card("p", "contact", THIS_MONTH), "contact", cols)).toEqual({
      ok: false,
      reason: "same-column",
    });
  });
  it("registeredColumnOf and the implicit card", () => {
    expect(registeredColumnOf(card("a", "s-90", THIS_MONTH), cols)).toBe("s-90");
    expect(registeredColumnOf(card("a", "first_plan", THIS_MONTH), cols)).toBe("registered");
    expect(registeredColumnOf(null, cols)).toBe("registered");
    expect(implicitRegisteredCard(reg("a", "2026-11-09"))).toMatchObject({
      personId: "a",
      column: "registered",
      droppedAt: null,
    });
  });
});
