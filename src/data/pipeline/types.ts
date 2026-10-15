/**
 * Recruiting pipeline: the tables the browser store keeps (one array per
 * future database table) and the shapes the hooks return.
 *
 * Model (docs/plans/messaging-and-backend-plan-2026-10-12.md, "Pipeline and
 * conversions"):
 *  - Four fixed milestones (MILESTONES). Nobody renames, removes or reorders
 *    them; they are not rows anywhere, just codes.
 *  - Steps between milestones are rows owned by a leader (`PipelineStep`).
 *    A step belongs to the band of the milestone before it. Everyone sees the
 *    steps of their whole sponsor chain (inheritance), can hide inherited ones
 *    for their own team (`StepHide`) and add their own.
 *  - A card per prospect on the board (`PipelineCard`); the column is a
 *    milestone code or a step id.
 *  - Every move is recorded (`PipelineMove`) and is the source of truth for
 *    activity ("happened this month") and conversions.
 */

export type MilestoneCode = "contact" | "first_meeting" | "first_plan" | "registered";

/** The four milestones, in order. */
export const MILESTONES: readonly MilestoneCode[] = [
  "contact",
  "first_meeting",
  "first_plan",
  "registered",
];

/** Bands that can hold leader steps (nothing comes after Registered). */
export type StepBand = Exclude<MilestoneCode, "registered">;
export const STEP_BANDS: readonly StepBand[] = ["contact", "first_meeting", "first_plan"];

export const MILESTONE_LABEL: Record<MilestoneCode, string> = {
  contact: "Contact made",
  first_meeting: "First meeting",
  first_plan: "First plan",
  registered: "Registered",
};

/** The fixed start and outcome columns (the customer board's, with the same ids). */
export const NOT_CONTACTED = "not_contacted";
export const NOT_INTERESTED = "not_interested";
export const DO_NOT_CONTACT = "do_not_contact";

/** Board bands: the start column, the four milestones, the outcomes. */
export type RecruitingBand = "start" | MilestoneCode | "out";

export const FIXED_RECRUITING_COLUMNS = [
  { id: NOT_CONTACTED, band: "start", label: "Not contacted yet", hint: "Haven't reached out" },
  { id: NOT_INTERESTED, band: "out", label: "Not interested", hint: "Revisit in 6 months" },
  { id: DO_NOT_CONTACT, band: "out", label: "Do not contact", hint: "Hidden from reminders" },
] as const satisfies readonly { id: string; band: RecruitingBand; label: string; hint: string }[];

export const RECRUITING_BAND_LABEL: Record<RecruitingBand, string> = {
  start: "Start",
  contact: "Contact made",
  first_meeting: "First meeting",
  first_plan: "First plan",
  registered: "Registered",
  out: "Not now",
};

/** Column header label (with the team's own name for it). */
export const MILESTONE_COLUMN_LABEL: Record<MilestoneCode, string> = {
  contact: "Contact made",
  first_meeting: "First meeting (MG1)",
  first_plan: "First plan (Info 1)",
  registered: "Registered",
};

/**
 * `pipeline_steps` (and `customer_steps` on the customer board): a
 * leader-defined step between two milestones.
 */
export interface PipelineStep<B extends string = StepBand> {
  id: string;
  /** The leader who defined it; their whole downline inherits it. */
  ownerId: string;
  band: B;
  label: string;
  /** Order among the owner's own steps in this band (ascending). */
  position: number;
  createdAt: string;
}

/** `pipeline_step_hides`: `personId` hides an inherited step for their team. */
export interface StepHide {
  personId: string;
  stepId: string;
  createdAt: string;
}

