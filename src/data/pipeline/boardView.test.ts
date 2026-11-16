import { describe, expect, it } from "vitest";
import { afterRegistered, type AfterRegisteredInput } from "./afterRegistered";
import {
  canDropOn,
  isAfterRegisteredStep,
  moveChoices,
  registeredBandCount,
  registeredColumnViews,
  registeredProfile,
} from "./boardView";
import { columnsFor } from "./rules";
import { RECRUITING_BOARD, type PipelineCard, type PipelineStep } from "./types";
import type { CrmPerson } from "@/stores/peopleStore";

const TZ = "Asia/Kolkata";
const TODAY = "2026-11-16";
const THIS_MONTH = "2026-11-05T10:00:00.000Z";
const LAST_MONTH = "2026-10-20T10:00:00.000Z";

const step = (id: string, position: number, band = "registered") =>
  ({
    id,
    ownerId: "1",
    band,
    label: id.toUpperCase(),
    position,
    createdAt: "2026-11-02T10:00:00.000Z",
  }) as PipelineStep;
const card = (personId: string, column: string, enteredAt: string): PipelineCard => ({
  personId,
  column,
  enteredAt,
  rating: null,
  source: null,
  droppedAt: null,
  updatedAt: enteredAt,
});
const reg = (id: string, businessStartDate: string) =>
  ({
    id,
    bizClass: "apprentice",
    businessStartDate,
    sponsorId: "1",
    lastUpdatedAt: undefined,
  }) as CrmPerson;

const STEPS = [step("s-act", 0), step("s-core", 1)];
const columns = columnsFor(["1"], STEPS, [], RECRUITING_BOARD);
const run = (over: Partial<AfterRegisteredInput> = {}) =>
  afterRegistered({
    columns,
    steps: STEPS,
    people: [],
    cards: [],
    moves: [],
    today: TODAY,
    timeZone: TZ,
    ...over,
  });
const col = (id: string) => columns.find((c) => c.id === id)!;

describe("which columns take which card", () => {
  it("a registered card goes only to Registered and the steps after it", () => {
    const ok = columns.filter((c) => canDropOn("registered", c)).map((c) => c.id);
    expect(ok).toEqual(["registered", "s-act", "s-core"]);
    // every other column of the board is refused: the three stages and their steps, the start and outcome columns
    expect(columns.length).toBeGreaterThan(ok.length);
    for (const c of columns.filter((x) => !ok.includes(x.id)))
      expect(canDropOn("registered", c)).toBe(false);
  });

  it("a prospect's card goes everywhere it could before, Registered included, but not to a step after it", () => {
    const refused = columns.filter((c) => !canDropOn("prospect", c)).map((c) => c.id);
    expect(refused).toEqual(["s-act", "s-core"]);
    expect(canDropOn("prospect", col("registered"))).toBe(true);
    expect(canDropOn("prospect", col("first_plan"))).toBe(true);
    expect(canDropOn("prospect", col("not_interested"))).toBe(true);
  });

  it("a board with no step after Registered refuses a prospect nothing", () => {
    const plain = columnsFor(["1"], [], [], RECRUITING_BOARD);
    expect(plain.every((c) => canDropOn("prospect", c))).toBe(true);
    expect(plain.some((c) => isAfterRegisteredStep(c))).toBe(false);
  });

  it("a step of another band is not a step after Registered", () => {
    const cols = columnsFor(["1"], [step("s-info", 0, "first_plan")], [], RECRUITING_BOARD);
    expect(cols.filter((c) => isAfterRegisteredStep(c))).toEqual([]);
    expect(cols.every((c) => canDropOn("prospect", c))).toBe(true);
  });
});

describe("the profile's Move to… choices", () => {
  it("a registered person: Registered and the steps after it, in board order", () => {
    expect(moveChoices("registered", columns).map((c) => c.id)).toEqual([
      "registered",
      "s-act",
      "s-core",
    ]);
  });
  it("a prospect: every column but the steps after Registered", () => {
    const ids = moveChoices("prospect", columns).map((c) => c.id);
    expect(ids).toContain("registered");
    expect(ids).toContain("contact");
    expect(ids).not.toContain("s-act");
    expect(ids).not.toContain("s-core");
    expect(ids).toHaveLength(columns.length - 2);
  });
});

describe("the column counts and the finishing column", () => {
  const people = [
    reg("a", "2026-11-03"), // registered this month, no card: in Registered
    reg("b", "2026-11-04"), // card in Activated
    reg("c", "2026-11-05"), // card in Core since this month: listed
    reg("d", "2026-11-05"), // card in Core since last month: earlier
    reg("e", "2026-11-05"), // card in Core since last month: earlier
    reg("f", "2026-09-01"), // registered before the cutoff, no card: finished, not on the board
  ];
  const cards = [
    card("b", "s-act", THIS_MONTH),
    card("c", "s-core", THIS_MONTH),
    card("d", "s-core", LAST_MONTH),
    card("e", "s-core", LAST_MONTH),
  ];
  const views = registeredColumnViews(run({ people, cards }));

  it("each column counts the cards shown; the finishing column counts this month's and keeps the earlier ones apart", () => {
    expect(views.map((v) => [v.column.id, v.shown, v.earlier])).toEqual([
      ["registered", 1, null],
      ["s-act", 1, null],
      ["s-core", 1, 2],
    ]);
    expect(views.map((v) => v.cards.map((c) => c.personId))).toEqual([["a"], ["b"], ["c"]]);
  });

  it("the band counts the cards listed, not the earlier ones", () => {
    expect(registeredBandCount(views)).toBe(3);
  });

  it("nothing here when no step after Registered exists", () => {
    const none = afterRegistered({
      columns: columnsFor(["1"], [], [], RECRUITING_BOARD),
      steps: [],
      people,
      cards,
      moves: [],
      today: TODAY,
      timeZone: TZ,
    });
    expect(registeredColumnViews(none)).toEqual([]);
    expect(registeredBandCount([])).toBe(0);
  });
});

describe("where the profile finds a registered person", () => {
  const people = [reg("a", "2026-11-03"), reg("c", "2026-11-05"), reg("d", "2026-11-05")];
  const ar = run({
    people,
    cards: [card("c", "s-core", THIS_MONTH), card("d", "s-core", LAST_MONTH)],
  });
  it("in progress: the column, and whether it is the finishing one", () => {
    expect(registeredProfile(ar, "a")).toMatchObject({
      column: { id: "registered" },
      finishing: false,
    });
    expect(registeredProfile(ar, "c")).toMatchObject({ column: { id: "s-core" }, finishing: true });
  });
  it("finished or not on the board: nothing (the profile is as it was)", () => {
    expect(registeredProfile(ar, "d")).toBeNull();
    expect(registeredProfile(ar, "zz")).toBeNull();
    expect(registeredProfile(run({ people: [] }), "a")).toBeNull();
  });
});
