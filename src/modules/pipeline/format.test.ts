import { describe, expect, it } from "vitest";
import type { BoardCard, PipelineBoard } from "@/data";
import { ownCards } from "./format";

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
