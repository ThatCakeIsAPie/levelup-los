import { format } from "date-fns";
import { parseDate } from "@/data";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$200.00" */
export const money = (n: number) => usd.format(n);

/** "Nov 7" this year, "Nov 7, 2025" otherwise. Accepts "YYYY-MM-DD" or an ISO timestamp. */
export function shortDate(d: string): string {
  const date = parseDate(d);
  return format(date, date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
}

/** "Oct 12, 2026" from an ISO timestamp or date. */
export const fullDate = (d: string) => format(parseDate(d), "MMM d, yyyy");
