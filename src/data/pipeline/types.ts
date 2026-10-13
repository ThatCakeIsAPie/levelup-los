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

/** Column header label (with the team's own name for it). */
export const MILESTONE_COLUMN_LABEL: Record<MilestoneCode, string> = {
  contact: "Contact made",
  first_meeting: "First meeting (MG1)",
  first_plan: "First plan (Info 1)",
  registered: "Registered",
};

/** `pipeline_steps`: a leader-defined step between two milestones. */
export interface PipelineStep {
  id: string;
  /** The leader who defined it; their whole downline inherits it. */
  ownerId: string;
  band: StepBand;
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
  /** Short next-step text ("MG1", "Call", "Bring to Fall Weekend"). */
  nextStep: string | null;
  /** "YYYY-MM-DD" */
  nextStepDate: string | null;
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
  /** The milestone band of `to` (also the fallback when `to` is deleted). */
  milestone: MilestoneCode;
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

/** Every pipeline table, as the browser store keeps it. */
export interface PipelineData {
  steps: PipelineStep[];
  hides: StepHide[];
  cards: PipelineCard[];
  moves: PipelineMove[];
  settings: TeamSetting[];
  shares: StatShare[];
  requests: StatRequest[];
}

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
export interface PipelineColumn {
  id: string;
  band: MilestoneCode;
  kind: "milestone" | "step";
  label: string;
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
