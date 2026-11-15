/**
 * Browser-storage data saved before cards had tasks and notes: a card's booked next step and its
 * single note become a task and the first entry of the notes log, once, when the saved data loads
 * (the same rules as the database's `convert_card_followups()`, migration 20261109000100).
 *
 * `convertLegacyCards` is pure. The pipeline stores call it while they load (they own the cards)
 * and hand the result to the card tasks store through `stashLegacy`; the old fields are dropped
 * from the cards, so a second load finds nothing left to convert.
 */
import type { CardBoard, CardNote, CardRef, CardTask } from "./types";

/** What an old card carried. */
export interface LegacyFields {
  nextColumn?: string | null;
  nextStepDate?: string | null;
  nextStepTime?: string | null;
  note?: string | null;
}

const LEGACY_KEYS = ["nextColumn", "nextStepDate", "nextStepTime", "note"] as const;

/** The title of a task made from a booking whose column is no longer on the board. */
export const FALLBACK_TITLE = "Next step";

export interface LegacyConversion<C> {
  /** The cards without the old fields. */
  cards: C[];
  tasks: CardTask[];
  notes: CardNote[];
  /** Any card still had the old shape (it was saved before tasks and notes). */
  found: boolean;
}

/**
 * Convert saved cards. `idOf` is the card's own id (the prospect's id, or the list entry's id),
 * `ownerOf` its owner (the assignee and the note's author), `labelOf` the display name of a column
 * on the owner's board (null when the column is gone: the title is then "Next step").
 *
 *  - A booked column makes one open task titled with the column's name, due on the booked day (and
 *    time); a booking with a column and no day makes a task with no due date.
 *  - A non-empty note makes one note by the owner, written when the card last changed.
 *  - Nothing is made twice: a task or note with the same content already on the card is kept as the
 *    only one (`existing`).
 */
export function convertLegacyCards<C extends object>(
  board: CardBoard,
  cards: readonly C[],
  idOf: (card: C) => string,
  ctx: {
    ownerOf: (cardId: string) => string | null;
    labelOf: (cardId: string, columnId: string) => string | null;
    existing?: { tasks: readonly CardTask[]; notes: readonly CardNote[] };
    now?: string;
  },
): LegacyConversion<C> {
  const tasks: CardTask[] = [];
  const notes: CardNote[] = [];
  let found = false;
  const out = cards.map((card) => {
    const old = card as C & LegacyFields & { updatedAt?: string };
    if (!LEGACY_KEYS.some((k) => k in old)) return card;
    found = true;
    const id = idOf(card);
    const ref: CardRef = { board, id };
    const owner = ctx.ownerOf(id);
    const at = old.updatedAt ?? ctx.now ?? new Date().toISOString();
    const own = {
      personId: board === "recruiting" ? id : null,
      entryId: board === "customer" ? id : null,
    };
    const col = old.nextColumn?.trim();
    if (col) {
      const title = ctx.labelOf(id, col) ?? FALLBACK_TITLE;
      const date = old.nextStepDate || null;
      const time = date ? old.nextStepTime || null : null;
      const dup = (ctx.existing?.tasks ?? []).some(
        (t) =>
          (board === "recruiting" ? t.personId === id : t.entryId === id) &&
          t.title === title &&
          t.dueDate === date &&
          t.dueTime === time,
      );
      if (!dup)
        tasks.push({
          id: `legacy-task:${ref.board}:${id}`,
          ...own,
          title,
          done: false,
          doneAt: null,
          doneBy: null,
          dueDate: date,
          dueTime: time,
          assigneeId: owner,
          position: 0,
          createdBy: null,
          createdAt: at,
          updatedAt: at,
        });
    }
    const body = old.note?.trim();
    if (body) {
      const dup = (ctx.existing?.notes ?? []).some(
        (n) => (board === "recruiting" ? n.personId === id : n.entryId === id) && n.body === body,
      );
      if (!dup)
        notes.push({
          id: `legacy-note:${ref.board}:${id}`,
          ...own,
          authorId: owner,
          body,
          createdAt: at,
        });
    }
    const rest = { ...old } as Record<string, unknown>;
    for (const k of LEGACY_KEYS) delete rest[k];
    return rest as C;
  });
  return { cards: out, tasks, notes, found };
}

// ---------------------------------------------------------------------------
// The hand-over from the pipeline stores to the card tasks store
// ---------------------------------------------------------------------------

const pending: { found: boolean; tasks: CardTask[]; notes: CardNote[] } = {
  found: false,
  tasks: [],
  notes: [],
};

/** Called by a pipeline store when it converted saved cards. */
export function stashLegacy(c: { found: boolean; tasks: CardTask[]; notes: CardNote[] }): void {
  pending.found ||= c.found;
  pending.tasks.push(...c.tasks);
  pending.notes.push(...c.notes);
}

/** Whether saved cards of the old shape were found (without taking what they made). */
export const legacyFound = (): boolean => pending.found;

/** What the stores' load made, handed over once. */
export function takeLegacy(): { found: boolean; tasks: CardTask[]; notes: CardNote[] } {
  const out = { found: pending.found, tasks: [...pending.tasks], notes: [...pending.notes] };
  pending.found = false;
  pending.tasks = [];
  pending.notes = [];
  return out;
}
