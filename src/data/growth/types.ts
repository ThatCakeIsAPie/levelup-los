/**
 * Growth path: the milestones every IBO works through after registering
 * (docs/plans/mvp-plan-2026-10-13.md, "Growth path"). Codes are stable and
 * stored in the database (`milestone_marks.code`); labels are display only.
 */

/** Milestone codes, in path order (the order never changes). */
export const GROWTH_CODES = [
  "new_apprentice",
  "first_sale",
  "core_150",
  "core_300",
  "first_sponsor",
  "bronze_foundation",
  "3_10",
  "bronze_builder",
  "6_25",
  "6_50",
  "platinum",
  "ruby",
  "12_100",
] as const;

export type GrowthMilestoneCode = (typeof GROWTH_CODES)[number];

/** How a milestone's rule is checked. */
export type GrowthRule =
  | { kind: "registered" }
  | { kind: "first_sale" }
  /** Your own PV in one calendar month. */
  | { kind: "personal_pv"; pv: number }
  /** `legs` frontline legs each at `legPv` or more, and `groupPv` in total, in one month. */
  | { kind: "legs_pv"; legs: number; legPv: number; groupPv: number }
  /** Group PV in one calendar month. */
  | { kind: "group_pv"; pv: number }
  /** `sponsors` personal sponsors and `people` registered people in your group. */
  | { kind: "count"; sponsors: number; people: number };

export interface GrowthMilestoneDef {
  code: GrowthMilestoneCode;
  label: string;
  /** What it takes, in plain words. */
  rule: string;
  check: GrowthRule;
}

/**
 * A month's PV for one person, set by an upline from the Amway app. It
 * replaces the total of the sales logged for that month.
 */
export interface PvOverride {
  personId: string;
  /** Calendar month, "YYYY-MM". */
  month: string;
  pv: number;
  /** Who set it (person id). */
  setBy?: string;
  /** When it was set (ISO timestamp). */
  setAt: string;
}

/** A milestone an upline marked as reached by hand (e.g. history from before the app). */
export interface MilestoneMark {
  personId: string;
  code: GrowthMilestoneCode;
  /** The day it was reached, "YYYY-MM-DD". */
  reachedOn: string;
  /** Who marked it (person id). */
  markedBy?: string;
  /** When it was marked (ISO timestamp). */
  markedAt: string;
  note?: string;
}

/** How a reached milestone was found. */
export type GrowthSource = "auto" | "manual";

/** One number toward a milestone ("95 / 150 PV this month"). */
export interface ProgressPart {
  key: "pv" | "group_pv" | "legs" | "sponsors" | "people" | "sales" | "registered";
  label: string;
  current: number;
  target: number;
}

export interface GrowthLeg {
  personId: string;
  name: string;
  /** The leg's group PV this month (the frontline person and their whole line). */
  pv: number;
}

/** Live progress toward a milestone that isn't reached yet. */
export interface MilestoneProgress {
  parts: ProgressPart[];
  /** 0..1, the average of the parts (each capped at 1). */
  ratio: number;
  /** Plain summary, e.g. "95 / 150 PV this month" or "4/6 personal sponsors, 19/25 people". */
  summary: string;
  /** PV rules: the month the numbers are for ("YYYY-MM"), always the current month. */
  month?: string;
  /** PV rules: the best month so far for the rule's main number. */
  best?: { month: string; value: number } | null;
  /** Leg rules: this month's legs, highest first. */
  legs?: GrowthLeg[];
}

export interface MilestoneStatus {
  code: GrowthMilestoneCode;
  label: string;
  rule: string;
  index: number;
  /** The day it was first reached ("YYYY-MM-DD"), or null. */
  reachedOn: string | null;
  source: GrowthSource | null;
  /** The date the data shows (auto) and the hand mark, when there are any. */
  autoOn: string | null;
  mark: MilestoneMark | null;
  /**
   * Days from the previous reached milestone (in path order) to this one;
   * null when it isn't reached, it's the first, or it came before that one.
   */
  daysTaken: number | null;
  /** Unreached milestones: progress toward them right now. */
  progress: MilestoneProgress | null;
}

export interface GrowthPath {
  personId: string;
  /** Registered (apprentice or IBO). Prospects and customers have no path yet. */
  registered: boolean;
  milestones: MilestoneStatus[];
  /** Index of the milestone being worked on (the first one not reached), -1 when all are. */
  nextIndex: number;
  next: MilestoneStatus | null;
  /** The furthest milestone reached along the path, or null. */
  latest: MilestoneStatus | null;
  /** Days since the milestone before `next` was reached ("working on it for…"). */
  workingDays: number | null;
  thisMonth: {
    month: string;
    /** Your PV this month (the upline's figure when they set one). */
    pv: number;
    groupPv: number;
    /** An upline set this month's PV. */
    override: PvOverride | null;
    /** Days left in the month after today. */
    daysLeft: number;
  };
}
