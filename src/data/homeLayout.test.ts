import { describe, expect, it } from "vitest";
import {
  HOME_CARDS,
  arrangeHome,
  moveHomeCard,
  nudgeHomeCard,
  resolveLayout,
  sameLayout,
  sanitizeLayout,
  type HomeLayout,
} from "./homeLayout";

const ALL = new Set<string>(HOME_CARDS.map((c) => c.id));
/** What a leader sees (no candidate or new-apprentice cards, no library). */
const LEADER = new Set([
  "milestone",
  "learning",
  "event",
  "inbox",
  "today",
  "team",
  "teamLearning",
  "myDay",
]);

describe("home layout", () => {
  it("defaults to the cards' default order and columns", () => {
    const a = arrangeHome(undefined, LEADER);
    expect(a.all).toEqual([
      "milestone",
      "learning",
      "event",
      "inbox",
      "today",
      "team",
      "teamLearning",
      "myDay",
    ]);
    expect(a.main).toEqual(["milestone", "learning", "inbox", "today"]);
    expect(a.side).toEqual(["event", "team", "teamLearning", "myDay"]);
  });

  it("appends cards missing from a saved layout in default order and column, keeps unknown ids", () => {
    const saved: HomeLayout = { order: ["today", "futureCard", "team"], side: ["futureCard"] };
    const { order, side } = resolveLayout(saved);
    expect(order.slice(0, 3)).toEqual(["today", "futureCard", "team"]);
    expect(order.slice(3)).toEqual(
      HOME_CARDS.map((c) => c.id).filter((id) => id !== "today" && id !== "team"),
    );
    // Saved: "team" moved to the left column; appended cards take their default.
    expect(side.has("team")).toBe(false);
    expect(side.has("futureCard")).toBe(true);
    expect(side.has("event")).toBe(true);
    expect(arrangeHome(saved, LEADER).all.slice(0, 2)).toEqual(["today", "team"]);
  });

  it("skips cards the person can't see without losing their place", () => {
    const saved: HomeLayout = { order: ["library", "today", "milestone"], side: [] };
    expect(arrangeHome(saved, LEADER).all.slice(0, 2)).toEqual(["today", "milestone"]);
    // Moving "milestone" first keeps the hidden library card where it was, relative to others.
    const next = moveHomeCard(saved, LEADER, "milestone", { column: null, index: 0 });
    expect(next.order.slice(0, 3)).toEqual(["library", "milestone", "today"]);
    // Once the library unlocks, it shows up again in its saved spot.
    expect(arrangeHome(next, ALL).all.slice(0, 3)).toEqual(["library", "milestone", "today"]);
  });

  it("moves within the phone list without changing desktop columns", () => {
    const next = moveHomeCard(undefined, LEADER, "myDay", { column: null, index: 0 });
    const a = arrangeHome(next, LEADER);
    expect(a.all[0]).toBe("myDay");
    expect(a.side[0]).toBe("myDay");
    expect(a.main).toEqual(["milestone", "learning", "inbox", "today"]);
  });

  it("moves across desktop columns to a place, or to the end", () => {
    const toMain = moveHomeCard(undefined, LEADER, "team", { column: "main", index: 1 });
    expect(arrangeHome(toMain, LEADER).main).toEqual([
      "milestone",
      "team",
      "learning",
      "inbox",
      "today",
    ]);
    const toEnd = moveHomeCard(undefined, LEADER, "today", { column: "side", index: 99 });
    const a = arrangeHome(toEnd, LEADER);
    expect(a.side.at(-1)).toBe("today");
    expect(a.main).not.toContain("today");
    expect(toEnd.side).toContain("today");
  });

  it("moves into an empty column", () => {
    const visible = new Set(["today", "team"]);
    const allLeft = moveHomeCard(undefined, visible, "team", { column: "main", index: 5 });
    expect(arrangeHome(allLeft, visible)).toMatchObject({ main: ["today", "team"], side: [] });
    const back = moveHomeCard(allLeft, visible, "today", { column: "side", index: 0 });
    expect(arrangeHome(back, visible)).toMatchObject({ main: ["team"], side: ["today"] });
  });

  it("nudges up, down and across (keyboard and move buttons)", () => {
    const up = nudgeHomeCard(undefined, LEADER, "today", "up", true)!;
    expect(arrangeHome(up, LEADER).main).toEqual(["milestone", "learning", "today", "inbox"]);
    expect(nudgeHomeCard(undefined, LEADER, "milestone", "up", true)).toBeNull();
    expect(nudgeHomeCard(undefined, LEADER, "myDay", "down", true)).toBeNull();
    const right = nudgeHomeCard(undefined, LEADER, "learning", "right", true)!;
    expect(arrangeHome(right, LEADER).side).toEqual([
      "event",
      "learning",
      "team",
      "teamLearning",
      "myDay",
    ]);
    expect(nudgeHomeCard(undefined, LEADER, "learning", "left", true)).toBeNull();
    // Phones: one list, no columns.
    expect(nudgeHomeCard(undefined, LEADER, "learning", "right", false)).toBeNull();
    const down = nudgeHomeCard(undefined, LEADER, "inbox", "down", false)!;
    expect(arrangeHome(down, LEADER).all.slice(3, 5)).toEqual(["today", "inbox"]);
  });

  it("reads only well-formed layouts", () => {
    expect(sanitizeLayout(null)).toBeNull();
    expect(sanitizeLayout([])).toBeNull();
    expect(sanitizeLayout({ order: "today" })).toBeNull();
    expect(sanitizeLayout({ order: ["today", "today", 3, "<x>", "team"], side: ["team"] })).toEqual(
      {
        order: ["today", "team"],
        side: ["team"],
      },
    );
    expect(sanitizeLayout({})).toEqual({ order: [], side: [] });
  });

  it("compares layouts by what they show", () => {
    expect(sameLayout(undefined, { order: [], side: [] })).toBe(true);
    const moved = moveHomeCard(undefined, LEADER, "today", { column: null, index: 0 });
    expect(sameLayout(undefined, moved)).toBe(false);
    expect(sameLayout(moved, { ...moved, side: [...moved.side].reverse() })).toBe(true);
  });
});
