/**
 * Home's card layout (pure rules; tested in homeLayout.test.ts). People move
 * Home's cards around (drag handles on desktop, "Edit layout" on phones); the
 * layout follows them across devices (table `dashboard_layouts`, one row per
 * person; the demo keeps it in localStorage).
 *
 * A layout is one order for every card (phones show them in this order) plus
 * the cards that sit in the right-hand column on desktop. What's saved is
 * always the full list, hidden cards included, so:
 *  - cards a person can't see right now (unlocks, feature switches, the
 *    candidate's or new apprentice's own cards) are skipped, not lost;
 *  - ids the app doesn't know (a newer version's card) are kept;
 *  - cards missing from a saved layout (added to the app later) are appended
 *    in their default order and column.
 * No saved layout = the default (`HOME_CARDS`).
 */

/** Home's cards, in the default order (`side`: the desktop right-hand column). */
export const HOME_CARDS = [
  { id: "milestone", label: "Next milestone", side: false },
  { id: "learning", label: "Streak and weekly goal", side: false },
  { id: "library", label: "Continue learning", side: false },
  { id: "event", label: "Next event", side: true },
  { id: "inbox", label: "Inbox", side: false },
  { id: "today", label: "Today", side: false },
  { id: "myEvents", label: "Your events", side: true },
  { id: "team", label: "Your team", side: true },
  { id: "teamLearning", label: "Team learning", side: true },
  { id: "path", label: "Your path", side: true },
  { id: "myLearning", label: "Your learning", side: true },
  { id: "myDay", label: "What you did today", side: true },
] as const satisfies readonly { id: string; label: string; side: boolean }[];

export type HomeCardId = (typeof HOME_CARDS)[number]["id"];
export type HomeColumn = "main" | "side";

export const HOME_CARD_LABEL = Object.fromEntries(HOME_CARDS.map((c) => [c.id, c.label])) as Record<
  HomeCardId,
  string
>;

/** As saved: every card in order, and the ones in the desktop right-hand column. */
export interface HomeLayout {
  order: string[];
  side: string[];
}

/** At most this many ids per list (the database checks the same). */
export const MAX_LAYOUT_IDS = 50;
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

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
  return { order: list(r.order), side: list(r.side) };
}

/**
 * The full layout: the saved order (unknown ids kept), then the known cards
 * missing from it in default order; the right-hand column as saved, plus the
 * appended cards' default column.
 */
export function resolveLayout(saved?: HomeLayout | null): { order: string[]; side: Set<string> } {
  const order = [...(saved?.order ?? [])];
  const has = new Set(order);
  const side = new Set((saved?.side ?? []).filter((id) => has.has(id)));
  for (const c of HOME_CARDS) {
    if (has.has(c.id)) continue;
    order.push(c.id);
    if (c.side) side.add(c.id);
  }
  return { order, side };
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
  const { order, side } = resolveLayout(saved);
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
  return { order: rest, side: rest.filter((x) => side.has(x)) };
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

/** Same layout (to skip saving a move that changed nothing). */
export function sameLayout(a: HomeLayout | null | undefined, b: HomeLayout | null | undefined) {
  const x = resolveLayout(a);
  const y = resolveLayout(b);
  return (
    x.order.join() === y.order.join() && [...x.side].sort().join() === [...y.side].sort().join()
  );
}
