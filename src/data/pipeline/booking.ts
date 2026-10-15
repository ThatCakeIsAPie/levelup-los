/**
 * Booked next steps (pure, no React, no stores; tested in booking.test.ts).
 * The same rules on both boards (the recruiting pipeline and the customer
 * pipeline, through their `BoardDef`).
 *
 * Booking the next step means picking the column the card moves into next
 * (any column after the card's current one on its owner's board, milestones
 * included, never the outcome columns) with a date and an optional time.
 * From Home the owner accepts it ("Done": the card moves there through the
 * normal move path), reschedules it or cancels it with a reason.
 *
 *  - Moving into the booked column, or past it, clears the booking; moving
 *    backwards keeps it.
 *  - A booked column that is no longer on the owner's board (the leader
 *    deleted the step, or it was hidden) is "removed": the card says so and
 *    asks to rebook; nothing else breaks.
 *  - The database mirrors the move rule in move_pipeline_card() /
 *    move_customer_card() and the legacy-text mapping in
 *    legacy_next_column() (supabase/migrations/20261014005000_*).
 */
import { addDays, differenceInCalendarDays } from "date-fns";
import { localDate, parseDate } from "@/lib/dates";
import { resolveColumn } from "./rules";
import {
  DO_NOT_CONTACT,
  MAX_CANCEL_TEXT,
  MAX_CARD_NOTE,
  RECRUITING_BOARD,
  type BoardDef,
  type BoardKind,
  type CancelReason,
  type PipelineColumn,
} from "./types";

/** The booking fields a card carries (both boards). */
export interface Booking {
  nextColumn: string | null;
  nextStepDate: string | null;
  nextStepTime: string | null;
}

export const NO_BOOKING: Booking = { nextColumn: null, nextStepDate: null, nextStepTime: null };

/** The booking part of a card. */
export const bookingOf = (card: Booking): Booking => ({
  nextColumn: card.nextColumn,
  nextStepDate: card.nextStepDate,
  nextStepTime: card.nextStepTime,
});

export const sameBooking = (a: Booking, b: Booking): boolean =>
  a.nextColumn === b.nextColumn &&
  a.nextStepDate === b.nextStepDate &&
  a.nextStepTime === b.nextStepTime;

/** Is this column one of the board's outcome or start columns (never booked)? */
function isEndColumn(c: PipelineColumn<string>, def: BoardDef<string>): boolean {
  const kind = def.bands.find((b) => b.id === c.band)?.kind;
  return kind === "outcome" || kind === "start";
}

/** Where `columnId` sits on a board with these columns (a step it doesn't show counts as its band's milestone); -1 when unknown. */
function positionOf(
  columns: readonly PipelineColumn<string>[],
  columnId: string,
  band?: string | null,
): number {
  const i = columns.findIndex((c) => c.id === columnId);
  if (i >= 0 || !band) return i;
  const ids = new Set(columns.map((c) => c.id));
  return columns.findIndex((c) => c.id === resolveColumn(columnId, band, ids));
}

/**
 * The columns a card in `current` can book: every column after it on its
 * owner's board, milestones included, except "Not contacted yet" and the
 * outcomes ("Not interested", "Do not contact"). `currentBand` places a card
 * whose step this board doesn't show (under its milestone).
 */
export function bookableColumns<C extends PipelineColumn<string>>(
  columns: readonly C[],
  current: string,
  def: BoardDef<string> = RECRUITING_BOARD as BoardDef<string>,
  currentBand?: string | null,
): C[] {
  const i = positionOf(columns, current, currentBand);
  return columns.slice(i + 1).filter((c) => !isEndColumn(c, def));
}

export type DueState = "overdue" | "today" | "upcoming";

/** Is a booked day past, today or ahead? */
export function dueState(date: string, today: string = localDate()): DueState {
  if (date < today) return "overdue";
  if (date === today) return "today";
  return "upcoming";
}

/** What a card shows for its booking. */
export interface BookingView<C extends PipelineColumn<string> = PipelineColumn<string>> {
  /** The booked column on the owner's board; null when it was removed. */
  column: C | null;
  columnId: string;
  /** The booked column is no longer on the board: "Next step removed", rebook. */
  removed: boolean;
  date: string | null;
  time: string | null;
  /** null without a date. */
  due: DueState | null;
}