/** `pipeline_cards`: one per prospect on the board. */
export interface PipelineCard {
  personId: string;
  /** A milestone code or a step id. */
  column: string;
  /** When the card entered its current column (ISO timestamp). */
  enteredAt: string;
  /**
   * The booked next step: a column on the owner's board (after the current
   * one) the card moves into next, or null. See ./booking.ts.
   */
  nextColumn: string | null;
  /** "YYYY-MM-DD": when the next step is booked for. */
  nextStepDate: string | null;
  /** "HH:MM" (24-hour), optional. */
  nextStepTime: string | null;
  /** A free-text note on the card (at most MAX_CARD_NOTE characters). */
  note: string | null;
  hot: boolean;
  /** Where you met ("Gym", "Referral"). */
  source: string | null;
  /** Taken off the board (not now / said no). The person stays a prospect. */
  droppedAt: string | null;
  updatedAt: string;
}

/**
 * `pipeline_moves`: every move. `personId` is kept after the person is
 * deleted (the activity still happened), so it is a plain id, not a link.
 */
export interface PipelineMove {
  id: string;
  personId: string;
  /** Whose prospect it was when it moved (their sponsor). */
  ownerId: string;
  /** Column before the move; null when the card was created. */
  from: string | null;
  to: string;
  /**
   * The band of `to` (also the fallback when `to` is deleted): a milestone,
   * or "start" / "out" for the fixed columns, which reach nothing.
   */
  milestone: RecruitingBand;
  movedAt: string;
  movedBy: string;
}

/** Milestone-to-milestone conversion targets, whole percents. */
export interface ConversionTargets {
  contactToMeeting: number;
  meetingToPlan: number;
  planToRegistered: number;
}

/** `pipeline_team_settings`: a leader's goals for their team (null = inherit). */
export interface TeamSetting {
  personId: string;
  mg1Goal: number | null;
  targets: ConversionTargets | null;
  updatedAt: string;
}

/** `stat_shares`: `ownerId` lets `viewerId` see their per-person numbers. */
export interface StatShare {
  id: string;
  ownerId: string;
  viewerId: string;
  createdAt: string;
}

export type StatRequestStatus = "pending" | "approved" | "declined";

/** `stat_requests`: `requesterId` asks to see `ownerId`'s numbers. */
export interface StatRequest {
  id: string;
  requesterId: string;
  ownerId: string;
  status: StatRequestStatus;
  createdAt: string;
  decidedAt: string | null;
}

/** Why a booked next step was cancelled (Home's "Cancel" and the card sheets). */
export type CancelReason =
  "they_cancelled" | "no_show" | "unreachable" | "not_interested" | "other";

/**
 * `pipeline_step_cancellations`: a booked next step that was called off, on
 * either board, kept for stats (no-show rates). The booking itself is
 * cleared from the card; the card's note stays.
 */
export interface StepCancellation {
  id: string;
  board: BoardKind;
  /** The prospect's person id (recruiting) or the list entry id (customer board). */
  cardId: string;
  /** Whose card it was (the prospect's sponsor, or the list's owner). */
  ownerId: string;
  /** The booked column. */
  column: string;
  /** "YYYY-MM-DD" the step was booked for. */
  bookedDate: string | null;
  /** "HH:MM", when a time was booked. */
  bookedTime: string | null;
  reason: CancelReason;
  /** "Other…": the reason in their words (required then, at most MAX_CANCEL_TEXT). */
  reasonText: string | null;
  cancelledAt: string;
  cancelledBy: string;
}

/** Every pipeline table, as the browser store keeps it. */
export interface PipelineData {
  steps: PipelineStep[];
  hides: StepHide[];
  cards: PipelineCard[];
  moves: PipelineMove[];
  settings: TeamSetting[];
  shares: StatShare[];
  requests: StatRequest[];
  /** Cancelled next steps on both boards. */
  cancellations: StepCancellation[];
}

/** Longest card note. */
export const MAX_CARD_NOTE = 500;
/** Longest "Other…" cancellation reason. */
export const MAX_CANCEL_TEXT = 200;

