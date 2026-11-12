/**
 * Your list and the customer pipeline: the tables the browser store keeps
 * (one array per database table) and the board layout.
 *
 * Model (docs/plans/mvp-plan-2026-10-13.md, "Your list" and "Customer
 * pipeline"):
 *  - `ListEntry`: a name on someone's list (how they know them, phone/email,
 *    notes, warm/hot). Entries are not people: a list can hold dozens of
 *    names that never become anything, and they must not appear on the People
 *    page, the mind map or the recruiting board. The owner and their uplines
 *    see and edit them (like the owner's other data); crosslines never do.
 *    An entry links to the people it became: `customerId` (made by the first
 *    sale) and `prospectId` (put on the recruiting pipeline). One name can be
 *    on both boards.
 *  - The board is the recruiting board's layout with other bands
 *    (`CUSTOMER_BOARD`): a start column, four fixed milestones (Contact →
 *    First meeting → First sale → On Ditto), leader steps between them
 *    (inherited down the sponsor line, hidden or added like recruiting
 *    steps), and three outcome columns (Referral source, Not interested,
 *    Do not contact).
 *  - One card per entry (`CustomerCard`); an entry without one sits in "Not
 *    contacted yet". Every move is recorded (`CustomerMove`) and is the only
 *    source of activity and conversions, as on the recruiting board.
 *  - Reaching First sale makes the entry a customer (a `people` row owned by
 *    the list's owner); reaching On Ditto marks that customer as a
 *    subscription customer (`CrmPerson.dittoSince`). "Do not contact" hides
 *    the linked people from every reminder.
 */
import type { ContactRating } from "../rating";
import {
  DO_NOT_CONTACT,
  NOT_CONTACTED,
  NOT_INTERESTED,
  REFERRAL_SOURCE,
  REFERRAL_SOURCE_HINT,
  REFERRAL_SOURCE_LABEL,
  type BoardDef,
  type PipelineStep,
  type StepHide,
} from "../pipeline/types";

export type CustomerMilestone = "contact" | "first_meeting" | "first_sale" | "on_ditto";
/** Board bands: the start columns, the four milestones, the outcomes. */
export type CustomerBand = "start" | CustomerMilestone | "out";
/** Bands that can hold leader steps (nothing after On Ditto). */
export type CustomerStepBand = Exclude<CustomerMilestone, "on_ditto">;

export const CUSTOMER_MILESTONES: readonly CustomerMilestone[] = [
  "contact",
  "first_meeting",
  "first_sale",
  "on_ditto",
];
export const CUSTOMER_STEP_BANDS: readonly CustomerStepBand[] = [
  "contact",
  "first_meeting",
  "first_sale",
];

export const CUSTOMER_MILESTONE_LABEL: Record<CustomerMilestone, string> = {
  contact: "Contact",
  first_meeting: "First meeting",
  first_sale: "First sale",
  on_ditto: "On Ditto",
};

/** The fixed start and outcome columns (the same ids as on the recruiting board). */
export { DO_NOT_CONTACT, NOT_CONTACTED, NOT_INTERESTED, REFERRAL_SOURCE };
export type FixedCustomerColumn =
  typeof NOT_CONTACTED | typeof REFERRAL_SOURCE | typeof NOT_INTERESTED | typeof DO_NOT_CONTACT;

export const FIXED_CUSTOMER_COLUMNS = [
  { id: NOT_CONTACTED, band: "start", label: "Not contacted yet", hint: "From your list" },
  { id: REFERRAL_SOURCE, band: "out", label: REFERRAL_SOURCE_LABEL, hint: REFERRAL_SOURCE_HINT },
  { id: NOT_INTERESTED, band: "out", label: "Not interested", hint: "Revisit in 6 months" },
  { id: DO_NOT_CONTACT, band: "out", label: "Do not contact", hint: "Hidden from reminders" },
] as const satisfies readonly {
  id: FixedCustomerColumn;
  band: CustomerBand;
  label: string;
  hint: string;
}[];

export const CUSTOMER_BAND_LABEL: Record<CustomerBand, string> = {
  start: "Start",
  ...CUSTOMER_MILESTONE_LABEL,
  out: "Not now",
};