/** The booking as the card shows it (null when nothing is booked). */
export function bookingView<C extends PipelineColumn<string>>(
  booking: Booking,
  columns: readonly C[],
  today: string = localDate(),
): BookingView<C> | null {
  if (!booking.nextColumn) return null;
  const column = columns.find((c) => c.id === booking.nextColumn) ?? null;
  return {
    column,
    columnId: booking.nextColumn,
    removed: !column,
    date: booking.nextStepDate,
    time: booking.nextStepDate ? booking.nextStepTime : null,
    due: booking.nextStepDate ? dueState(booking.nextStepDate, today) : null,
  };
}

/**
 * The booking after a move to `to` (`toBand`: its band, for a step the
 * owner's board doesn't show): cleared when the card moves into the booked
 * column or past it (the outcomes count as past), kept when it moves
 * backwards. A removed booking stays as it is (it still asks to rebook).
 */
export function bookingAfterMove(
  booking: Booking,
  to: string,
  columns: readonly PipelineColumn<string>[],
  toBand?: string | null,
): Booking {
  if (!booking.nextColumn) return NO_BOOKING;
  if (to === booking.nextColumn) return NO_BOOKING;
  const booked = positionOf(columns, booking.nextColumn);
  if (booked < 0) return booking;
  const at = positionOf(columns, to, toBand);
  return at >= booked ? NO_BOOKING : booking;
}

// ---------------------------------------------------------------------------
// Booking form
// ---------------------------------------------------------------------------

/** The day a new booking starts on: tomorrow. */
export const defaultBookingDate = (today: string = localDate()): string =>
  localDate(addDays(parseDate(today), 1));

/** Reschedule shortcuts: tomorrow and a week from today. */
export function rescheduleChoices(today: string = localDate()): {
  label: string;
  date: string;
}[] {
  const d = parseDate(today);
  return [
    { label: "Tomorrow", date: localDate(addDays(d, 1)) },
    { label: "Next week", date: localDate(addDays(d, 7)) },
  ];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** "HH:MM" (24-hour). */
export const validTime = (t: string): boolean => TIME_RE.test(t);

/**
 * Why this booking can't be saved, or null. An empty column means "nothing
 * booked" (fine); a booked column needs a date, may have a time.
 */
export function bookingError(
  booking: Booking,
  bookable: readonly PipelineColumn<string>[],
): string | null {
  if (!booking.nextColumn) return null;
  if (!bookable.some((c) => c.id === booking.nextColumn))
    return "Pick a column after the one they're in.";
  if (!booking.nextStepDate || !DATE_RE.test(booking.nextStepDate)) return "Pick a day.";
  if (booking.nextStepTime && !validTime(booking.nextStepTime))
    return "That time doesn't look right.";
  return null;
}

/** A note trimmed to null when empty. */
export const cleanNote = (note: string | null | undefined): string | null => {
  const t = note?.trim();
  return t ? t.slice(0, MAX_CARD_NOTE) : null;
};

/** Days between today and a booked day (negative = overdue). */
export const daysUntil = (date: string, today: string = localDate()): number =>
  differenceInCalendarDays(parseDate(date), parseDate(today));

// ---------------------------------------------------------------------------
// Home: due and overdue booked steps
// ---------------------------------------------------------------------------

/** A card with a booking, as Home's Today list considers it. */
export interface BookingCandidate {
  board: BoardKind;
  /** Person id (recruiting) or list entry id (customer board). */
  cardId: string;
  name: string;
  ownerId: string;
  /** People behind the card, for "Do not contact" (prospect, customer). */
  personIds: string[];
  booking: Booking;
  /** The card's current column. */
  column: string;
  /** Off the board (recruiting "Take off the board"). */
  dropped: boolean;
  /** The owner's board. */
  columns: readonly PipelineColumn<string>[];
}

export interface DueBooking {
  board: BoardKind;
  cardId: string;
  name: string;
  ownerId: string;
  column: PipelineColumn<string>;
  date: string;
  time: string | null;
  due: Exclude<DueState, "upcoming">;
  /** Whole days late (0 = today). */
  daysLate: number;
}

/**
 * Booked steps due today or overdue on the cards the viewer owns, oldest
 * first (then by time, then name). Left out: other people's cards, cards off
 * the board, cards in "Do not contact" (and people hidden from reminders),
 * bookings without a date, and bookings whose column was removed.
 */
export function dueBookings(
  cards: readonly BookingCandidate[],
  viewerId: string,
  today: string = localDate(),
  skip?: ReadonlySet<string>,
): DueBooking[] {
  const out: DueBooking[] = [];
  for (const c of cards) {
    if (c.ownerId !== viewerId || c.dropped) continue;
    if (c.column === DO_NOT_CONTACT) continue;
    if (c.personIds.some((id) => skip?.has(id))) continue;
    const view = bookingView(c.booking, c.columns, today);
    if (!view || view.removed || !view.date || !view.column) continue;
    if (view.due === "upcoming" || !view.due) continue;
    out.push({
      board: c.board,
      cardId: c.cardId,
      name: c.name,
      ownerId: c.ownerId,
      column: view.column,
      date: view.date,
      time: view.time,
      due: view.due,
      daysLate: Math.max(0, -daysUntil(view.date, today)),
    });
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? "99").localeCompare(b.time ?? "99") ||
      a.name.localeCompare(b.name),
  );
}

