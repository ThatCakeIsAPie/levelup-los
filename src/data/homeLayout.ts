/**
 * Home's card layout (pure rules; tested in homeLayout.test.ts). People
 * arrange Home's cards in Home's edit mode (pick a card up and drop it
 * somewhere else, or move it with the arrow keys) and can hide the ones they
 * don't want; the layout follows them across devices (table
 * `dashboard_layouts`, one row per person; the demo keeps it in localStorage).
 *
 * A layout is one order for every card (phones show them in this order), the
 * cards that sit in the right-hand column on desktop, and the cards the
 * person hid. What's saved is always the full list, hidden cards included, so:
 *  - a hidden card keeps its place in the order and its column: showing it
 *    again puts it back where it was;
 *  - cards a person can't see right now (unlocks, feature switches, the
 *    candidate's or new apprentice's own cards) are skipped, not lost;
 *  - ids the app doesn't know (a newer version's card) are kept;
 *  - cards missing from a saved layout (added to the app later) are visible,
 *    and appended in their default order and column, except the ids in
 *    `NEIGHBOUR_PLACED` (cards added from now on): those go directly after
 *    their default neighbour instead, so a person who has rearranged Home
 *    still finds a new card next to the one it belongs with.
 * `hidden` is optional: a layout saved before hiding existed has none and
 * loads unchanged. Hiding only removes a card from Home; it never switches a
 * feature off. No saved layout = the default (`HOME_CARDS`), nothing hidden.
 */

/** Home's cards, in the default order (`side`: the desktop right-hand column). */
export const HOME_CARDS = [
  { id: "milestone", label: "Next milestone", side: false },
  { id: "learning", label: "Streak and weekly goal", side: false },
  { id: "library", label: "Continue learning", side: false },
  { id: "event", label: "Next event", side: true },
  { id: "inbox", label: "Inbox", side: false },
  { id: "today", label: "Today", side: false },
  { id: "week", label: "The week ahead", side: false },
  { id: "myEvents", label: "Your events", side: true },
  { id: "team", label: "Your team", side: true },
  { id: "teamLearning", label: "Team learning", side: true },
  { id: "path", label: "Your path", side: true },
  { id: "myLearning", label: "Your learning", side: true },
  { id: "myDay", label: "What you did today", side: true },
] as const satisfies readonly { id: string; label: string; side: boolean }[];

/**
 * Cards that, when missing from a saved layout, are inserted directly after the
 * nearest card before them in `HOME_CARDS` that the layout has (in that card's
 * column), or first when it has none, instead of at the end. Only ids added to
 * the app after this rule are listed: every older card keeps being appended, so
 * nobody's existing layout changes. Add a new card's id here when you add it.
 */
export const NEIGHBOUR_PLACED: ReadonlySet<string> = new Set(["week"]);

export type HomeCardId = (typeof HOME_CARDS)[number]["id"];
export type HomeColumn = "main" | "side";

export const HOME_CARD_LABEL = Object.fromEntries(HOME_CARDS.map((c) => [c.id, c.label])) as Record<
  HomeCardId,
  string
>;

/**
 * As saved: every card in order, the ones in the desktop right-hand column,
 * and the hidden ones (absent = nothing hidden).
 */
export interface HomeLayout {
  order: string[];
  side: string[];
  hidden?: string[];
}

/** At most this many ids per list (the database checks the same). */
export const MAX_LAYOUT_IDS = 50;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

/** A layout with `hidden` only when something is hidden. */
function withHidden(order: string[], side: string[], hidden: Iterable<string>): HomeLayout {
  const h = [...hidden];
  return h.length ? { order, side, hidden: h } : { order, side };
}

/** A saved layout as the app can use it, or null when it isn't one. */
export function sanitizeLayout(raw: unknown): HomeLayout | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const list = (v: unknown): string[] =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string" && ID.test(x)))].slice(
          0,
          MAX_LAYOUT_IDS,
        )
      : [];
  if (r.order !== undefined && !Array.isArray(r.order)) return null;
  // A `hidden` that isn't a list is ignored (nothing hidden), not a reason to drop the layout.
  return withHidden(list(r.order), list(r.side), list(r.hidden));
}

/**
 * The full layout: the saved order (unknown ids kept), then the known cards
 * missing from it in default order; the right-hand column as saved, plus the
 * appended cards' default column. Cards in `NEIGHBOUR_PLACED` are not appended:
 * each goes directly after the nearest card before it in `HOME_CARDS` that the
 * layout has once the others are appended (and into that card's column), or
 * first (its default column) when none is. No card already in the saved layout
 * moves relative to another. `hidden` is the saved hidden list, as is.
 */
export function resolveLayout(
  saved?: HomeLayout | null,
  cards: readonly { id: string; side: boolean }[] = HOME_CARDS,
  placed: ReadonlySet<string> = NEIGHBOUR_PLACED,
): { order: string[]; side: Set<string>; hidden: Set<string> } {
  const order = [...(saved?.order ?? [])];
  const has = new Set(order);
  const side = new Set((saved?.side ?? []).filter((id) => has.has(id)));
  for (const c of cards) {
    if (has.has(c.id) || placed.has(c.id)) continue;
    order.push(c.id);
    has.add(c.id);
    if (c.side) side.add(c.id);
  }
  cards.forEach((c, i) => {
    if (has.has(c.id)) return;
    const before = cards
      .slice(0, i)
      .reverse()
      .find((b) => has.has(b.id));
    order.splice(before ? order.indexOf(before.id) + 1 : 0, 0, c.id);
    has.add(c.id);
    if (before ? side.has(before.id) : c.side) side.add(c.id);
  });
  return { order, side, hidden: new Set(saved?.hidden ?? []) };
}