export const CUSTOMER_BOARD: BoardDef<CustomerBand> = {
  kind: "customer",
  bands: [
    { id: "start", kind: "start", label: CUSTOMER_BAND_LABEL.start },
    ...CUSTOMER_MILESTONES.map((m) => ({
      id: m,
      kind: "milestone" as const,
      label: CUSTOMER_MILESTONE_LABEL[m],
    })),
    { id: "out", kind: "outcome", label: CUSTOMER_BAND_LABEL.out },
  ],
  milestones: CUSTOMER_MILESTONES,
  stepBands: CUSTOMER_STEP_BANDS,
  milestoneColumnLabel: CUSTOMER_MILESTONE_LABEL,
  fixed: FIXED_CUSTOMER_COLUMNS,
  reserved: [
    ...Object.values(CUSTOMER_MILESTONE_LABEL),
    ...FIXED_CUSTOMER_COLUMNS.map((c) => c.label),
  ],
};

/** The starting steps a leader's team gets (seeded for the demo). */
export const STARTER_CUSTOMER_STEPS: { band: CustomerStepBand; label: string }[] = [
  { band: "contact", label: "Sampled product" },
  { band: "first_meeting", label: "Product meeting 2+" },
  { band: "first_sale", label: "Sample box sale" },
];

/** Hot / Warm / Cold (src/data/rating.ts). */
export type ListRating = ContactRating;

/** `list_entries`: a name on someone's list. */
export interface ListEntry {
  id: string;
  /** Whose list (an apprentice or IBO). */
  ownerId: string;
  name: string;
  /** "Work friend", "Gym", "Coffee shop". */
  howKnown: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  rating: ListRating | null;
  /** The customer this name became (their first sale). */
  customerId: string | null;
  /** The prospect this name became on the recruiting pipeline. */
  prospectId: string | null;
  /** Who referred this name: a person (src/data/referrals; at most one of the two). */
  referredBy: string | null;
  /** …or another name on a list (a referral source on the customer board). */
  referredByEntry: string | null;
  /** Who added it (the owner, or an upline helping them). */
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** `customer_steps`: a leader's step between two customer milestones. */
export type CustomerStep = PipelineStep<CustomerStepBand>;

/** `customer_cards`: one per list entry on the board. */
export interface CustomerCard {
  entryId: string;
  /** A milestone code, a fixed column id or a step id. */
  column: string;
  /** When the card entered its current column (ISO timestamp). */
  enteredAt: string;
  /** The booked next step: a column on the list owner's board, or null (see ../pipeline/booking.ts). */
  nextColumn: string | null;
  /** "YYYY-MM-DD" */
  nextStepDate: string | null;
  /** "HH:MM", optional. */
  nextStepTime: string | null;
  /** A free-text note on the card (at most MAX_CARD_NOTE characters). */
  note: string | null;
  updatedAt: string;
}

/**
 * `customer_moves`: every move. `entryId` is kept after the entry is removed
 * (the activity still happened), so it is a plain id, not a link.
 */
export interface CustomerMove {
  id: string;
  entryId: string;
  /** Whose list it was on. */
  ownerId: string;
  /** Column before the move; null when the move created the card. */
  from: string | null;
  to: string;
  /** The band of `to` (also the fallback when `to` is a deleted step). */
  band: CustomerBand;
  movedAt: string;
  movedBy: string;
  /** The customer this move created (reaching First sale); undo removes them. */
  createdCustomerId: string | null;
  /** This move marked the customer as on Ditto; undo clears it. */
  setDitto: boolean;
}

/** Every customer-pipeline table, as the browser store keeps it. */
export interface CustomerPipelineData {
  entries: ListEntry[];
  steps: CustomerStep[];
  hides: StepHide[];
  cards: CustomerCard[];
  moves: CustomerMove[];
}

/** Longest name, "how you know them" and notes the list accepts. */
export const MAX_ENTRY_NAME = 80;
export const MAX_HOW_KNOWN = 60;
export const MAX_ENTRY_NOTES = 1000;
