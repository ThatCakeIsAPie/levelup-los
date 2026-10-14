import { describe, expect, it } from "vitest";
import type { BoardCard, PipelineBoard } from "@/data";
import { inPipeline, ownCards } from "./format";

const card = (personId: string, ownerId: string) => ({ personId, ownerId }) as BoardCard;
const board = (owners: string[], registeredOwners: string[] = []) =>
  ({
    columns: [],
    bands: [
      {
        milestone: "contact",
        count: owners.length,
        columns: [{ cards: owners.map((o, i) => card(`p${i}`, o)) }],
      },
    ],
    registered: {
      cards: registeredOwners.map((o, i) => ({ personId: `r${i}`, ownerId: o })),
      total: registeredOwners.length,
    },
    inProgress: owners.length,
  }) as unknown as PipelineBoard<string>;

describe("ownCards", () => {
  it("counts your cards in progress and marks a mixed board", () => {
    expect(ownCards(board(["1", "2", "1", "3"]), "1")).toEqual({ mine: 2, mixed: true });
  });

  it("does not mark a board that is all yours or has none of yours", () => {
    expect(ownCards(board(["1", "1"]), "1")).toEqual({ mine: 2, mixed: false });
    expect(ownCards(board(["2", "3"]), "1")).toEqual({ mine: 0, mixed: false });
  });

  it("counts this month's registrations towards mixed, not towards in progress", () => {
    expect(ownCards(board(["2"], ["1"]), "1")).toEqual({ mine: 0, mixed: true });
  });
});

describe("inPipeline", () => {
  const b = {
    bands: [
      { milestone: "contact", columns: [{ cards: [card("a", "1"), card("b", "2")] }] },
      {
        milestone: "first_meeting",
        columns: [{ cards: [card("c", "1")] }, { cards: [card("d", "2"), card("e", "2")] }],
      },
      { milestone: "first_plan", columns: [{ cards: [card("f", "1")] }] },
      { milestone: "out", columns: [{ cards: [card("g", "1")] }] },
    ],
    registered: { cards: [], total: 0 },
  } as unknown as PipelineBoard<string>;

  it("counts only the given bands, steps included", () => {
    expect(inPipeline(b, ["first_meeting", "first_plan"], "1")).toEqual({
      total: 4,
      byBand: [
        { band: "first_meeting", count: 3 },
        { band: "first_plan", count: 1 },
      ],
      mine: 2,
      mixed: true,
    });
  });

  it("does not mark a board with only one owner", () => {
    expect(inPipeline(b, ["first_plan"], "1")).toMatchObject({ total: 1, mine: 1, mixed: false });
    expect(inPipeline(b, ["first_plan"], null)).toMatchObject({ mine: 0, mixed: false });
  });
});
