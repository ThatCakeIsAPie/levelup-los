/**
 * Your list and the customer pipeline: writes (re-exported from "@/data").
 * Plain functions that apply at once to the store; the ones a person may want
 * to take back return an `undo` for the toast.
 *
 * With real accounts moves go through `move_customer_card()` (it also makes
 * the customer at First sale and marks On Ditto), so the client shows those
 * effects without writing them (`serverSide`); undo deletes the move and the
 * database reverses them in the same statement.
 */
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { serverSide } from "../remote";
import { useRemoteStore } from "../remote/extras";
import { addPerson, removePerson } from "../people";
import { removeContact, removeSale } from "../crm";
import { useCrmStore } from "@/stores/crmStore";
import { getViewer } from "../session";
import { chainOf, columnsFor, validateMove } from "../pipeline/rules";
import { addPipelineProspect } from "../pipeline/mutations";
import type { PipelineColumn } from "../pipeline/types";
import { bookingAfterMove, bookingOf, cleanNote, type Booking } from "../pipeline/booking";
import { customerPipeline, updateCustomerPipeline } from "./store";
import {
  canEditListOf,
  clean,
  customerFromEntry,
  entryError,
  implicitCustomerCard,
  moveEffects,
  visibleEntries,
  type EntryInput,
} from "./rules";
import {
  CUSTOMER_BOARD,
  NOT_CONTACTED,
  type CustomerBand,
  type CustomerCard,
  type CustomerMove,
  type ListEntry,
  type ListRating,
} from "./types";

const now = () => new Date().toISOString();

/** Real accounts: your uplines (root first), which the people list doesn't hold. */
const uplines = () => useRemoteStore.getState().chain.map((c) => c.personId);

/** The current user, when they may use a list and board (not candidates). */
function actor(): string | null {
  const v = getViewer();
  return v && v.role !== "candidate" ? v.personId : null;
}

function visibleEntry(id: string): ListEntry | undefined {
  const people = usePeopleStore.getState().people;
  return visibleEntries(customerPipeline().entries, people, getViewer()).find((e) => e.id === id);
}

/** Columns a card may move to: its owner's board and the viewer's board. */
function columnsForMove(ownerId: string, me: string): PipelineColumn<CustomerBand>[] {
  const { steps, hides } = customerPipeline();
  const people = usePeopleStore.getState().people;
  const mine = columnsFor(chainOf(people, me, uplines()), steps, hides, CUSTOMER_BOARD);
  if (ownerId === me) return mine;
  const theirs = columnsFor(chainOf(people, ownerId, uplines()), steps, hides, CUSTOMER_BOARD);
  const ids = new Set(mine.map((c) => c.id));
  return [...mine, ...theirs.filter((c) => !ids.has(c.id))];
}

/** The list owner's board: where bookings live. */
function ownerColumns(ownerId: string): PipelineColumn<CustomerBand>[] {
  const { steps, hides } = customerPipeline();
  const people = usePeopleStore.getState().people;
  return columnsFor(chainOf(people, ownerId, uplines()), steps, hides, CUSTOMER_BOARD);
}

function cardOf(entry: ListEntry): { card: CustomerCard; stored: boolean } {
  const stored = customerPipeline().cards.find((c) => c.entryId === entry.id);
  return stored
    ? { card: stored, stored: true }
    : { card: implicitCustomerCard(entry), stored: false };
}

function putCard(card: CustomerCard): void {
  updateCustomerPipeline((s) => ({
    cards: s.cards.some((c) => c.entryId === card.entryId)
      ? s.cards.map((c) => (c.entryId === card.entryId ? card : c))
      : [...s.cards, card],
  }));
}

function restoreCard(entryId: string, prev: CustomerCard | null): void {
  updateCustomerPipeline((s) => ({
    cards: prev
      ? s.cards.some((c) => c.entryId === entryId)
        ? s.cards.map((c) => (c.entryId === entryId ? prev : c))
        : [...s.cards, prev]
      : s.cards.filter((c) => c.entryId !== entryId),
  }));
}

function patchEntry(id: string, patch: Partial<ListEntry>): void {
  updateCustomerPipeline((s) => ({
    entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now() } : e)),
  }));
}

/** Mark a customer on Ditto from `day` (undefined: not on Ditto). No activity entry. */
function setDitto(personId: string, day: string | undefined): void {
  usePeopleStore.setState((s) => ({
    people: s.people.map((p) =>
      p.id === personId ? { ...p, dittoSince: day, lastUpdatedAt: now() } : p,
    ),
  }));
}

/**
 * Undoing a first sale: the customer it made goes again, with anything logged
 * for them since (a sale logged from the sheet that opened). With real
 * accounts the database does it; this only shows it.
 */
