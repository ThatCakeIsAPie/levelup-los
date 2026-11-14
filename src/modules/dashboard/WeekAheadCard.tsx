import { Link } from "@tanstack/react-router";
import { useMemo, type CSSProperties } from "react";
import { SectionCard } from "@/components/brand";
import {
  localDate,
  useAllEventCategories,
  useEvents,
  useEventSeriesList,
  type EventCategory,
} from "@/data";
import { weekdayOf } from "@/data/recurrence/rule";
import { cn } from "@/lib/utils";
import {
  dayLabel,
  dayOfMonth,
  shortDay,
  weekAhead,
  weekdayDay,
  WEEKDAY_NAMES,
  WEEK_AHEAD_SHOWN,
  type CalItem,
  type Segment,
  type WeekLayout,
} from "@/modules/events/calendar";
import { useCategoryMap } from "@/modules/events/calendarHelpers";
import { EntryView, ItemRow } from "@/modules/events/calendarParts";

const LABEL_H = 28;
const PAD_B = 8;

/** Where "+N more" and the title's action go: the events page's calendar. */
const CALENDAR = { to: "/events", search: { view: "calendar" } } as const;

/**
 * Home's "The week ahead": the seven days starting today, each with its events, laid out and
 * drawn by the events calendar's own code (`weekAhead` over `layoutWeek`, `EntryView`,
 * `ItemRow`; repeating events included as projected occurrences). It is the team's events as the
 * calendar shows them, all categories, and shows nothing about a person: event names, times,
 * category icons. Seven day columns when there is room, otherwise (phones, or the card in the
 * narrow right-hand column) a list with one row per day that has events. A week with nothing
 * in it is just the title row and the link.
 */
export function WeekAheadCard({ compact }: { compact: boolean }) {
  const events = useEvents();
  const series = useEventSeriesList();
  const categories = useAllEventCategories();
  const byId = useCategoryMap(categories);
  const today = localDate();
  const week = useMemo(() => weekAhead(events, series, today), [events, series, today]);
  const empty = week.perDay.every((d) => d.length === 0);

  return (
    <SectionCard
      title="The week ahead"
      action={
        <Link {...CALENDAR} className="text-primary hover:underline">
          Calendar
        </Link>
      }
    >
      {empty ? null : compact ? (
        <DayList week={week} today={today} byId={byId} />
      ) : (
        <DayColumns week={week} today={today} byId={byId} />
      )}
    </SectionCard>
  );
}

/** What a day header says: "Sat 14", or "Sat" and the month on the 1st. */
function dayName(day: string): string {
  return WEEKDAY_NAMES[weekdayOf(day)];
}

/** The accessible name of a day: "Today, Sat, Nov 14". */
const dayAria = (day: string, today: string) =>
  `${day === today ? "Today, " : ""}${weekdayDay(day)}${day.endsWith("-01") ? `, ${day.slice(0, 4)}` : ""}`;

