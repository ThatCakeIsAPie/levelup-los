import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CrmEvent, EventCategory, EventSeries } from "@/data";
import { cn } from "@/lib/utils";
import {
  bucketByWeek,
  dayLabel,
  layoutWeek,
  weekdayDay,
  WEEKDAY_NAMES,
  weekStartOf,
  type WeekLayout,
} from "./calendar";
import { useCalendarItems, useCategoryMap } from "./calendarHelpers";
import { EntryView, ItemRow } from "./calendarParts";

const LABEL_H = 24;
const SLOT_H = 36;
const PAD_B = 8;
const rowHeight = (slots: number) => LABEL_H + slots * SLOT_H + PAD_B;

/**
 * The events calendar at desktop width: one continuous, vertically scrolling grid of weeks
 * (Sunday to Saturday) under a weekday header that stays put. It opens on the current week;
 * `jump` changing scrolls back to it. Every week row has a fixed height worked out from its
 * content, so the rows can be skipped by the browser until they are near the screen
 * (`content-visibility`) and the scroll position never jumps as they are drawn.
 */
export function EventsCalendar({
  events,
  series,
  categories,
  categoryId,
  today,
  jump,
  onCreate,
}: {
  events: CrmEvent[];
  series: EventSeries[];
  categories: EventCategory[];
  categoryId?: string;
  today: string;
  /** Changes (`n`) when the Today button is pressed; `focus` when it was pressed from the keyboard. */
  jump: { n: number; focus: boolean };
  /** Set for people who may create events: clicking an empty part of a day calls it with the date. */
  onCreate?: (date: string) => void;
}) {
  const byId = useCategoryMap(categories);
  const { weeks, items } = useCalendarItems(events, series, today, categoryId);
  const layouts = useMemo(() => {
    const buckets = bucketByWeek(items, weeks);
    return weeks.map((w) => layoutWeek(w, buckets.get(w) ?? []));
  }, [items, weeks]);

  const scroller = useRef<HTMLDivElement>(null);
  const todayWeek = weekStartOf(today);
  const toToday = (smooth: boolean) => {
    const el = scroller.current;
    const row = el?.querySelector<HTMLElement>(`[data-week="${todayWeek}"]`);
    if (!el || !row) return;
    el.scrollTo({
      top: row.offsetTop,
      behavior: smooth ? "smooth" : "auto",
    });
  };
  // Opens on the current week; the Today button scrolls back to it.
  useLayoutEffect(() => toToday(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(jump.n);
  useEffect(() => {
    if (jump.n === first.current) return;
    first.current = jump.n;
    toToday(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    // From the keyboard, Tab would otherwise start again at the oldest event on the grid: move on to this week's first.
    if (jump.focus)
      scroller.current
        ?.querySelector<HTMLElement>(
          `[data-week="${todayWeek}"] :is(a, button):not([tabindex="-1"])`,
        )
        ?.focus({ preventScroll: true });
  }, [jump.n]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="glass-reading glass-flat flex min-h-[26rem] min-w-0 flex-1 flex-col overflow-hidden rounded-card border border-line bg-card">
      {/* The weekday header sits above the scrolling weeks, not over them, so nothing shows through it. The
          same scrollbar gutter on both keeps the seven columns lined up. */}
      <div data-head className="overflow-y-hidden border-b border-line [scrollbar-gutter:stable]">
        <div className="grid grid-cols-7">
          {WEEKDAY_NAMES.map((d) => (
            <div
              key={d}
              className="px-2 py-1.5 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={scroller}
        data-scroller
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
      >
        {layouts.map((w) => (
          <WeekRow key={w.start} week={w} today={today} byId={byId} onCreate={onCreate} />
        ))}
      </div>
    </div>
  );
}

function WeekRow({
  week,
  today,
  byId,
  onCreate,
}: {
  week: WeekLayout;
  today: string;
  byId: Map<string, EventCategory>;
  onCreate?: (date: string) => void;
}) {
  const h = rowHeight(week.slots);
  const style: CSSProperties = {
    height: h,
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gridTemplateRows: `${LABEL_H}px repeat(${week.slots}, ${SLOT_H}px) 1fr`,
    contentVisibility: "auto",
    containIntrinsicSize: `auto ${h}px`,
  };
  return (
    <div data-week={week.start} className="relative grid border-b border-line" style={style}>
      {week.days.map((day, c) => {
        const label = dayLabel(day, today);
        const weekend = c === 0 || c === 6;
        const past = day < today;
        return (
          <div
            key={day}
            data-day={day}
            onClick={onCreate ? () => onCreate(day) : undefined}
            className={cn(
              "border-r border-line last:border-r-0",
              label.kind === "today"
                ? "bg-primary-soft"
                : weekend
                  ? "bg-surface-2"
                  : "bg-transparent",
              onCreate && "cursor-pointer hover:bg-surface-2",
            )}
            style={{ gridColumn: c + 1, gridRow: "1 / -1" }}
          />
        );
      })}
      {week.days.map((day, c) => {
        const label = dayLabel(day, today);
        return (
          <div
            key={`l${day}`}
            className={cn(
              "pointer-events-none z-10 truncate px-2 text-right text-[12px] leading-6 tabular-nums",
              label.kind === "today" && "font-bold text-primary-ink",
              label.kind === "month" && "bg-primary font-bold text-primary-foreground",
              label.kind === "day" &&
                (day < today ? "text-faint" : "font-semibold text-foreground"),
            )}
            style={{ gridColumn: c + 1, gridRow: 1 }}
          >
            {label.text}
          </div>
        );
      })}
      {week.segments.map((s) => (
        <EntryView
          key={`${s.item.key}@${week.start}`}
          seg={s}
          category={byId.get(s.item.categoryId)}
          today={today}
        />
      ))}
      {week.hidden.map((n, c) =>
        n > 0 ? (
          <MoreButton
            key={`m${c}`}
            col={c}
            slots={week.slots}
            count={n}
            date={week.days[c]}
            items={week.perDay[c]}
            byId={byId}
          />
        ) : null,
      )}
    </div>
  );
}

function MoreButton({
  col,
  slots,
  count,
  date,
  items,
  byId,
}: {
  col: number;
  slots: number;
  count: number;
  date: string;
  items: WeekLayout["perDay"][number];
  byId: Map<string, EventCategory>;
}) {
  const heading = weekdayDay(date);
  return (
    // modal: focus stays inside while it is open and returns to this button when it closes.
    <Popover modal>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`+${count} more, ${heading}`}
          className="relative z-10 mx-1 self-center truncate rounded px-1.5 text-left text-[12px] font-semibold leading-5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          style={{ gridColumn: col + 1, gridRow: slots + 1 }}
        >
          +{count} more
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2" aria-label={heading}>
        <p className="px-2 pb-1 pt-0.5 text-xs font-bold text-muted-foreground">{heading}</p>
        <ul className="grid max-h-80 gap-0.5 overflow-y-auto">
          {items.map((it) => (
            <li key={it.key}>
              <ItemRow item={it} category={byId.get(it.categoryId)} />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