function dropCreatedCustomer(id: string): void {
  const crm = useCrmStore.getState();
  const sales = crm.sales.filter((x) => x.customerId === id).map((x) => x.id);
  const contacts = crm.contacts.filter((x) => x.personId === id).map((x) => x.id);
  if (IS_SUPABASE) {
    serverSide(() => {
      sales.forEach(removeSale);
      contacts.forEach(removeContact);
      usePeopleStore.setState((s) => ({ people: s.people.filter((p) => p.id !== id) }));
    });
    return;
  }
  sales.forEach(removeSale);
  contacts.forEach(removeContact);
  removePerson(id);
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export interface ListEntryInput extends EntryInput {
  /** Whose list (default: yours). An upline may add to their downline's list. */
  ownerId?: string;
  rating?: ListRating | null;
}

export type EntryResult =
  { ok: true; entry: ListEntry; undo: () => void } | { ok: false; error: string };

/** Add a name to a list (yours, or a downline's). It starts in "Not contacted yet". */
export function addListEntry(input: ListEntryInput): EntryResult {
  const me = actor();
  if (!me) return { ok: false, error: "Your list starts when you register." };
  const ownerId = input.ownerId ?? me;
  if (!canEditListOf(usePeopleStore.getState().people, getViewer(), ownerId))
    return { ok: false, error: "You can add to your own list and your team's." };
  const error = entryError(input);
  if (error) return { ok: false, error };
  const at = now();
  const entry: ListEntry = {
    id: crypto.randomUUID(),
    ownerId,
    name: input.name.trim(),
    howKnown: clean(input.howKnown),
    phone: clean(input.phone),
    email: clean(input.email),
    notes: clean(input.notes),
    rating: input.rating ?? null,
    customerId: null,
    prospectId: null,
    addedBy: me,
    createdAt: at,
    updatedAt: at,
  };
  updateCustomerPipeline((s) => ({ entries: [...s.entries, entry] }));
  return { ok: true, entry, undo: () => removeListEntry(entry.id) };
}

/** Edit a name on a list (name, how you know them, phone, email, notes, warm/hot). */
export function updateListEntry(
  id: string,
  patch: Partial<Pick<ListEntry, "name" | "howKnown" | "phone" | "email" | "notes" | "rating">>,
): { ok: true } | { ok: false; error: string } {
  const entry = actor() ? visibleEntry(id) : undefined;
  if (!entry) return { ok: false, error: "That name isn't on a list you can see." };
  const next = { ...entry, ...patch };
  const error = entryError(next);
  if (error) return { ok: false, error };
  patchEntry(id, {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.howKnown !== undefined ? { howKnown: clean(patch.howKnown) } : {}),
    ...(patch.phone !== undefined ? { phone: clean(patch.phone) } : {}),
    ...(patch.email !== undefined ? { email: clean(patch.email) } : {}),
    ...(patch.notes !== undefined ? { notes: clean(patch.notes) } : {}),
    ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
  });
  return { ok: true };
}

/**
 * Remove a name from a list (and its card). Its past moves still count; the
 * customer or prospect it became stays.
 */
