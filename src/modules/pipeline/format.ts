import { differenceInCalendarDays, format } from "date-fns";
import {
  NO_BOOKING,
  bookingLabel,
  localDate,
  parseDate,
  type Booking,
  type BookingView,
  type PipelineBoard,
  type PipelineColumn,
} from "@/data";

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

/** "7pm", "6:30pm" from "19:00", "18:30". */
export function timeText(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${m ? `:${String(m).padStart(2, "0")}` : ""}${ap}`;
}

/** "Sat", "today 7pm", "was Mon" for a booked day and time. */
export function whenText(day: string | null, time: string | null, today = localDate()): string {
  if (!day) return "";
  const t = timeText(time);
  return t ? `${relDay(day, today)} ${t}` : relDay(day, today);
}

/**
 * A card's booked next step: "MG1 · Sat", "Info 2 · today 7pm"; "Next step
 * removed" when the booked column is gone. Null when nothing is booked.
 */
export function bookingText(b: BookingView | null, today = localDate()): string | null {
  if (!b) return null;
  if (b.removed || !b.column) return "Next step removed · rebook";
  const when = whenText(b.date, b.time, today);
  return when ? `${bookingLabel(b.column)} · ${when}` : bookingLabel(b.column);
}

/** The editable booking behind a card's booking view. */
export function bookingState(b: BookingView | null): Booking {
  if (!b) return NO_BOOKING;
  return { nextColumn: b.columnId, nextStepDate: b.date, nextStepTime: b.time };
}

/** Tone classes for a booked step: due today stands out, overdue in warn. */
export function bookingTone(b: BookingView | null): string {
  if (!b) return "";
  if (b.removed || b.due === "overdue") return "text-warn-ink";
  if (b.due === "today") return "text-primary-ink";
  return "text-muted-foreground";
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
