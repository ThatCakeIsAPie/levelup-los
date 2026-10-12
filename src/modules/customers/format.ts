import { format } from "date-fns";
import { parseDate } from "@/data";

/** "Sep 22" this year, "Sep 22, 2025" otherwise. */
export function shortDate(d: string): string {
  const date = parseDate(d);
  return format(date, date.getFullYear() === new Date().getFullYear() ? "MMM d" : "MMM d, yyyy");
}

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$1,240" (whole dollars). */
export const money0 = (n: number) => usd0.format(n);

/** "Day" / "days" for a count. */
export const dayWord = (n: number) => (n === 1 ? "day" : "days");
