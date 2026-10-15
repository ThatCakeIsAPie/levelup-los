import { format } from "date-fns";
import { growthMilestone, parseDate, type GrowthMilestoneCode } from "@/data";

/** "Oct 6" this year, "Apr 2024" before that (path dots and summaries). */
export function reachedShort(date: string): string {
  const d = parseDate(date);
  return d.getFullYear() === new Date().getFullYear() ? format(d, "MMM d") : format(d, "MMM yyyy");
}

/** "October 6, 2026". */
export const reachedLong = (date: string): string => format(parseDate(date), "MMMM d, yyyy");

/** "October" this year, "September 2025" otherwise. */
export function monthName(month: string): string {
  const d = parseDate(`${month}-01`);
  return d.getFullYear() === new Date().getFullYear() ? format(d, "MMMM") : format(d, "MMMM yyyy");
}

/** "same day", "5 days", "3 weeks", "4 months", "2 years". */
export function duration(days: number): string {
  if (days <= 0) return "same day";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 730) {
    const m = Math.round(days / 30.4);
    return m === 1 ? "1 month" : `${m} months`;
  }
  const y = Math.round(days / 365);
  return `${y} years`;
}

/** 4180 -> "4,180". */
export const pv = (n: number): string => Math.round(n).toLocaleString("en-US");

/** The milestone counts PV within one calendar month. */
export function isMonthly(code: GrowthMilestoneCode): boolean {
  const k = growthMilestone(code).check.kind;
  return k === "personal_pv" || k === "legs_pv" || k === "group_pv";
}

/** Uses your own PV (the Log a sale nudge fits). */
export function isPersonalPv(code: GrowthMilestoneCode): boolean {
  return growthMilestone(code).check.kind === "personal_pv";
}

/** "Jun 2025": a month with its year (history notes: "You first hit this in Jun 2025"). */
export const monthYear = (date: string): string => format(parseDate(date), "MMM yyyy");

/**
 * What a monthly milestone takes in one month, in a few words: "300 PV",
 * "15,000 group PV", "3 legs at 300+ PV and 2,500 group PV".
 */
export function monthlyTarget(code: GrowthMilestoneCode): string {
  const c = growthMilestone(code).check;
  switch (c.kind) {
    case "personal_pv":
      return `${pv(c.pv)} PV`;
    case "group_pv":
      return `${pv(c.pv)} group PV`;
    case "legs_pv":
      return `${c.legs} legs at ${pv(c.legPv)}+ PV and ${pv(c.groupPv)} group PV`;
    default:
      return "";
  }
}

/**
 * A headcount milestone's numbers in a few words: "6 personal sponsors and
 * 50 people".
 */
export function countTarget(code: GrowthMilestoneCode): string {
  const c = growthMilestone(code).check;
  if (c.kind !== "count") return "";
  const s = `${c.sponsors} personal ${c.sponsors === 1 ? "sponsor" : "sponsors"}`;
  return c.people > 0 ? `${s} and ${c.people} people in the group` : s;
}
