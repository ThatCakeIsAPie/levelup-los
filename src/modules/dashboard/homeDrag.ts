/**
 * The maths behind Home's edit mode (pure; tested in homeDrag.test.ts).
 *
 * Edit mode lays the cards out itself: every card is placed with a transform
 * from the positions computed here, so picking one up and sliding the others
 * aside only changes numbers, and the browser animates the move.
 *
 *  - `layoutCards` stacks the cards of each column (one column on phones, two
 *    on desktop, the same widths as Home itself) from their heights.
 *  - `dropTarget` says where a card held at a point would land: the column
 *    under the pointer and the place among that column's other cards. A card
 *    goes before the first card whose middle is below the pointer; a little
 *    hysteresis keeps the placeholder from flickering between two places while
 *    the pointer sits on a boundary.
 */

export interface Geometry {
  /** Width of the area the cards fill. */
  width: number;
  /** Space between cards, and between the two columns. */
  gap: number;
  /** Two columns (main wider than side, as on Home) rather than one. */
  desktop: boolean;
}

export interface CardBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a card is taken to measure before it has been measured. */
export const FALLBACK_HEIGHT = 180;

/** The columns' left edge and width. */
export function columnBoxes(g: Geometry): { x: number; w: number }[] {
  if (!g.desktop) return [{ x: 0, w: Math.max(0, g.width) }];
  const free = Math.max(0, g.width - g.gap);
  const main = Math.round((free * 1.6) / 2.6);
  return [
    { x: 0, w: main },
    { x: main + g.gap, w: free - main },
  ];
}

/** Every card's box, and the height the stacks need. */
export function layoutCards(
  columns: readonly (readonly string[])[],
  heights: Readonly<Record<string, number | undefined>>,
  g: Geometry,
): { pos: Record<string, CardBox>; height: number } {
  const boxes = columnBoxes(g);
  const pos: Record<string, CardBox> = {};
  let height = 0;
  columns.forEach((ids, k) => {
    const col = boxes[Math.min(k, boxes.length - 1)];
    let y = 0;
    ids.forEach((id, i) => {
      const h = heights[id] ?? FALLBACK_HEIGHT;
      if (i > 0) y += g.gap;
      pos[id] = { x: col.x, y, w: col.w, h };
      y += h;
    });
    height = Math.max(height, y);
  });
  return { pos, height };
}

export interface DropColumn {
  x: number;
  w: number;
  /** The column's cards, the held one left out, as laid out right now. */
  items: readonly { y: number; h: number }[];
}

export interface DropPlace {
  /** Index into the columns passed in. */
  column: number;
  /** Place among the column's other cards (0 = first, items.length = last). */
  index: number;
}

/** Pixels the pointer must pass a card's middle by to change the place. */
export const HYSTERESIS = 8;
/** Pixels closer to the other column the pointer must get to change column. */
export const COLUMN_BIAS = 6;

/**
 * Where the held card would land with the pointer at (`x`, `y`) (in the same
 * coordinates as the columns). `current` is where its placeholder is now: a
 * move across a card's middle only counts once the pointer is `hysteresis`
 * past it, and the column only changes once the pointer is clearly nearer the
 * other one. Without `current` there is no hysteresis.
 */
export function dropTarget(
  point: { x: number; y: number },
  columns: readonly DropColumn[],
  current: DropPlace | null,
  opts: { hysteresis?: number; columnBias?: number } = {},
): DropPlace {
  const hys = opts.hysteresis ?? HYSTERESIS;
  const bias = opts.columnBias ?? COLUMN_BIAS;
  if (!columns.length) return { column: 0, index: 0 };
  const dist = (c: DropColumn) =>
    point.x < c.x ? c.x - point.x : point.x > c.x + c.w ? point.x - (c.x + c.w) : 0;
  let column = 0;
  columns.forEach((c, k) => {
    if (dist(c) < dist(columns[column])) column = k;
  });
  const cur = current && columns[current.column] ? current.column : null;
  if (cur !== null && column !== cur && dist(columns[column]) + bias >= dist(columns[cur])) {
    column = cur;
  }
  const items = columns[column].items;
  const here = current && current.column === column ? current.index : null;
  let index = items.length;
  for (let i = 0; i < items.length; i++) {
    const mid = items[i].y + items[i].h / 2;
    // Cards above the placeholder give way early (pointer above their middle
    // by `hys`), cards below it only once the pointer is past by `hys`.
    const edge = here === null ? mid : i < here ? mid - hys : mid + hys;
    if (point.y < edge) {
      index = i;
      break;
    }
  }
  return { column, index };
}
