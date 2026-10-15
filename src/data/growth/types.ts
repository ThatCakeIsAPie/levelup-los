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

/**
 * How long a milestone counts as held once its rule is met
 * (docs/plans/mvp-plan-2026-10-13.md, "Growth path"):
 *  - `permanent`: once reached, it stays (New apprentice, First sale, First sponsor).
 *  - `live`: held only while the rule is met right now (the headcount
 *    milestones 3/10, 6/25, 6/50, 12/100). Dropping below un-holds it.
 *  - `monthly`: held on a day when the rule was met in that calendar month or
 *    the month before (the volume milestones: Core, Bronze, Platinum, Ruby).
 *    Met in September, it's held through October 31.
 */
export type GrowthHold = "permanent" | "live" | "monthly";

export interface GrowthMilestoneDef {
  code: GrowthMilestoneCode;
  label: string;
  /** What it takes, in plain words. */
  rule: string;
  check: GrowthRule;
  hold: GrowthHold;
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

/**
 * A milestone an upline marked by hand (e.g. history from before the app):
 * the day it was first reached. For a permanent milestone the mark counts as
 * reached; for a live or monthly one it's history only (the first-reached
 * date), never "held now".
 */
export interface MilestoneMark {
  personId: string;
  code: GrowthMilestoneCode;
  /** The day it was (first) reached, "YYYY-MM-DD". */
  reachedOn: string;
  /** Who marked it (person id). */
  markedBy?: string;
  /** When it was marked (ISO timestamp). */
  markedAt: string;
  note?: string;
}

/**
 * Milestone history the app recorded while the data showed it (store
 * `milestoneHistory`, table `milestone_history`): kept for the milestones
 * the data can forget, the ones counted from the sponsor tree (First sponsor
 * and the headcount milestones), so a later drop keeps the first-reached date
 * and the unlocks that came with it. One row per person and milestone; the
 * first date only moves earlier and the last only later.
 */
export interface MilestoneHistory {
  personId: string;
  code: GrowthMilestoneCode;
  /** The first day the data showed it reached, "YYYY-MM-DD". */
  firstReachedOn: string;
  /** The last day it was seen met, "YYYY-MM-DD" (refreshed at most monthly). */
  lastMetOn: string;
  /** Who recorded it (person id; stamped by the database). */
  recordedBy?: string;
  /** When (ISO timestamp). */
  recordedAt: string;
}

/** Where a milestone's first-reached date comes from: the data (or recorded history) or a hand mark. */
export type GrowthSource = "auto" | "manual";

/**
 * Where a person stands on a milestone today:
 *  - `held`: reached and counting now (checked on the path);
 *  - `lost`: reached before but not held now (a live or monthly milestone to
 *    earn again);
 *  - `never`: never reached.
 */
export type MilestoneState = "held" | "lost" | "never";

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
  hold: GrowthHold;
  /** Held now, earned before but not held now, or never reached. */
  state: MilestoneState;
  /** `state === "held"`: counts as reached today (checked on the path). */
  held: boolean;
  /**
   * The day it was first ever reached ("YYYY-MM-DD"), from the data, recorded
   * history or a hand mark (the earliest wins); null when never. History: it
   * doesn't say whether it's held now (`held`). Unlocks go by this.
   */
  firstReachedOn: string | null;
  /** Where `firstReachedOn` comes from. */
  source: GrowthSource | null;
  /** The first date the data (or recorded history) shows, and the hand mark, when there are any. */
  autoOn: string | null;
  mark: MilestoneMark | null;
  /**
   * Live and monthly milestones: the most recent time the rule was met. Live:
   * today while held, else the last day recorded. Monthly: the day the rule
   * was met in the most recent month that met it. Null for permanent ones and
   * when unknown.
   */
  lastMetOn: string | null;
  /**
   * Monthly milestones that are held: why. `this_month` = met this calendar
   * month; `last_month` = met only last month (it falls back on the 1st of
   * next month unless met again this month: the "hit it again" heads-up).
   */
  heldVia: "this_month" | "last_month" | null;
  /** Monthly milestones that are held: the last day they stay held without meeting the rule again. */
  heldUntil: string | null;
  /**
   * Days from the previous first-reached milestone (in path order) to this
   * one's first reach; null when never reached, it's the first, or it came
   * before that one.
   */
  daysTaken: number | null;
  /**
   * Progress toward it right now: milestones not held, and monthly ones held
   * only through last month (what it takes to keep them).
   */
  progress: MilestoneProgress | null;
}

export interface GrowthPath {
  personId: string;
  /** Registered (apprentice or IBO). Prospects and customers have no path yet. */
  registered: boolean;
  milestones: MilestoneStatus[];
  /** Index of the milestone being worked on (the first one not held now, in path order), -1 when all are. */
  nextIndex: number;
  next: MilestoneStatus | null;
  /** The furthest milestone held now along the path, or null. */
  latest: MilestoneStatus | null;
  /**
   * Days since the milestone before `next` was first reached ("working on it
   * for…"); null when `next` was reached before (it's being earned again).
   */
  workingDays: number | null;
  /**
   * Monthly milestones held only through last month, in path order: met last
   * month, not yet this month ("hit it again this month to keep it").
   */
  keepUp: MilestoneStatus[];
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
