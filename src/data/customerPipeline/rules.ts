/**
 * Your list and the customer pipeline: pure rules (no React, no stores),
 * unit-tested in rules.test.ts. The board itself (columns, inheritance,
 * reaches, step edits) uses the recruiting pipeline's rules with
 * CUSTOMER_BOARD; what is particular to customers lives here. The database
 * mirrors the ones that guard writes (supabase/migrations/20261014000500_*).
 */
import { differenceInCalendarDays } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";
import { visibleIdSet, type Viewer } from "../access";
import { dayOf, localNoon, reachesOf, type MoveLike, type Reach } from "../pipeline/rules";
import { STALE_DAYS } from "../pipeline/types";
import {
  CUSTOMER_BOARD,
  CUSTOMER_MILESTONES,
  DO_NOT_CONTACT,
  MAX_ENTRY_NAME,
  MAX_ENTRY_NOTES,
  MAX_HOW_KNOWN,
  NOT_CONTACTED,
  type CustomerBand,
  type CustomerCard,
  type CustomerMilestone,
  type CustomerMove,
  type ListEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

/** Position of a band on the board (start 0 … out 5). */
export const customerBandIndex = (b: CustomerBand): number =>
  CUSTOMER_BOARD.bands.findIndex((x) => x.id === b);

export const isCustomerMilestone = (id: string): id is CustomerMilestone =>
  (CUSTOMER_MILESTONES as readonly string[]).includes(id);

/** Bands at or past First sale (the entry is a customer by then). */
export const isSaleBand = (b: CustomerBand): boolean => b === "first_sale" || b === "on_ditto";

/**
 * Bands where a card can go quiet: someone being worked toward a first sale
 * (the list, customers and outcomes never do; customers have their own
 * contact reminders).
 */
export const isWorkingBand = (b: CustomerBand): boolean => b === "contact" || b === "first_meeting";

// ---------------------------------------------------------------------------
// Who sees which list
// ---------------------------------------------------------------------------

/** Who can have a list: apprentices and IBOs (not prospects, customers or candidates). */
export const canOwnList = (p: CrmPerson | undefined): boolean =>
  !!p && (p.bizClass === "apprentice" || p.bizClass === "ibo");

/**
 * The list entries the viewer may see and edit: their own and their
 * downline's (the owner must be someone they see on the business path).
 * Crosslines never; candidates have no list.
 */
export function visibleEntries(
  entries: ListEntry[],
  people: CrmPerson[],
  viewer: Viewer,
): ListEntry[] {
  if (!viewer || viewer.role === "candidate") return [];
  const ids = visibleIdSet(people, viewer);
  const byId = new Map(people.map((p) => [p.id, p]));
  return entries.filter((e) => ids.has(e.ownerId) && byId.get(e.ownerId)?.bizClass !== "customer");
}

/** May the viewer add to or edit `ownerId`'s list? (Themselves or a downline apprentice / IBO.) */
export function canEditListOf(people: CrmPerson[], viewer: Viewer, ownerId: string): boolean {
  if (!viewer || viewer.role === "candidate") return false;
  if (!visibleIdSet(people, viewer).has(ownerId)) return false;
  return canOwnList(people.find((p) => p.id === ownerId));
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface EntryInput {
  name: string;
  howKnown?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
}

/** Why an entry can't be saved, or null when it's fine. */
export function entryError(input: EntryInput): string | null {
  const name = input.name.trim();
  if (!name) return "Add a name.";
  if (name.length > MAX_ENTRY_NAME) return `Keep the name to ${MAX_ENTRY_NAME} characters.`;
  if ((input.howKnown?.trim().length ?? 0) > MAX_HOW_KNOWN)
    return `Keep "how you know them" to ${MAX_HOW_KNOWN} characters.`;
  if ((input.notes?.length ?? 0) > MAX_ENTRY_NOTES)
    return `Keep notes to ${MAX_ENTRY_NOTES} characters.`;
  const email = input.email?.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That email doesn't look right.";
  return null;
}

/** Trim a text field to null when empty. */
export const clean = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** An entry without a card sits in "Not contacted yet" from the day it was added. */
export function implicitCustomerCard(entry: ListEntry): CustomerCard {
  return {
    entryId: entry.id,
    column: NOT_CONTACTED,
    enteredAt: entry.createdAt,
    nextStep: null,
    nextStepDate: null,
    updatedAt: entry.createdAt,
  };
}

/** Every entry with its card (stored, or the implicit "Not contacted yet" one). */
export function entryCards(
  entries: ListEntry[],
  cards: CustomerCard[],
): { entry: ListEntry; card: CustomerCard; stored: boolean }[] {
  const byId = new Map(cards.map((c) => [c.entryId, c]));
  return entries.map((entry) => {
    const card = byId.get(entry.id);
    return card
      ? { entry, card, stored: true }
      : { entry, card: implicitCustomerCard(entry), stored: false };
  });
}

/** The band of a card's column (a deleted or unknown step counts as Contact). */
export function cardBand(column: string, steps: { id: string; band: string }[]): CustomerBand {
  if (isCustomerMilestone(column)) return column;
  const fixed = CUSTOMER_BOARD.fixed.find((f) => f.id === column);
  if (fixed) return fixed.band;
  return (steps.find((s) => s.id === column)?.band as CustomerBand | undefined) ?? "contact";
}

/** No movement for STALE_DAYS days, only while someone is being worked (not the list or outcomes). */
export function isCustomerStale(
  enteredAt: string,
  band: CustomerBand,
  today: string,
  days = STALE_DAYS,
): boolean {
  if (!isWorkingBand(band)) return false;
  return differenceInCalendarDays(parseDate(today), parseDate(dayOf(enteredAt))) >= days;
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/**
 * What a move into `band` does to the people behind the entry: reaching
 * First sale (or anything past it) makes a customer when there isn't one
 * yet; reaching On Ditto marks the customer as a subscription customer.
 */
export function moveEffects(
  entry: Pick<ListEntry, "customerId">,
  band: CustomerBand,
  customer: Pick<CrmPerson, "dittoSince"> | undefined,
): { createCustomer: boolean; setDitto: boolean } {
  const createCustomer = isSaleBand(band) && !entry.customerId;
  const setDitto = band === "on_ditto" && (createCustomer || !customer?.dittoSince);
  return { createCustomer, setDitto };
}

/** The customer a first sale makes from a list entry (owned by the list's owner). */
export function customerFromEntry(
  entry: ListEntry,
  id: string,
  today: string,
): Omit<CrmPerson, "stageHistory" | "lastUpdatedAt"> {
  return {
    id,
    name: entry.name,
    bizClass: "customer",
    ownerId: entry.ownerId,
    sponsorId: null,
    joinedDate: today,
    ...(entry.phone ? { phone: entry.phone } : {}),
    ...(entry.email ? { email: entry.email } : {}),
    ...(entry.howKnown ? { notes: `From your list: ${entry.howKnown}` } : {}),
  };
}

/** The shape reachesOf counts (a customer move's entry stands in for the person). */
export const asMoveLike = (m: CustomerMove): MoveLike => ({
  personId: m.entryId,
  ownerId: m.ownerId,
  milestone: m.band,
  movedAt: m.movedAt,
});

/** First time each entry reached each customer milestone (outcomes and start columns reach nothing). */
export const customerReaches = (moves: CustomerMove[]): Reach<CustomerMilestone>[] =>
  reachesOf(moves.map(asMoveLike), CUSTOMER_MILESTONES);

/** ISO timestamp for local noon of a day (seed and tests). */
export const noonOf = localNoon;

// ---------------------------------------------------------------------------
// Do not contact
// ---------------------------------------------------------------------------

/**
 * People hidden from every reminder: the customer and the prospect behind
 * each entry whose card is in "Do not contact".
 */
export function doNotContactIds(entries: ListEntry[], cards: CustomerCard[]): Set<string> {
  const dnc = new Set(cards.filter((c) => c.column === DO_NOT_CONTACT).map((c) => c.entryId));
  const out = new Set<string>();
  for (const e of entries) {
    if (!dnc.has(e.id)) continue;
    if (e.customerId) out.add(e.customerId);
    if (e.prospectId) out.add(e.prospectId);
  }
  return out;
}
