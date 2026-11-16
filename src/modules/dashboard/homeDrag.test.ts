import { describe, expect, it } from "vitest";
import {
  COLUMN_BIAS,
  HYSTERESIS,
  columnBoxes,
  dropTarget,
  layoutCards,
  type DropColumn,
} from "./homeDrag";

const col = (x: number, w: number, hs: number[], gap = 10): DropColumn => {
  let y = 0;
  return {
    x,
    w,
    items: hs.map((h) => {
      const item = { y, h };
      y += h + gap;
      return item;
    }),
  };
};

describe("home edit layout", () => {
  it("uses Home's column widths on desktop and one full column on phones", () => {
    expect(columnBoxes({ width: 1000, gap: 16, desktop: true })).toEqual([
      { x: 0, w: 606 },
      { x: 622, w: 378 },
    ]);
    expect(columnBoxes({ width: 358, gap: 12, desktop: false })).toEqual([{ x: 0, w: 358 }]);
  });

  it("stacks each column from the card heights", () => {
    const { pos, height } = layoutCards(
      [["a", "b"], ["c"]],
      { a: 100, b: 50, c: 300 },
      { width: 1000, gap: 10, desktop: true },
    );
    expect(pos.a).toMatchObject({ x: 0, y: 0, h: 100 });
    expect(pos.b).toMatchObject({ x: 0, y: 110, h: 50 });
    expect(pos.c).toMatchObject({ y: 0, h: 300 });
    expect(pos.c.x).toBeGreaterThan(pos.a.w);
    expect(height).toBe(300);
  });

  it("measures a card that has no height yet as a stand-in, and an empty column as nothing", () => {
    const { pos, height } = layoutCards([["a"], []], {}, { width: 600, gap: 10, desktop: true });
    expect(pos.a.h).toBeGreaterThan(0);
    expect(height).toBe(pos.a.h);
    expect(layoutCards([[], []], {}, { width: 600, gap: 10, desktop: true }).height).toBe(0);
  });
});

describe("drop target", () => {
  // Three cards (100 tall, 10 apart): middles at 50, 160, 270.
  const one = [col(0, 300, [100, 100, 100])];

  it("goes before the first card whose middle is below the pointer", () => {
    expect(dropTarget({ x: 10, y: 20 }, one, null)).toEqual({ column: 0, index: 0 });
    expect(dropTarget({ x: 10, y: 100 }, one, null)).toEqual({ column: 0, index: 1 });
    expect(dropTarget({ x: 10, y: 200 }, one, null)).toEqual({ column: 0, index: 2 });
    expect(dropTarget({ x: 10, y: 900 }, one, null)).toEqual({ column: 0, index: 3 });
  });

  it("has no hysteresis without a current place", () => {
    expect(dropTarget({ x: 0, y: 160 + 1 }, one, null).index).toBe(2);
    expect(dropTarget({ x: 0, y: 160 - 1 }, one, null).index).toBe(1);
  });

  it("holds the current place while the pointer sits on a boundary", () => {
    // Placeholder between the first and second card (index 1).
    const here = { column: 0, index: 1 };
    // The card below it (middle 160): staying until the pointer is HYSTERESIS past it.
    expect(dropTarget({ x: 0, y: 160 + HYSTERESIS - 1 }, one, here).index).toBe(1);
    expect(dropTarget({ x: 0, y: 160 + HYSTERESIS + 1 }, one, here).index).toBe(2);
    // The card above it (middle 50): staying until the pointer is HYSTERESIS above it.
    expect(dropTarget({ x: 0, y: 50 - HYSTERESIS + 1 }, one, here).index).toBe(1);
    expect(dropTarget({ x: 0, y: 50 - HYSTERESIS - 1 }, one, here).index).toBe(0);
  });

  it("does not flip back and forth on a boundary as the pointer jitters", () => {
    let place = { column: 0, index: 0 };
    const seen: number[] = [];
    // Wiggle around the first card's middle (50), moving down: the place changes at most once.
    for (const y of [40, 52, 48, 54, 46, 70, 58, 66, 60]) {
      place = dropTarget({ x: 0, y }, one, place);
      seen.push(place.index);
    }
    expect(seen.at(-1)).toBe(1);
    const changes = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(1);
  });

  it("picks the column under the pointer, and the nearest one between them", () => {
    const two = [col(0, 600, [100, 100]), col(616, 380, [100])];
    expect(dropTarget({ x: 100, y: 10 }, two, null).column).toBe(0);
    expect(dropTarget({ x: 800, y: 10 }, two, null)).toEqual({ column: 1, index: 0 });
    expect(dropTarget({ x: 800, y: 70 }, two, null)).toEqual({ column: 1, index: 1 });
    // In the gap: nearer the right one.
    expect(dropTarget({ x: 612 + 12, y: 10 }, two, null).column).toBe(1);
    // Far outside either side.
    expect(dropTarget({ x: -500, y: 10 }, two, null).column).toBe(0);
    expect(dropTarget({ x: 5000, y: 10 }, two, null).column).toBe(1);
  });

  it("keeps the current column until the pointer is clearly nearer the other", () => {
    const two = [col(0, 600, [100, 100]), col(616, 380, [100])];
    const inLeft = { column: 0, index: 1 };
    // Just past the middle of the gap, nearer the right column: still the left (within the bias).
    expect(dropTarget({ x: 609, y: 10 }, two, inLeft).column).toBe(0);
    expect(dropTarget({ x: 616 + COLUMN_BIAS + 20, y: 10 }, two, inLeft).column).toBe(1);
    // And back again.
    const inRight = { column: 1, index: 0 };
    expect(dropTarget({ x: 606, y: 10 }, two, inRight).column).toBe(1);
    expect(dropTarget({ x: 300, y: 10 }, two, inRight).column).toBe(0);
  });

  it("drops into an empty column at its start, whatever the height of the pointer", () => {
    const two = [col(0, 600, [100, 100]), col(616, 380, [])];
    expect(dropTarget({ x: 800, y: 0 }, two, null)).toEqual({ column: 1, index: 0 });
    expect(dropTarget({ x: 800, y: 700 }, two, { column: 0, index: 0 })).toEqual({
      column: 1,
      index: 0,
    });
  });

  it("copes with no columns", () => {
    expect(dropTarget({ x: 0, y: 0 }, [], null)).toEqual({ column: 0, index: 0 });
  });
});
