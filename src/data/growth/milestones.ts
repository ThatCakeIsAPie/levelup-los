import type { GrowthHold, GrowthMilestoneCode, GrowthMilestoneDef } from "./types";

/**
 * The growth path, in order (docs/plans/mvp-plan-2026-10-13.md). More
 * milestones can be added between these later; the order of these stays.
 * `hold` says how long each counts once met (GrowthHold): New apprentice,
 * First sale and First sponsor are permanent; the headcount milestones are
 * live; the volume milestones are held for the month after.
 */
export const GROWTH_MILESTONES: readonly GrowthMilestoneDef[] = [
  {
    code: "new_apprentice",
    label: "New apprentice",
    rule: "Register the business",
    check: { kind: "registered" },
    hold: "permanent",
  },
  {
    code: "first_sale",
    label: "First sale",
    rule: "The first sale to a customer is logged",
    check: { kind: "first_sale" },
    hold: "permanent",
  },
  {
    code: "core_150",
    label: "Core 150",
    rule: "150 personal PV in one calendar month",
    check: { kind: "personal_pv", pv: 150 },
    hold: "monthly",
  },
  {
    code: "core_300",
    label: "Core 300",
    rule: "300 personal PV in one calendar month",
    check: { kind: "personal_pv", pv: 300 },
    hold: "monthly",
  },
  {
    code: "first_sponsor",
    label: "First sponsor",
    rule: "The first personally sponsored person registers",
    check: { kind: "count", sponsors: 1, people: 0 },
    hold: "permanent",
  },
  {
    code: "bronze_foundation",
    label: "Bronze foundation",
    rule: "3 legs at 150 PV or more each, and 600 group PV in total, in the same month",
    check: { kind: "legs_pv", legs: 3, legPv: 150, groupPv: 600 },
    hold: "monthly",
  },
  {
    code: "3_10",
    label: "3/10",
    rule: "3 registered personal sponsors and 10 registered people in the group in total (not counting the IBO themselves; prospects don't count)",
    check: { kind: "count", sponsors: 3, people: 10 },
    hold: "live",
  },
  {
    code: "bronze_builder",
    label: "Bronze builder",
    rule: "3 legs at 300 PV or more each, and 2,500 group PV in total, in the same month",
    check: { kind: "legs_pv", legs: 3, legPv: 300, groupPv: 2500 },
    hold: "monthly",
  },
  {
    code: "6_25",
    label: "6/25",
    rule: "6 registered personal sponsors and 25 registered people in the group in total",
    check: { kind: "count", sponsors: 6, people: 25 },
    hold: "live",
  },
  {
    code: "6_50",
    label: "6/50",
    rule: "6 registered personal sponsors and 50 registered people in the group in total",
    check: { kind: "count", sponsors: 6, people: 50 },
    hold: "live",
  },
  {
    code: "platinum",
    label: "7,500 Platinum",
    rule: "7,500 group PV in one calendar month",
    check: { kind: "group_pv", pv: 7500 },
    hold: "monthly",
  },
  {
    code: "ruby",
    label: "Ruby",
    rule: "15,000 group PV in one calendar month",
    check: { kind: "group_pv", pv: 15000 },
    hold: "monthly",
  },
  {
    code: "12_100",
    label: "12/100",
    rule: "12 registered personal sponsors and 100 registered people in the group in total",
    check: { kind: "count", sponsors: 12, people: 100 },
    hold: "live",
  },
];

const BY_CODE = new Map(GROWTH_MILESTONES.map((m) => [m.code, m]));

/** The definition of a milestone. */
export function growthMilestone(code: GrowthMilestoneCode): GrowthMilestoneDef {
  return BY_CODE.get(code)!;
}

/** Display label of a milestone code ("3/10", "7,500 Platinum"). */
export function growthLabel(code: GrowthMilestoneCode): string {
  return BY_CODE.get(code)?.label ?? code;
}

/** Position on the path (0 = New apprentice). */
export function growthIndex(code: GrowthMilestoneCode): number {
  return GROWTH_MILESTONES.findIndex((m) => m.code === code);
}

/** How long a milestone counts once met (permanent, live, monthly). */
export function growthHold(code: GrowthMilestoneCode): GrowthHold {
  return BY_CODE.get(code)?.hold ?? "permanent";
}

/** True for a known milestone code. */
export function isGrowthCode(code: string): code is GrowthMilestoneCode {
  return BY_CODE.has(code as GrowthMilestoneCode);
}

/**
 * Group PV counts your own PV too, as in Amway's plan (group PV = your PV plus
 * your downline's). People counts never include you.
 */
export const GROUP_PV_INCLUDES_OWN = true;