// ---------------------------------------------------------------------------
// Cancelling a booked step
// ---------------------------------------------------------------------------

export const CANCEL_REASONS: { value: CancelReason; label: string }[] = [
  { value: "they_cancelled", label: "They cancelled" },
  { value: "no_show", label: "No-show" },
  { value: "unreachable", label: "Couldn't reach them" },
  { value: "not_interested", label: "Not interested anymore" },
  { value: "other", label: "Other…" },
];

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  they_cancelled: "They cancelled",
  no_show: "No-show",
  unreachable: "Couldn't reach them",
  not_interested: "Not interested anymore",
  other: "Other",
};

export const isCancelReason = (v: string): v is CancelReason =>
  CANCEL_REASONS.some((r) => r.value === v);

/** Why a cancellation can't be saved, or null. "Other…" needs its own words. */
export function cancelError(reason: CancelReason | null, text: string | null): string | null {
  if (!reason || !isCancelReason(reason)) return "Pick a reason.";
  const t = text?.trim() ?? "";
  if (reason === "other" && !t) return "Say what happened.";
  if (t.length > MAX_CANCEL_TEXT) return `Keep it to ${MAX_CANCEL_TEXT} characters.`;
  return null;
}

/** The reason text to store: only for "Other…". */
export const cancelText = (reason: CancelReason, text: string | null): string | null =>
  reason === "other" ? text?.trim().slice(0, MAX_CANCEL_TEXT) || null : null;

/** The activity line: "MG1 cancelled · No-show", "Info 2 cancelled · Car broke down". */
export function cancelSummary(
  stepLabel: string,
  reason: CancelReason,
  text: string | null,
): string {
  const why =
    reason === "other" ? (cancelText(reason, text) ?? "Other") : CANCEL_REASON_LABEL[reason];
  return `${stepLabel} cancelled · ${why}`;
}

/** "Not interested anymore" offers to move the card to "Not interested" too. */
export const offersNotInterested = (reason: CancelReason | null): boolean =>
  reason === "not_interested";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * The short name of a booked column: a milestone's team name when it has one
 * ("First meeting (MG1)" → "MG1"), else the column's label.
 */
export function bookingLabel(c: Pick<PipelineColumn<string>, "label" | "kind">): string {
  if (c.kind === "milestone") {
    const m = /\(([^)]+)\)\s*$/.exec(c.label);
    if (m) return m[1];
  }
  return c.label;
}

// ---------------------------------------------------------------------------
// Legacy free-text next steps ("MG1", "Open the door")
// ---------------------------------------------------------------------------

