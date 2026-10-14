import { differenceInCalendarDays, format } from "date-fns";
import { localDate, parseDate, type PipelineBoard, type PipelineColumn } from "@/data";

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

/**
 * Your share of a board: how many cards in progress are `me`'s, and whether
 * other people's cards are on it too. Only a mixed board marks yours (on
 * "My prospects" or a downline leader's team there is nothing to tell apart).
 */
export function ownCards(
  board: PipelineBoard<string>,
  me: string,
): { mine: number; mixed: boolean } {
  let mine = 0;
  let others = 0;
  const count = (ownerId: string) => {
    if (ownerId === me) mine++;
    else others++;
  };
  for (const b of board.bands)
    for (const c of b.columns) for (const card of c.cards) count(card.ownerId);
  let regMine = 0;
  for (const r of board.registered.cards) {
    if (r.ownerId === me) regMine++;
    else others++;
  }
  return { mine, mixed: mine + regMine > 0 && others > 0 };
}
