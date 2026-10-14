import { differenceInCalendarDays, format } from "date-fns";
import { localDate, parseDate, type PipelineColumn } from "@/data";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "today", "2d", "16d" — how long a card has been in its column. */
export const ageShort = (days: number) => (days === 0 ? "today" : `${days}d`);

/** "today", "1 day", "16 days". */
export const ageLong = (days: number) => (days === 0 ? "today" : plural(days, "day"));

/**
 * A next-step date relative to today: "today", "tomorrow", "Thu" (this week),
 * "Nov 8"; past dates read "was Mon" / "was Sep 30".
 */
export function relDay(day: string, today = localDate()): string {
  const d = parseDate(day);
  const diff = differenceInCalendarDays(d, parseDate(today));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "was yesterday";
  if (diff > 1 && diff < 7) return format(d, "EEE");
  if (diff < 0 && diff > -7) return `was ${format(d, "EEE")}`;
  return diff < 0 ? `was ${format(d, "MMM d")}` : format(d, "MMM d");
}

/** "MG1 Thu" from a card's next step text and date. */
export function nextStepText(text: string | null, day: string | null): string | null {
  if (!text && !day) return null;
  if (!day) return text;
  return `${text ?? "Next step"} ${relDay(day)}`;
}

/** Next step date already passed. */
export const overdue = (day: string | null) => !!day && day < localDate();

/** "Maria's step" / "Your step". */
export const stepBy = (c: PipelineColumn<string>) =>
  c.ownerName === "You" ? "Your step" : `${c.ownerName ?? "A leader"}’s step`;

/** Whole percent text. */
export const pct = (n: number | null) => (n === null ? "–" : `${n}%`);

/** "+12%" / "−13%" / "same". */
export function deltaText(change: number | null): string {
  if (change === null) return "new";
  if (change === 0) return "same";
  return change > 0 ? `+${change}%` : `−${Math.abs(change)}%`;
}

/** "Oct 9" for a registration day. */
export const shortDate = (day: string) => format(parseDate(day), "MMM d");