export function removeListEntry(id: string): void {
  if (!actor() || !visibleEntry(id)) return;
  updateCustomerPipeline((s) => ({
    entries: s.entries.filter((e) => e.id !== id),
    cards: s.cards.filter((c) => c.entryId !== id),
  }));
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

export type CustomerMoveFailure = "no-access" | "not-found" | "unknown-column" | "same-column";

export type CustomerMoveResult =
  | {
      ok: true;
      move: CustomerMove;
      band: CustomerBand;
      /** The customer behind the entry after the move (made now, or before). */
      customerId: string | null;
      /** True when this move made them a customer. */
      becameCustomer: boolean;
      /** True when this move marked them on Ditto. */
      setDitto: boolean;
      undo: () => void;
    }
  | { ok: false; reason: CustomerMoveFailure };

/**
 * Move a card to a column (a milestone, a fixed column or a step on the
 * owner's or your board) and record the move. Reaching First sale makes the
 * entry a customer of the list's owner; reaching On Ditto marks them as a
 * subscription customer. A booked next step is cleared when the card moves
 * into its column or past it, and kept when it moves backwards, unless
 * `booking` books a new one.
 */
export function moveCustomerCard(
  entryId: string,
  to: string,
  opts: { booking?: Booking } = {},
): CustomerMoveResult {
  const me = actor();
  if (!me) return { ok: false, reason: "no-access" };
  const entry = visibleEntry(entryId);
  if (!entry) return { ok: false, reason: "not-found" };
  const { card, stored } = cardOf(entry);
  const check = validateMove({ ...card, droppedAt: null }, to, columnsForMove(entry.ownerId, me));
  if (!check.ok)
    return { ok: false, reason: check.reason === "not-on-board" ? "not-found" : check.reason };
  const band = check.to.band;
  const people = usePeopleStore.getState().people;
  const existing = entry.customerId ? people.find((p) => p.id === entry.customerId) : undefined;
  const fx = moveEffects(entry, band, existing);
  const customerId = fx.createCustomer ? crypto.randomUUID() : entry.customerId;
  const today = localDate();
  const at = now();
  const move: CustomerMove = {
    id: crypto.randomUUID(),
    entryId,
    ownerId: entry.ownerId,
    from: stored ? card.column : null,
    to,
    band,
    movedAt: at,
    movedBy: me,
    createdCustomerId: fx.createCustomer ? customerId : null,
    setDitto: fx.setDitto,
  };
  putCard({
    ...card,
    column: to,
    enteredAt: at,
    ...(opts.booking ?? bookingAfterMove(bookingOf(card), to, ownerColumns(entry.ownerId), band)),
    updatedAt: at,
  });
  updateCustomerPipeline((s) => ({ moves: [...s.moves, move] }));

  // Real accounts: move_customer_card() makes the customer and marks Ditto.
  const effects = () => {
    if (fx.createCustomer && customerId) {
      addPerson(customerFromEntry(entry, customerId, today));
      patchEntry(entryId, { customerId });
    }
    if (fx.setDitto && customerId) setDitto(customerId, today);
  };
  if (IS_SUPABASE) serverSide(effects);
  else effects();

  return {
    ok: true,
    move,
    band,
    customerId,
    becameCustomer: fx.createCustomer,
    setDitto: fx.setDitto,
    undo: () => {
      updateCustomerPipeline((s) => ({ moves: s.moves.filter((m) => m.id !== move.id) }));
      restoreCard(entryId, stored ? card : null);
      // Real accounts: deleting the move does this in the database.
      const revert = () => {
        if (fx.setDitto && customerId && !fx.createCustomer)
          setDitto(customerId, existing?.dittoSince);
        if (fx.createCustomer) patchEntry(entryId, { customerId: null });
      };
      if (IS_SUPABASE) serverSide(revert);
      else revert();
      if (fx.createCustomer && customerId) dropCreatedCustomer(customerId);
    },
  };
}

/** Your list's "Start": you're reaching out, so the name moves to Contact. */
export function startListEntry(entryId: string): CustomerMoveResult {
  return moveCustomerCard(entryId, "contact");
}

/**
 * Board "Add someone": a new name on the list (yours by default) that goes
 * straight to a column, Contact unless another is given (someone met in the
 * marketplace is a contact made).
 */
export function addCustomerContact(
  input: ListEntryInput & { column?: string; booking?: Booking },
): EntryResult {
  const r = addListEntry(input);
  if (!r.ok) return r;
  const column = input.column ?? "contact";
  if (column === NOT_CONTACTED) return r;
  const moved = moveCustomerCard(
    r.entry.id,
    column,
    input.booking?.nextColumn ? { booking: input.booking } : {},
  );
  return {
    ok: true,
    entry: r.entry,
    undo: () => {
      if (moved.ok) moved.undo();
      r.undo();
    },
  };
}

/**
 * Edit a card's booked next step or note (a card still on the list gets one
 * in "Not contacted yet"). Returns an undo (puts back what the patch
 * changed), or null when nothing was saved.
 */
export function updateCustomerCard(
  entryId: string,
  patch: Partial<Pick<CustomerCard, "nextColumn" | "nextStepDate" | "nextStepTime" | "note">>,
): (() => void) | null {
  const entry = actor() ? visibleEntry(entryId) : undefined;
  if (!entry) return null;
  const { card } = cardOf(entry);
  const next = "note" in patch ? { ...patch, note: cleanNote(patch.note) } : patch;
  putCard({ ...card, ...next, updatedAt: now() });
  const before = Object.fromEntries(
    Object.keys(next).map((k) => [k, card[k as keyof CustomerCard]]),
  ) as Partial<CustomerCard>;
  return () => {
    const cur = customerPipeline().cards.find((c) => c.entryId === entryId);
    if (cur) putCard({ ...cur, ...before, updatedAt: now() });
  };
}

/** The entry's card and its owner's board (for the booking rules). */
export function getCustomerCardContext(entryId: string): {
  card: CustomerCard;
  entry: ListEntry;
  columns: PipelineColumn<CustomerBand>[];
} | null {
  const entry = actor() ? visibleEntry(entryId) : undefined;
  if (!entry) return null;
  return { card: cardOf(entry).card, entry, columns: ownerColumns(entry.ownerId) };
}

/**
 * Put a name on the recruiting pipeline too: a new prospect sponsored by the
 * list's owner, linked to the entry. One name can be on both boards.
 */
export function addEntryToRecruiting(
  entryId: string,
): { person: CrmPerson; undo: () => void } | null {
  const entry = actor() ? visibleEntry(entryId) : undefined;
  if (!entry || entry.prospectId) return null;
  const r = addPipelineProspect({
    name: entry.name,
    phone: entry.phone ?? undefined,
    source: entry.howKnown ?? undefined,
    sponsorId: entry.ownerId,
  });
  if (!r) return null;
  patchEntry(entryId, { prospectId: r.person.id });
  return {
    person: r.person,
    undo: () => {
      patchEntry(entryId, { prospectId: null });
      r.undo();
    },
  };
}

/** Non-reactive lookup (for movers and dialogs): the entry, when the viewer may see it. */
export function getListEntry(id: string): ListEntry | undefined {
  return visibleEntry(id);
}
