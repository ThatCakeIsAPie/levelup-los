import { describe, expect, it } from "vitest";
import {
  HOME_CARDS,
  NEIGHBOUR_PLACED,
  arrangeHome,
  hiddenCards,
  hideHomeCard,
  moveHomeCard,
  nudgeHomeCard,
  resolveLayout,
  sameLayout,
  sanitizeLayout,
  showHomeCard,
  shownCards,
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
    // The week ahead is not appended: it goes directly after Today, its default neighbour.
    expect(order.slice(0, 4)).toEqual(["today", "week", "futureCard", "team"]);
    expect(order.slice(4)).toEqual(
      HOME_CARDS.map((c) => c.id).filter((id) => !["today", "week", "team"].includes(id)),
    );
    // Saved: "team" moved to the left column; appended cards take their default.
    expect(side.has("team")).toBe(false);
    expect(side.has("futureCard")).toBe(true);
    expect(side.has("event")).toBe(true);
    expect(arrangeHome(saved, LEADER).all.slice(0, 2)).toEqual(["today", "team"]);
    expect(arrangeHome(saved, new Set([...LEADER, "week"])).all.slice(0, 3)).toEqual([
      "today",
      "week",
      "team",
    ]);
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

describe("hiding cards", () => {
  const ids = HOME_CARDS.map((c) => c.id as string);
  /** What Home shows for a person who can see `visible`. */
  const home = (saved: HomeLayout | null | undefined, visible: ReadonlySet<string>) =>
    arrangeHome(saved, shownCards(saved, visible));

  it("loads a layout saved before hiding existed unchanged, with nothing hidden", () => {
    const old = { order: ["today", "team"], side: ["team"] };
    const read = sanitizeLayout(old);
    expect(read).toStrictEqual(old);
    expect(read).not.toHaveProperty("hidden");
    expect([...shownCards(read, ALL)]).toHaveLength(ALL.size);
    expect(hiddenCards(read, ALL)).toEqual([]);
    expect(resolveLayout(read).hidden.size).toBe(0);
    expect(home(read, LEADER)).toEqual(arrangeHome(old, LEADER));
  });

  it("reads the hidden list, dropping what is not a card id and keeping ids it doesn't know", () => {
    expect(sanitizeLayout({ order: ["today"], side: [], hidden: ["team", "futureCard"] })).toEqual({
      order: ["today"],
      side: [],
      hidden: ["team", "futureCard"],
    });
    expect(
      sanitizeLayout({ hidden: ["team", "team", 3, null, "<x>", "1abc", "inbox", { a: 1 }] }),
    ).toEqual({ order: [], side: [], hidden: ["team", "inbox"] });
    // Too many ids: cut at the database's limit.
    const many = Array.from({ length: 80 }, (_, i) => `card${i}`);
    expect(sanitizeLayout({ hidden: many })?.hidden).toHaveLength(50);
  });

  it("ignores a hidden that is not a list, and an empty one, rather than dropping the layout", () => {
    for (const bad of ["today", 4, { today: true }, null, true]) {
      const read = sanitizeLayout({ order: ["today"], side: [], hidden: bad });
      expect(read).toStrictEqual({ order: ["today"], side: [] });
    }
    expect(sanitizeLayout({ order: ["today"], hidden: [] })).toStrictEqual({
      order: ["today"],
      side: [],
    });
    // A bad order still drops the whole layout.
    expect(sanitizeLayout({ order: "today", hidden: ["team"] })).toBeNull();
  });

  it("hides a card: it leaves Home and keeps its place in the saved order and column", () => {
    const next = hideHomeCard(undefined, "inbox");
    expect(next.hidden).toEqual(["inbox"]);
    // The full order is saved, the hidden card still in it, at its default place and column.
    const full = resolveLayout(undefined);
    expect(next.order).toEqual(full.order);
    expect(next.order).toContain("inbox");
    expect(next.side).toEqual(full.order.filter((id) => full.side.has(id)));
    const a = home(next, LEADER);
    expect(a.all).not.toContain("inbox");
    expect(a.main).toEqual(["milestone", "learning", "today"]);
    expect(a.side).toEqual(["event", "team", "teamLearning", "myDay"]);
    expect(hiddenCards(next, LEADER)).toEqual(["inbox"]);
    // Hiding twice changes nothing.
    expect(hideHomeCard(next, "inbox")).toEqual(next);
  });

  it("shows it again where it was: same place in the order, same column", () => {
    // The person moved "inbox" to the right-hand column, then hid it.
    const moved = moveHomeCard(undefined, LEADER, "inbox", { column: "side", index: 1 });
    const before = arrangeHome(moved, LEADER);
    const hidden = hideHomeCard(moved, "inbox");
    // Meanwhile other cards move around the hidden one.
    const rearranged = moveHomeCard(hidden, shownCards(hidden, LEADER), "myDay", {
      column: "side",
      index: 0,
    });
    const shownAgain = showHomeCard(rearranged, "inbox");
    expect(shownAgain.hidden).toBeUndefined();
    expect(shownAgain).toStrictEqual({ order: shownAgain.order, side: shownAgain.side });
    const a = home(shownAgain, LEADER);
    expect(a.side).toContain("inbox");
    expect(a.main).not.toContain("inbox");
    // Showing changes neither the order nor the columns: it is exactly where it was kept.
    expect(shownAgain.order).toEqual(rearranged.order);
    expect(shownAgain.side).toEqual(rearranged.side);
    // Straight after hiding (nothing moved): exactly the arrangement from before.
    expect(arrangeHome(showHomeCard(hidden, "inbox"), LEADER)).toEqual(before);
  });

  it("keeps hidden through moves, nudges and the layout comparison", () => {
    const hidden = hideHomeCard(undefined, "inbox");
    const shown = shownCards(hidden, LEADER);
    const moved = moveHomeCard(hidden, shown, "today", { column: "main", index: 0 });
    expect(moved.hidden).toEqual(["inbox"]);
    const nudged = nudgeHomeCard(hidden, shown, "today", "up", true)!;
    expect(nudged.hidden).toEqual(["inbox"]);
    // The hidden card is skipped, not counted: "today" was below "learning" once "inbox" was out of the way.
    expect(arrangeHome(nudged, shown).main).toEqual(["milestone", "today", "learning"]);
    expect(sameLayout(hidden, { ...hidden, hidden: ["inbox"] })).toBe(true);
    expect(sameLayout(hidden, { order: hidden.order, side: hidden.side })).toBe(false);
    expect(sameLayout(undefined, hidden)).toBe(false);
    expect(
      sameLayout(
        { order: [], side: [], hidden: ["a", "b"] },
        { order: [], side: [], hidden: ["b", "a"] },
      ),
    ).toBe(true);
  });

  it("keeps a hidden card the person can't see right now, and hides it when it unlocks", () => {
    // "library" is locked for a leader here; they hid it (an earlier unlock, or another device).
    const saved: HomeLayout = { order: ["library", "today"], side: [], hidden: ["library"] };
    expect(hiddenCards(saved, LEADER)).toEqual([]);
    expect(home(saved, LEADER).all).not.toContain("library");
    const moved = moveHomeCard(saved, shownCards(saved, LEADER), "today", {
      column: null,
      index: 0,
    });
    expect(moved.hidden).toEqual(["library"]);
    expect(moved.order).toContain("library");
    // Once it unlocks it is still hidden, and listed under Hidden.
    expect(hiddenCards(moved, ALL)).toEqual(["library"]);
    expect(home(moved, ALL).all).not.toContain("library");
    // Showing a card the person can't see is harmless.
    expect(showHomeCard(saved, "library").hidden).toBeUndefined();
  });

  it("keeps hidden ids the app doesn't know", () => {
    const saved: HomeLayout = { order: ["today", "futureCard"], side: [], hidden: ["futureCard"] };
    const next = hideHomeCard(saved, "team");
    expect(next.hidden).toEqual(["futureCard", "team"]);
    expect(showHomeCard(next, "team").hidden).toEqual(["futureCard"]);
    expect(
      moveHomeCard(next, shownCards(next, LEADER), "today", { column: null, index: 3 }).hidden,
    ).toEqual(["futureCard", "team"]);
  });

  it("shows a card added to the app later (it is not in hidden), next to its default neighbour", () => {
    const saved: HomeLayout = {
      order: ids.filter((id) => id !== "week"),
      side: ids.filter((id) => HOME_CARDS.find((c) => c.id === id)!.side),
      hidden: ["today"],
    };
    const visible = new Set(ids);
    expect(shownCards(saved, visible).has("week")).toBe(true);
    expect(shownCards(saved, visible).has("today")).toBe(false);
    // "week" sits after "today", which is hidden: it is placed after its neighbour all the same.
    const { order } = resolveLayout(saved);
    expect(order[order.indexOf("today") + 1]).toBe("week");
    expect(home(saved, visible).all).toContain("week");
  });

  it("can hide every card: nothing is shown and all of them are listed, in order", () => {
    let saved: HomeLayout | null = null;
    for (const id of LEADER) saved = hideHomeCard(saved, id);
    expect(shownCards(saved, LEADER).size).toBe(0);
    expect(home(saved, LEADER)).toEqual({ all: [], main: [], side: [] });
    expect(hiddenCards(saved, LEADER)).toEqual(arrangeHome(undefined, LEADER).all);
    // Showing one brings back only that one.
    const back = showHomeCard(saved, "today");
    expect(home(back, LEADER).all).toEqual(["today"]);
    expect(hiddenCards(back, LEADER)).toHaveLength(LEADER.size - 1);
  });

  it("is the default again without a saved layout (what Reset layout leaves)", () => {
    const hidden = hideHomeCard(undefined, "team");
    expect(home(hidden, LEADER).all).not.toContain("team");
    expect(home(undefined, LEADER)).toEqual(arrangeHome(undefined, LEADER));
    expect(home(undefined, LEADER).all).toContain("team");
    expect(hiddenCards(undefined, LEADER)).toEqual([]);
  });
});

/** Home's order and columns as they were resolved before cards could be placed by neighbour. */
function appendOnly(saved: HomeLayout | null | undefined, skip: string) {
  const order = [...(saved?.order ?? [])];
  const has = new Set(order);
  const side = new Set((saved?.side ?? []).filter((id) => has.has(id)));
  for (const c of HOME_CARDS) {
    if (has.has(c.id)) continue;
    order.push(c.id);
    if (c.side) side.add(c.id);
  }
  return { order: order.filter((id) => id !== skip), side: [...side].filter((id) => id !== skip) };
}

describe("cards added later go next to their default neighbour", () => {
  const ids = HOME_CARDS.map((c) => c.id as string);
  const old = ids.filter((id) => id !== "week");
  /** A saved layout from before the card existed. */
  const saved = (order: string[], side: string[] = []): HomeLayout => ({ order, side });

  it("lists only the cards added since the rule, and none of the older ones", () => {
    expect([...NEIGHBOUR_PLACED]).toEqual(["week"]);
    for (const id of NEIGHBOUR_PLACED) expect(ids).toContain(id);
  });

  it("puts the week ahead right after Today in a rearranged layout, moving nothing else", () => {
    const layout = saved(
      ["inbox", "learning", "today", "milestone", "library", "event", "team", "myDay"],
      ["event", "team", "myDay"],
    );
    const r = resolveLayout(layout);
    const at = r.order.indexOf("today");
    expect(r.order[at + 1]).toBe("week");
    expect(r.side.has("week")).toBe(false);
    expect(r.order.slice(0, 3)).toEqual(["inbox", "learning", "today"]);
    // Without it, every card is exactly where it was resolved before.
    expect(r.order.filter((id) => id !== "week")).toEqual(appendOnly(layout, "week").order);
    expect([...r.side].filter((id) => id !== "week").sort()).toEqual(
      appendOnly(layout, "week").side.sort(),
    );
  });

  it("follows Today into the right-hand column", () => {
    const layout = saved(
      ["milestone", "learning", "event", "today", "inbox", "team"],
      ["today", "event", "team"],
    );
    const r = resolveLayout(layout);
    expect(r.order.slice(0, 6)).toEqual([
      "milestone",
      "learning",
      "event",
      "today",
      "week",
      "inbox",
    ]);
    expect(r.side.has("week")).toBe(true);
    const a = arrangeHome(layout, new Set(ids));
    expect(a.side.slice(0, 3)).toEqual(["event", "today", "week"]);
    expect(a.main).not.toContain("week");
  });

  it("keeps its place next to Today when Today is not shown to this person", () => {
    const layout = saved(["milestone", "inbox", "today", "team"]);
    const visible = new Set(ids.filter((id) => id !== "today"));
    expect(arrangeHome(layout, visible).all.slice(0, 3)).toEqual(["milestone", "inbox", "week"]);
    // Today unlocks or is shown again: they are together again.
    expect(arrangeHome(layout, new Set(ids)).all.slice(0, 4)).toEqual([
      "milestone",
      "inbox",
      "today",
      "week",
    ]);
  });

  it("changes nothing for a layout that already has every card", () => {
    const full = saved(
      [
        "myDay",
        "week",
        "milestone",
        "today",
        ...old.filter((id) => !["myDay", "milestone", "today"].includes(id)),
      ],
      ["week", "inbox"],
    );
    const r = resolveLayout(full);
    expect(r.order).toEqual(full.order);
    expect([...r.side].sort()).toEqual([...full.side].sort());
  });

  it("goes after the nearest earlier card the layout has when Today is not in it", () => {
    // Older cards missing from a layout are still appended, so Today (appended) is the neighbour.
    const layout = saved(["team", "myDay"], ["team", "myDay"]);
    const r = resolveLayout(layout);
    expect(r.order.slice(0, 2)).toEqual(["team", "myDay"]);
    expect(r.order[r.order.indexOf("today") + 1]).toBe("week");
    // With a different list of cards: after the nearest earlier card that is there (and in its
    // column), else first (in its own column).
    const cards = [
      { id: "n", side: true },
      { id: "a", side: false },
      { id: "b", side: true },
      { id: "c", side: false },
      { id: "m", side: true },
    ];
    const placed = new Set(["n", "m"]);
    const late = resolveLayout(saved(["c", "a"], []), cards, placed);
    expect(late.order).toEqual(["n", "c", "m", "a", "b"]);
    expect([...late.side].sort()).toEqual(["b", "n"]);
  });

  it("is the same as appending for every older card, whatever the saved layout", () => {
    // Every older id left out of a saved layout in turn, on a shuffled and a reversed layout.
    const rng = (() => {
      let x = 12345;
      return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648;
    })();
    const shuffled = (a: string[]) =>
      a
        .map((v) => [rng(), v] as const)
        .sort((p, q) => p[0] - q[0])
        .map(([, v]) => v);
    const layouts: HomeLayout[] = [];
    for (const missing of ["", ...old]) {
      const base = old.filter((id) => id !== missing);
      for (const order of [base, [...base].reverse(), shuffled(base), shuffled(base)]) {
        layouts.push(
          saved(
            order,
            order.filter(() => rng() < 0.4),
          ),
        );
      }
    }
    layouts.push(saved([]), saved(["futureCard", "today"], ["futureCard"]));
    for (const layout of layouts) {
      const now = resolveLayout(layout);
      const before = appendOnly(layout, "week");
      expect(now.order.filter((id) => id !== "week")).toEqual(before.order);
      expect([...now.side].filter((id) => id !== "week").sort()).toEqual([...before.side].sort());
      expect(now.order[now.order.indexOf("today") + 1]).toBe("week");
      // The saved cards keep their order among themselves.
      expect(now.order.filter((id) => layout.order.includes(id))).toEqual(layout.order);
    }
  });

  it("saves it in place the first time the person moves a card", () => {
    const layout = saved(["milestone", "today", "team"]);
    const next = moveHomeCard(layout, new Set(ids), "team", { column: null, index: 0 });
    expect(next.order.indexOf("week")).toBe(next.order.indexOf("today") + 1);
  });
});