export const DEFAULT_MG1_GOAL = 80;
export const DEFAULT_TARGETS: ConversionTargets = {
  contactToMeeting: 30,
  meetingToPlan: 45,
  planToRegistered: 30,
};
/** Days without movement or contact before a card is flagged. */
export const STALE_DAYS = 14;
/** Fewer people than this at a step shows "–" instead of a rate. */
export const MIN_SAMPLE = 10;

/** One column of the board as a given person sees it. */
export interface PipelineColumn<B extends string = RecruitingBand> {
  id: string;
  band: B;
  /** "fixed": a start or outcome column ("Not contacted yet", "Do not contact"). */
  kind: "milestone" | "step" | "fixed";
  label: string;
  /** Fixed columns: a short line under the name ("From your list"). */
  hint?: string;
  /** Steps: the leader who defined it. */
  ownerId?: string;
  /** Steps: their first name ("Maria"), "You" for your own (filled by the hooks). */
  ownerName?: string;
}

export type TransitionKey = keyof ConversionTargets;

export const TRANSITIONS: { key: TransitionKey; from: MilestoneCode; to: MilestoneCode }[] = [
  { key: "contactToMeeting", from: "contact", to: "first_meeting" },
  { key: "meetingToPlan", from: "first_meeting", to: "first_plan" },
  { key: "planToRegistered", from: "first_plan", to: "registered" },
];

export type RateTone = "good" | "warn" | "bad";

/** Whose board: everyone you see, your own prospects, or one downline leader's team. */
export type PipelineScope = "team" | "mine" | `leader:${string}`;

// ---------------------------------------------------------------------------
// Board layouts (the recruiting board, and the customer board in
// src/data/customerPipeline): the same board UI and rules, different bands.
// ---------------------------------------------------------------------------

export type BoardKind = "recruiting" | "customer";

/** One band of a board, in board order. */
export interface BoardBandDef<B extends string = string> {
  id: B;
  /**
   * "milestone": a fixed milestone column plus the leader steps after it.
   * "start" / "outcome": fixed columns before the first milestone or after
   * the last ("Not contacted yet", "Do not contact").
   */
  kind: "start" | "milestone" | "outcome";
  label: string;
}

/** A fixed start or outcome column. */
export interface FixedColumnDef<B extends string = string> {
  id: string;
  band: B;
  label: string;
  hint: string;
}

export interface BoardDef<B extends string = MilestoneCode> {
  kind: BoardKind;
  /** Every band, in board order. */
  bands: readonly BoardBandDef<B>[];
  /** The milestones, in order (what counts as "reached"). */
  milestones: readonly B[];
  /** Bands that can hold leader steps. */
  stepBands: readonly B[];
  /** Column header of each milestone. */
  milestoneColumnLabel: Partial<Record<B, string>>;
  /** Start and outcome columns. */
  fixed: readonly FixedColumnDef<B>[];
  /** Names a step can't take (milestones and fixed columns). */
  reserved: readonly string[];
}

/**
 * The recruiting board: "Not contacted yet", four milestones with steps after
 * the first three, then "Not interested" and "Do not contact" (as on the
 * customer board).
 */
export const RECRUITING_BOARD: BoardDef<RecruitingBand> = {
  kind: "recruiting",
  bands: [
    { id: "start", kind: "start", label: RECRUITING_BAND_LABEL.start },
    ...MILESTONES.map((m) => ({ id: m, kind: "milestone" as const, label: MILESTONE_LABEL[m] })),
    { id: "out", kind: "outcome", label: RECRUITING_BAND_LABEL.out },
  ],
  milestones: MILESTONES,
  stepBands: STEP_BANDS,
  milestoneColumnLabel: MILESTONE_COLUMN_LABEL,
  fixed: FIXED_RECRUITING_COLUMNS,
  reserved: [...Object.values(MILESTONE_LABEL), ...FIXED_RECRUITING_COLUMNS.map((c) => c.label)],
};
