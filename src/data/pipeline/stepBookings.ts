/**
 * Booked next steps on either board: book, reschedule and cancel (re-exported
 * from "@/data"). Plain functions that apply at once to the stores; each
 * returns an undo for the toast. Accepting a booking ("Done") is a normal
 * move (movePipelineCard / moveCustomerCard through the board's movers), so
 * nothing here moves a card.
 *
 * A cancellation clears the booking (the card's note stays), is recorded in
 * `pipeline_step_cancellations` for stats, and writes an activity entry
 * about the person ("MG1 cancelled · No-show"). With real accounts the
 * database writes that entry (and removes it when the cancellation is
 * undone); the app only shows it.
 */
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { usePeopleStore } from "@/stores/peopleStore";
import { useActivityStore, type ActivityEvent } from "@/stores/activityStore";
import { serverSide } from "../remote";
import { getViewer } from "../session";
import { CUSTOMER_BOARD } from "../customerPipeline/types";
import { getCustomerCardContext, updateCustomerCard } from "../customerPipeline/mutations";
import { cardBand } from "../customerPipeline/rules";
import { getPipelineCardContext, updatePipelineCard } from "./mutations";
import { recruitingBand } from "./rules";
import { pipeline, updatePipeline } from "./store";
import { customerPipeline } from "../customerPipeline/store";
import {
  NO_BOOKING,
  bookableColumns,
  bookingError,
  bookingLabel,
  bookingOf,
  cancelError,
  cancelSummary,
  cancelText,
  type Booking,
} from "./booking";
import {
  RECRUITING_BOARD,
  type BoardDef,
  type BoardKind,
  type CancelReason,
  type PipelineColumn,
  type StepCancellation,
} from "./types";

interface CardContext {
  booking: Booking;
  /** The card's current column and its band. */
  column: string;
  band: string;
  /** The owner's board. */
  columns: PipelineColumn<string>[];
  def: BoardDef<string>;
  ownerId: string;
  /** The person the activity entry is about (the prospect; the customer or prospect behind a list name). */
  activityPersonId: string | null;
  patch: (p: Partial<Booking>) => (() => void) | null;
}

function contextOf(board: BoardKind, cardId: string): CardContext | null {
  if (board === "customer") {
    const c = getCustomerCardContext(cardId);
    if (!c) return null;
    return {
      booking: bookingOf(c.card),
      column: c.card.column,
      band: cardBand(c.card.column, customerPipeline().steps),
      columns: c.columns,
      def: CUSTOMER_BOARD as BoardDef<string>,
      ownerId: c.entry.ownerId,
      activityPersonId: c.entry.customerId ?? c.entry.prospectId,
      patch: (p) => updateCustomerCard(cardId, p),
    };
  }
  const c = getPipelineCardContext(cardId);
  if (!c) return null;
  return {
    booking: bookingOf(c.card),
    column: c.card.column,
    band: recruitingBand(c.card.column, pipeline().steps),
    columns: c.columns,
    def: RECRUITING_BOARD as BoardDef<string>,
    ownerId: c.ownerId,
    activityPersonId: cardId,
    patch: (p) => updatePipelineCard(cardId, p),
  };
}

/** The columns a card can book now (after its current column on its owner's board). */
export function bookableFor(board: BoardKind, cardId: string): PipelineColumn<string>[] {
  const c = contextOf(board, cardId);
  return c ? bookableColumns(c.columns, c.column, c.def, c.band) : [];
}

export type BookingResult = { ok: true; undo: () => void } | { ok: false; error: string };

/**
 * Book (or change, or clear with NO_BOOKING) a card's next step: a column
 * after its current one on its owner's board, a day and an optional time.
 */
export function bookNextStep(board: BoardKind, cardId: string, booking: Booking): BookingResult {
  const c = contextOf(board, cardId);
  if (!c) return { ok: false, error: "That card isn't on a board you can see." };
  const next = booking.nextColumn
    ? { ...booking, nextStepTime: booking.nextStepTime || null }
    : NO_BOOKING;
  const error = bookingError(next, bookableColumns(c.columns, c.column, c.def, c.band));
  if (error) return { ok: false, error };
  const undo = c.patch(next);
  return undo ? { ok: true, undo } : { ok: false, error: "Couldn't save the next step." };
}

