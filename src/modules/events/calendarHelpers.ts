import { useMemo } from "react";
import { formatTime, timeText, type CrmEvent, type EventCategory, type EventSeries } from "@/data";
import { categoryIcon, categoryToneClass } from "./categoryIcons";
import { formatEventRange } from "./lib";
import { calendarItems, gridEnd, gridWeeks, isMultiDay, type CalItem } from "./calendar";

/** Category colours on tokens: the icon's text colour, and a small solid dot (phone grid). */
const ICON_TEXT = {
  neutral: "text-muted-foreground",
  green: "text-primary-ink",
  blue: "text-info-ink",
  amber: "text-warn-ink",
  rose: "text-bad",
} as const;
const DOT = {
  neutral: "bg-faint",
  green: "bg-primary",
  blue: "bg-info",
  amber: "bg-amber",
  rose: "bg-bad",
} as const;

export const iconTextClass = (c: EventCategory | undefined) => ICON_TEXT[c?.tone ?? "neutral"];
export const dotClass = (c: EventCategory | undefined) => DOT[c?.tone ?? "neutral"];
export { categoryIcon, formatTime };

/** The fill and ink of a bar. A grey category gets the track fill: the weekend columns already use the inset one. */
export const barClass = (c: EventCategory | undefined) =>
  c && c.tone !== "neutral" ? categoryToneClass(c) : "bg-track text-foreground";

/** The categories by id (an event of an unknown category still draws, with the default icon). */
export function useCategoryMap(categories: EventCategory[]): Map<string, EventCategory> {
  return useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
}

/** The accessible name of an item: name, date and time; a projected one also says it repeats. */
export function itemLabel(item: CalItem): string {
  const base = `${item.name}, ${formatEventRange(item)}`;
  return item.projected ? `${base}, repeating event` : base;
}

/** The clock of a one-day item, or its dates when it runs over several days. */
export const itemWhen = (item: CalItem): string =>
  isMultiDay(item) ? formatEventRange(item) : timeText(item);

/** The grid's weeks and everything on them (stored and projected), for one category or all. */
export function useCalendarItems(
  events: CrmEvent[],
  series: EventSeries[],
  today: string,
  categoryId?: string,
) {
  const weeks = useMemo(() => gridWeeks(today), [today]);
  const items = useMemo(
    () => calendarItems(events, series, today, gridEnd(weeks), categoryId),
    [events, series, today, weeks, categoryId],
  );
  return { weeks, items };
}
