import { differenceInCalendarDays, format } from "date-fns";
import { localDate, parseDate, type PipelineBoard, type PipelineColumn } from "@/data";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "today", "2d", "16d" — how long a card has been in its column. */
export const ageShort = (days: number) => (days === 0 ? "today" : `${days}d`);

/** "today", "1 day", "16 days". */
export const ageLong = (days: number) => (days === 0 ? "today" : plural(days, "day"));

/** "7pm", "6:30pm" from "19:00", "18:30". */
export function timeText(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${ap}`;
}

/** "Oct 9" for a registration day. */
export const shortDate = (day: string) => format(parseDate(day), "MMM d");

/** "Nov 19" or "Nov 19 9am": a task's due date, with its time when it has one. */
export function dueText(day: string, time: string | null): string {
  const t = timeText(time);
  return t ? `${shortDate(day)} ${t}` : shortDate(day);
}

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

/**
 * People in the pipeline now: the cards in `bands` (each band's milestone
 * column and the steps after it), how many are `me`'s, and whether the board
 * mixes yours with other people's (as in `ownCards`).
 */
export function inPipeline(
  board: PipelineBoard<string>,
  bands: readonly string[],
  me: string | null,
): { total: number; byBand: { band: string; count: number }[]; mine: number; mixed: boolean } {
  let mine = 0;
  let others = 0;
  const byBand = bands.map((band) => {
    const b = board.bands.find((x) => x.milestone === band);
    let count = 0;
    for (const c of b?.columns ?? [])
      for (const card of c.cards) {
        count++;
        if (card.ownerId === me) mine++;
        else others++;
      }
    return { band, count };
  });
  return { total: mine + others, byBand, mine, mixed: mine > 0 && others > 0 };
}