/** Move a booked step to another day (the time stays unless a new one is given). */
export function rescheduleBookedStep(
  board: BoardKind,
  cardId: string,
  date: string,
  time?: string | null,
): BookingResult {
  const c = contextOf(board, cardId);
  if (!c?.booking.nextColumn) return { ok: false, error: "Nothing is booked." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Pick a day." };
  const undo = c.patch({
    nextStepDate: date,
    ...(time !== undefined ? { nextStepTime: time || null } : {}),
  });
  return undo ? { ok: true, undo } : { ok: false, error: "Couldn't save the new day." };
}

export type CancelResult =
  | { ok: true; cancellation: StepCancellation; summary: string; undo: () => void }
  | { ok: false; error: string };

/** Activity entries for cancellations use this id (the database writes the same one). */
export const cancellationActivityId = (cancellationId: string) => `stepcancel-${cancellationId}`;

/**
 * Cancel a booked next step with a reason: the booking is cleared (the note
 * stays), the cancellation is recorded and the person's activity says so.
 * The undo puts the booking back and removes the record (and the entry).
 */
export function cancelBookedStep(
  board: BoardKind,
  cardId: string,
  reason: CancelReason,
  text: string | null = null,
): CancelResult {
  const v = getViewer();
  const me = v && v.role !== "candidate" ? v.personId : null;
  const c = me ? contextOf(board, cardId) : null;
  if (!me || !c) return { ok: false, error: "That card isn't on a board you can see." };
  if (!c.booking.nextColumn) return { ok: false, error: "Nothing is booked." };
  const error = cancelError(reason, text);
  if (error) return { ok: false, error };

  const col = c.columns.find((x) => x.id === c.booking.nextColumn);
  const steps = board === "customer" ? customerPipeline().steps : pipeline().steps;
  const label = col
    ? bookingLabel(col)
    : (steps.find((s) => s.id === c.booking.nextColumn)?.label ?? "Next step");
  const summary = cancelSummary(label, reason, text);
  const at = new Date().toISOString();
  const cancellation: StepCancellation = {
    id: crypto.randomUUID(),
    board,
    cardId,
    ownerId: c.ownerId,
    column: c.booking.nextColumn,
    bookedDate: c.booking.nextStepDate,
    bookedTime: c.booking.nextStepTime,
    reason,
    reasonText: cancelText(reason, text),
    cancelledAt: at,
    cancelledBy: me,
  };

  const restore = c.patch(NO_BOOKING);
  if (!restore) return { ok: false, error: "Couldn't cancel the next step." };
  updatePipeline((s) => ({ cancellations: [...s.cancellations, cancellation] }));

  // The activity entry (the database writes it with real accounts).
  const personId = c.activityPersonId;
  const visible = !!personId && usePeopleStore.getState().people.some((p) => p.id === personId);
  const entryId = cancellationActivityId(cancellation.id);
  if (personId && visible) {
    const entry: ActivityEvent = {
      id: entryId,
      timestamp: at,
      actorName: "You",
      entityType: "person",
      entityId: personId,
      relatedPersonId: personId,
      kind: "note",
      summary,
      meta: { cancellationId: cancellation.id, board, reason, day: localDate() },
    };
    const add = () => useActivityStore.setState((s) => ({ events: [entry, ...s.events] }));
    if (IS_SUPABASE) serverSide(add);
    else add();
  }

  return {
    ok: true,
    cancellation,
    summary,
    undo: () => {
      restore();
      updatePipeline((s) => ({
        cancellations: s.cancellations.filter((x) => x.id !== cancellation.id),
      }));
      const drop = () =>
        useActivityStore.setState((s) => ({ events: s.events.filter((e) => e.id !== entryId) }));
      if (IS_SUPABASE) serverSide(drop);
      else drop();
    },
  };
}
