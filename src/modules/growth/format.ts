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
