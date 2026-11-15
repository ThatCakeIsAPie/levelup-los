/**
 * Tasks and notes on pipeline cards (both boards). A card is a prospect on the
 * recruiting board (`personId`) or a name on the customer board (`entryId`);
 * the rows point at the prospect or the list name, not at the stored card row,
 * exactly as the database tables `card_tasks` and `card_notes` do.
 */

/** Which board a card is on. */
export type CardBoard = "recruiting" | "customer";

/** A card: a prospect's person id, or a list entry's id on the customer board. */
export interface CardRef {
  board: CardBoard;
  id: string;
}

/** `card_tasks`: one checklist item on a card. */
export interface CardTask {
  id: string;
  /** Exactly one of `personId` (recruiting) and `entryId` (customer) is set. */
  personId: string | null;
  entryId: string | null;
  title: string;
  done: boolean;
  /** When it was ticked (stamped by the database, or by the store in the demo). */
  doneAt: string | null;
  doneBy: string | null;
  /** "YYYY-MM-DD" in the team's calendar. */
  dueDate: string | null;
  /** "HH:mm" wall clock in the team's time zone; only with a date. */
  dueTime: string | null;
  /** The card's owner or the person who set it; null: whoever owns the card. */
  assigneeId: string | null;
  position: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `card_notes`: one entry of a card's log. Never edited. */
export interface CardNote {
  id: string;
  personId: string | null;
  entryId: string | null;
  authorId: string | null;
  body: string;
  createdAt: string;
}

/** Both tables, as the browser store keeps them. */
export interface CardTasksData {
  tasks: CardTask[];
  notes: CardNote[];
}

/** Longest task title and note (the database's checks). */
export const MAX_TASK_TITLE = 200;
export const MAX_NOTE_BODY = 2000;

/**
 * What a demo seed hands over for one card: the first task (a due step, when it has one) and a note.
 * `src/data/cardTasks/seed.ts` turns these into tasks and notes.
 */
export interface SeedFollowup {
  /** The prospect's id (recruiting) or the list entry's id (customer). */
  cardId: string;
  /** The card's owner. */
  ownerId: string;
  title: string | null;
  dueDate: string | null;
  dueTime: string | null;
  note: string | null;
  /** When the note was written. */
  noteAt: string;
}