/** Common names for milestones, per board (lower case). */
const ALIASES: Record<BoardKind, Record<string, string[]>> = {
  recruiting: {
    contact: ["contact", "contact made"],
    first_meeting: ["first meeting", "mg1", "mg 1", "1st meeting", "meeting 1"],
    first_plan: ["first plan", "info", "info 1", "info1", "show the plan", "show plan", "plan"],
    registered: ["registered", "register", "registration", "sign up"],
  },
  customer: {
    contact: ["contact"],
    first_meeting: ["first meeting", "mg1", "mg 1", "1st meeting"],
    first_sale: ["first sale", "sale"],
    on_ditto: ["on ditto", "ditto", "offer ditto"],
  },
};

/** Lower case, single spaces, no trailing punctuation. */
export const normalizeStepText = (t: string): string =>
  t
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?:;,]+$/, "")
    .trim();

/**
 * The column an old free-text next step names on the owner's board, when it
 * is one the card can book (after its current column): a column's label
 * ("Book", "Info 2", "First meeting (MG1)"), its team name ("MG1"), or a
 * common name for a milestone ("Info" → First plan). Null otherwise (the
 * text becomes the card's note).
 */
export function legacyNextColumn(
  text: string | null | undefined,
  columns: readonly PipelineColumn<string>[],
  current: string,
  def: BoardDef<string> = RECRUITING_BOARD as BoardDef<string>,
  currentBand?: string | null,
): string | null {
  const t = text ? normalizeStepText(text) : "";
  if (!t) return null;
  const bookable = bookableColumns(columns, current, def, currentBand);
  const byLabel = bookable.find(
    (c) => normalizeStepText(c.label) === t || normalizeStepText(bookingLabel(c)) === t,
  );
  if (byLabel) return byLabel.id;
  const aliases = ALIASES[def.kind];
  const m = Object.keys(aliases).find((id) => aliases[id].includes(t));
  return m && bookable.some((c) => c.id === m) ? m : null;
}

/** A card as stored before bookings: a free-text `nextStep`. */
export interface LegacyCard {
  nextStep?: string | null;
  nextStepDate?: string | null;
  nextColumn?: string | null;
  nextStepTime?: string | null;
  note?: string | null;
}

/**
 * Convert an old card (free-text `nextStep`) to the booking model: a text
 * that names a bookable column books it (keeping the date); any other text
 * becomes the note (the date goes, since nothing is booked). Cards already
 * converted come back unchanged (minus a stray `nextStep`).
 */
export function convertLegacyCard<T extends LegacyCard & { column: string }>(
  card: T,
  columns: readonly PipelineColumn<string>[],
  def: BoardDef<string> = RECRUITING_BOARD as BoardDef<string>,
  currentBand?: string | null,
): Omit<T, "nextStep"> & Booking & { note: string | null } {
  const { nextStep, ...rest } = card;
  const base = {
    ...rest,
    nextColumn: card.nextColumn ?? null,
    nextStepDate: card.nextStepDate ?? null,
    nextStepTime: card.nextStepTime ?? null,
    note: card.note ?? null,
  };
  if (!nextStep?.trim() || base.nextColumn) return base;
  const col = legacyNextColumn(nextStep, columns, card.column, def, currentBand);
  if (col) return { ...base, nextColumn: col };
  return {
    ...base,
    nextStepDate: null,
    nextStepTime: null,
    note: cleanNote(base.note ? `${base.note}\n${nextStep}` : nextStep),
  };
}

/**
 * Convert every card of a stored board (local demo data saved before
 * bookings). `boardOf` gives a card's owner's board and its current band.
 * Returns the same array when nothing needed converting.
 */
export function convertLegacyCards<T extends LegacyCard & { column: string }>(
  cards: readonly T[],
  boardOf: (card: T) => { columns: readonly PipelineColumn<string>[]; band: string | null },
  def: BoardDef<string> = RECRUITING_BOARD as BoardDef<string>,
): (Omit<T, "nextStep"> & Booking & { note: string | null })[] {
  if (!cards.some((c) => "nextStep" in c || c.nextColumn === undefined || c.note === undefined))
    return cards as unknown as (Omit<T, "nextStep"> & Booking & { note: string | null })[];
  return cards.map((c) => {
    const { columns, band } = boardOf(c);
    return convertLegacyCard(c, columns, def, band);
  });
}