function MoreLink({
  count,
  date,
  className,
  style,
}: {
  count: number;
  date: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Link
      {...CALENDAR}
      style={style}
      aria-label={`+${count} more, ${weekdayDay(date)}`}
      className={cn(
        "truncate rounded px-1.5 text-left text-[12px] font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      +{count} more
    </Link>
  );
}

/** Seven day columns: a header per day and the calendar's rows under it. */
function DayColumns({
  week,
  today,
  byId,
}: {
  week: WeekLayout;
  today: string;
  byId: Map<string, EventCategory>;
}) {
  const style: CSSProperties = {
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gridTemplateRows: `${LABEL_H}px repeat(${week.slots}, auto) ${PAD_B}px`,
  };
  // Tab order: day by day, each day's rows top to bottom, then its "+N more".
  const byColumn = week.days.map((_, c) =>
    week.segments.filter((s: Segment) => s.col0 === c).sort((a, b) => a.lane - b.lane),
  );
  return (
    <div
      className="relative grid min-h-[7.5rem] overflow-hidden rounded-lg border border-line"
      style={style}
    >
      {week.days.map((day, c) => {
        const label = dayLabel(day, today);
        const weekend = weekdayOf(day) === 0 || weekdayOf(day) === 6;
        return (
          <div
            key={day}
            data-day={day}
            className={cn(
              "border-r border-line last:border-r-0",
              label.kind === "today"
                ? "bg-primary-soft"
                : weekend
                  ? "bg-surface-2"
                  : "bg-transparent",
            )}
            style={{ gridColumn: c + 1, gridRow: "1 / -1" }}
          />
        );
      })}
      {week.days.map((day, c) => {
        const label = dayLabel(day, today);
        return (
          <h3
            key={`h${day}`}
            aria-label={dayAria(day, today)}
            className="pointer-events-none z-10 m-0 flex min-w-0 items-center justify-between gap-1 px-2 text-[12px] leading-7"
            style={{ gridColumn: c + 1, gridRow: 1 }}
          >
            <span
              className={cn(
                "truncate text-[11px] font-bold uppercase tracking-[0.06em]",
                label.kind === "today" ? "text-primary-ink" : "text-muted-foreground",
              )}
            >
              {dayName(day)}
            </span>
            {label.kind === "month" ? (
              <span className="truncate bg-primary px-1 font-bold tabular-nums text-primary-foreground">
                {shortDay(day)}
              </span>
            ) : (
              <span
                className={cn(
                  "tabular-nums",
                  label.kind === "today" ? "font-bold text-primary-ink" : "font-semibold",
                )}
              >
                {dayOfMonth(day)}
              </span>
            )}
          </h3>
        );
      })}
      {byColumn.flatMap((segs, c) => [
        ...segs.map((s) => (
          <EntryView
            key={s.item.key}
            seg={s}
            category={byId.get(s.item.categoryId)}
            today={today}
            tabbable
            narrow
          />
        )),
        week.hidden[c] > 0 ? (
          <MoreLink
            key={`m${c}`}
            count={week.hidden[c]}
            date={week.days[c]}
            className="relative z-10 mx-1 self-center py-0.5 leading-5"
            style={{ gridColumn: c + 1, gridRow: week.slots + 1 }}
          />
        ) : null,
      ])}
    </div>
  );
}

/** One row per day that has events: the day on the left, its events on the right. */
function DayList({
  week,
  today,
  byId,
}: {
  week: WeekLayout;
  today: string;
  byId: Map<string, EventCategory>;
}) {
  return (
    <ul className="grid">
      {week.days.map((day, c) => {
        const items: CalItem[] = week.perDay[c];
        if (items.length === 0) return null;
        const label = dayLabel(day, today);
        const more = items.length - WEEK_AHEAD_SHOWN;
        return (
          <li
            key={day}
            data-day={day}
            className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-2 border-t border-line py-2 first:border-t-0 first:pt-0 last:pb-0"
          >
            <h3
              aria-label={dayAria(day, today)}
              className={cn(
                "m-0 grid h-fit content-start justify-items-center rounded-md px-1 py-1 text-center",
                label.kind === "today" && "bg-primary-soft",
              )}
            >
              <span
                className={cn(
                  "text-[11px] font-bold uppercase leading-4 tracking-[0.06em]",
                  label.kind === "today" ? "text-primary-ink" : "text-muted-foreground",
                )}
              >
                {dayName(day)}
              </span>
              {label.kind === "month" ? (
                <span className="bg-primary px-1 text-[12px] font-bold leading-5 tabular-nums text-primary-foreground">
                  {shortDay(day)}
                </span>
              ) : (
                <span
                  className={cn(
                    "text-[15px] leading-5 tabular-nums",
                    label.kind === "today" ? "font-extrabold text-primary-ink" : "font-semibold",
                  )}
                >
                  {dayOfMonth(day)}
                </span>
              )}
            </h3>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-0.5">
              {items.slice(0, WEEK_AHEAD_SHOWN).map((it) => (
                <ItemRow
                  key={it.key}
                  item={it}
                  category={byId.get(it.categoryId)}
                  className="min-h-11"
                />
              ))}
              {more > 0 && (
                <MoreLink count={more} date={day} className="inline-flex min-h-11 items-center" />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