export interface HomeArrangement {
  /** Every visible card, in order (phones). */
  all: string[];
  /** Desktop columns. */
  main: string[];
  side: string[];
}

/** The visible cards in order, and split into the two desktop columns. */
export function arrangeHome(
  saved: HomeLayout | null | undefined,
  visible: ReadonlySet<string>,
): HomeArrangement {
  const { order, side } = resolveLayout(saved);
  const all = order.filter((id) => visible.has(id));
  return {
    all,
    main: all.filter((id) => !side.has(id)),
    side: all.filter((id) => side.has(id)),
  };
}

/**
 * The cards Home shows: those the person can see (`visible`) minus the ones
 * they hid. Pass this set, not `visible`, to `arrangeHome`, `moveHomeCard` and
 * `nudgeHomeCard` so hidden cards are skipped and keep their place.
 */
export function shownCards(
  saved: HomeLayout | null | undefined,
  visible: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set(saved?.hidden ?? []);
  return new Set([...visible].filter((id) => !hidden.has(id)));
}

/** The hidden cards this person could see, in saved order (the "Hidden" list). */
export function hiddenCards(
  saved: HomeLayout | null | undefined,
  visible: ReadonlySet<string>,
): string[] {
  const { order, hidden } = resolveLayout(saved);
  return order.filter((id) => hidden.has(id) && visible.has(id));
}

/**
 * Move a card. `column` null moves it within the single list (phones; it
 * keeps its desktop column), else into that desktop column. `index` is its
 * new place among the visible cards of that list or column (without the
 * card itself; past the end = last). Hidden and unknown cards keep their
 * place. Returns the layout to save (the full list).
 */
export function moveHomeCard(
  saved: HomeLayout | null | undefined,
  visible: ReadonlySet<string>,
  id: string,
  to: { column: HomeColumn | null; index: number },
): HomeLayout {
  const { order, side, hidden } = resolveLayout(saved);
  const column = to.column ?? (side.has(id) ? "side" : "main");
  const colOf = (x: string): HomeColumn => (side.has(x) ? "side" : "main");
  const rest = order.filter((x) => x !== id);
  const targets = rest.filter((x) => visible.has(x) && (to.column === null || colOf(x) === column));
  const index = Math.max(0, Math.min(to.index, targets.length));
  let at: number;
  if (index < targets.length) at = rest.indexOf(targets[index]);
  else if (targets.length) at = rest.indexOf(targets[targets.length - 1]) + 1;
  else at = rest.length;
  rest.splice(at, 0, id);
  if (column === "side") side.add(id);
  else side.delete(id);
  return withHidden(
    rest,
    rest.filter((x) => side.has(x)),
    hidden,
  );
}

/**
 * Move a card one step: up or down within its list (`column` null) or its
 * desktop column, or across to the other column (same place, or the end).
 * Returns null when it can't move that way.
 */
export function nudgeHomeCard(
  saved: HomeLayout | null | undefined,
  visible: ReadonlySet<string>,
  id: string,
  dir: "up" | "down" | "left" | "right",
  desktop: boolean,
): HomeLayout | null {
  const arr = arrangeHome(saved, visible);
  const column: HomeColumn = arr.side.includes(id) ? "side" : "main";
  if (dir === "left" || dir === "right") {
    if (!desktop) return null;
    const target: HomeColumn = dir === "left" ? "main" : "side";
    if (target === column) return null;
    const index = arr[column].indexOf(id);
    return moveHomeCard(saved, visible, id, { column: target, index });
  }
  const list = desktop ? arr[column] : arr.all;
  const at = list.indexOf(id);
  const next = at + (dir === "up" ? -1 : 1);
  if (at < 0 || next < 0 || next >= list.length) return null;
  return moveHomeCard(saved, visible, id, { column: desktop ? column : null, index: next });
}

/**
 * Hide a card: it leaves Home but keeps its place in the order and its
 * column. Returns the layout to save (the full list).
 */
export function hideHomeCard(saved: HomeLayout | null | undefined, id: string): HomeLayout {
  const { order, side, hidden } = resolveLayout(saved);
  hidden.add(id);
  return withHidden(
    order,
    order.filter((x) => side.has(x)),
    hidden,
  );
}

/** Show a hidden card again, where it was in the order and column. */
export function showHomeCard(saved: HomeLayout | null | undefined, id: string): HomeLayout {
  const { order, side, hidden } = resolveLayout(saved);
  hidden.delete(id);
  return withHidden(
    order,
    order.filter((x) => side.has(x)),
    hidden,
  );
}

/** Same layout (to skip saving a move that changed nothing). */
export function sameLayout(a: HomeLayout | null | undefined, b: HomeLayout | null | undefined) {
  const x = resolveLayout(a);
  const y = resolveLayout(b);
  const key = (s: Set<string>) => [...s].sort().join();
  return (
    x.order.join() === y.order.join() &&
    key(x.side) === key(y.side) &&
    key(x.hidden) === key(y.hidden)
  );
}
