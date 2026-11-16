/**
 * What the board and the profile show of the steps after Registered (pure: no React, no stores).
 * Unit-tested in boardView.test.ts. The membership rule itself is `afterRegistered()`; this is the view
 * logic on top of it: which columns take which card, and the numbers a column shows.
 */
import type { AfterRegistered, AfterRegisteredCard } from "./afterRegistered";
import { POST_REGISTRATION_BAND, type PipelineColumn } from "./types";

/** A prospect's card, or the card of a registered person (an apprentice or IBO) in progress. */
export type CardKind = "prospect" | "registered";

/** A step after Registered (the milestone itself is not one). */
export const isAfterRegisteredStep = (c: Pick<PipelineColumn<string>, "kind" | "band">): boolean =>
  c.kind === "step" && c.band === POST_REGISTRATION_BAND;

/**
 * May a card of this kind be dropped on this column?
 *  - A registered person's card: Registered and the steps after it, nothing else.
 *  - A prospect's card: every column it could go to before (Registered included), not a step after
 *    Registered (they register first).
 * On a board with no step after Registered this is true for every prospect move, as it always was.
 */
export function canDropOn(
  kind: CardKind,
  column: Pick<PipelineColumn<string>, "kind" | "band">,
): boolean {
  if (kind === "registered") return column.band === POST_REGISTRATION_BAND;
  return !isAfterRegisteredStep(column);
}

/** The columns the "Move to…" menu offers for a card of this kind (the board's columns, in order). */
export function moveChoices<C extends Pick<PipelineColumn<string>, "kind" | "band">>(
  kind: CardKind,
  columns: readonly C[],
): C[] {
  return columns.filter((c) => canDropOn(kind, c));
}

/** One column after Registered as the board shows it. */
export interface RegisteredColumnView {
  column: PipelineColumn<string>;
  cards: AfterRegisteredCard[];
  /** The count in the column header: the cards shown (the finishing column: this month's). */
  shown: number;
  /** The finishing column only: cards that arrived before this month (counted, not listed); else null. */
  earlier: number | null;
}

export function registeredColumnViews(ar: AfterRegistered): RegisteredColumnView[] {
  return ar.columns.map((c) => ({
    column: c.column,
    cards: c.cards,
    shown: c.cards.length,
    earlier: c.finishing ? c.total - c.cards.length : null,
  }));
}

/** The cards listed across the band (what its header counts). */
export const registeredBandCount = (views: readonly RegisteredColumnView[]): number =>
  views.reduce((n, v) => n + v.shown, 0);

/** The profile: a registered person's card in progress, as the viewer's board shows it. */
export interface RegisteredProfile {
  column: PipelineColumn<string>;
  finishing: boolean;
  enteredAt: string;
}

/** Where the profile finds a registered person on this board (null: finished, not on it, or no steps). */
export function registeredProfile(ar: AfterRegistered, personId: string): RegisteredProfile | null {
  for (const c of ar.columns) {
    const card = c.cards.find((x) => x.personId === personId);
    if (card) return { column: c.column, finishing: c.finishing, enteredAt: card.enteredAt };
  }
  return null;
}
