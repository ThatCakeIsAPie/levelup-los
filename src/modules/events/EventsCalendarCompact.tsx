import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CrmEvent, EventCategory, EventSeries } from "@/data";
import { cn } from "@/lib/utils";
import {
  bucketByWeek,
  dayLabel,
  dayOfMonth,
  itemsOnDay,
  shortDay,
  weekDays,
  weekdayDay,
  WEEKDAY_NAMES,
  weekStartOf,
  type CalItem,
} from "./calendar";
import { dotClass, useCalendarItems, useCategoryMap } from "./calendarHelpers";
import { ItemRow } from "./calendarParts";

const CELL_H = 48;

/**
 * The events calendar below desktop width: the same continuous grid of weeks, with small cells
 * (the day, and up to three category-coloured dots) in a box of its own that scrolls, and the
 * selected day's events as a list directly under it. No horizontal scrolling: seven columns share
 * the width.
 */
export function EventsCalendarCompact({
  events,
  series,
  categories,
  categoryId,
  today,
  jump,
}: {
  events: CrmEvent[];
  series: EventSeries[];
  categories: EventCategory[];
  categoryId?: string;
  today: string;
  /** Changes (`n`) when the Today button is pressed. */
  jump: { n: number; focus: boolean };
}) {
  const byId = useCategoryMap(categories);
  const { weeks, items } = useCalendarItems(events, series, today, categoryId);
  const buckets = useMemo(() => bucketByWeek(items, weeks), [items, weeks]);
  const [selected, setSelected] = useState(today);
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
  useLayoutEffect(() => toToday(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  const first = useRef(jump.n);
  useEffect(() => {
    if (jump.n === first.current) return;
    first.current = jump.n;
    setSelected(today);
    toToday(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [jump.n]); // eslint-disable-line react-hooks/exhaustive-deps

  const dayItems = useMemo(
    () => itemsOnDay(buckets.get(weekStartOf(selected)) ?? [], selected),
    [buckets, selected],
  );

  return (
    <div className="grid gap-4">
      <div className="glass-reading glass-flat overflow-hidden rounded-card border border-line bg-card">
        <div data-head className="overflow-y-hidden border-b border-line [scrollbar-gutter:stable]">
          <div className="grid grid-cols-7" aria-hidden="true">
            {WEEKDAY_NAMES.map((d) => (
              <div
                key={d}
                className="py-1 text-center text-[10.5px] font-bold uppercase text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
        </div>
        <div
          ref={scroller}
          data-scroller
          className="relative overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
          style={{ height: CELL_H * 6 }}
        >
          {weeks.map((w) => (
            <div
              key={w}
              data-week={w}
              className="grid grid-cols-7 border-b border-line"
              style={{
                height: CELL_H,
                contentVisibility: "auto",
                containIntrinsicSize: `auto ${CELL_H}px`,
              }}
            >
              {weekDays(w).map((day, c) => (
                <DayCell
                  key={day}
                  day={day}
                  today={today}
                  weekend={c === 0 || c === 6}
                  selected={day === selected}
                  items={itemsOnDay(buckets.get(w) ?? [], day)}
                  byId={byId}
                  onSelect={() => setSelected(day)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <section aria-label={weekdayDay(selected)} className="grid gap-1">
        <h2 className="px-1 text-[13px] font-bold">
          {selected === today ? `Today, ${shortDay(selected)}` : weekdayDay(selected)}
        </h2>
        {dayItems.length > 0 && (
          <ul className="grid gap-0.5 rounded-card border border-line bg-card p-1.5">
            {dayItems.map((it) => (
              <li key={it.key}>
                <ItemRow item={it} category={byId.get(it.categoryId)} className="min-h-11" />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function DayCell({
  day,
  today,
  weekend,
  selected,
  items,
  byId,
  onSelect,
}: {
  day: string;
  today: string;
  weekend: boolean;
  selected: boolean;
  items: CalItem[];
  byId: Map<string, EventCategory>;
  onSelect: () => void;
}) {
  const label = dayLabel(day, today);
  const n = items.length;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${label.kind === "today" ? "Today, " : ""}${weekdayDay(day)}${day.endsWith("-01") ? `, ${day.slice(0, 4)}` : ""}${n ? `, ${n} ${n === 1 ? "event" : "events"}` : ""}`}
      className={cn(
        "relative flex flex-col items-center border-r border-line pt-0.5 text-[13px] last:border-r-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        label.kind === "today" ? "bg-primary-soft" : weekend ? "bg-surface-2" : "bg-transparent",
        selected && "outline-2 outline-offset-[-2px] outline-foreground",
      )}
    >
      {label.kind === "month" ? (
        <span className="w-full bg-primary text-[10px] font-bold leading-[18px] text-primary-foreground">
          {shortDay(day)}
        </span>
      ) : (
        <span
          className={cn(
            "leading-[18px] tabular-nums",
            label.kind === "today"
              ? "font-extrabold text-primary-ink"
              : day < today
                ? "text-faint"
                : "font-semibold text-foreground",
          )}
        >
          {dayOfMonth(day)}
        </span>
      )}
      {n > 0 && (
        <span className="mt-1 flex h-2 items-center justify-center gap-[3px]" aria-hidden="true">
          {n > 3 ? (
            <span className="text-[10px] font-bold leading-none text-muted-foreground">{n}</span>
          ) : (
            items.map((it) => {
              const c = byId.get(it.categoryId);
              return (
                <span
                  key={it.key}
                  className={cn(
                    "size-2 rounded-full",
                    it.projected ? "border border-muted-foreground" : dotClass(c),
                  )}
                />
              );
            })
          )}
        </span>
      )}
    </button>
  );
}
