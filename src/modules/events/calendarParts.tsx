import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { timeText, type EventCategory } from "@/data";
import { cn } from "@/lib/utils";
import {
  barClass,
  categoryIcon,
  formatTime,
  iconTextClass,
  itemLabel,
  itemWhen,
} from "./calendarHelpers";
import { RepeatIcon } from "./RepeatIcon";
import type { CalItem, Segment } from "./calendar";

/**
 * One item as a row: category icon, name, when. A stored one is a link to its page; a projected
 * one (computed from the series rule, not saved) is quieter and has no page.
 */
export function ItemRow({
  item,
  category,
  className,
}: {
  item: CalItem;
  category: EventCategory | undefined;
  className?: string;
}) {
  const Icon = categoryIcon(category);
  const when = itemWhen(item);
  const body = (
    <>
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-md",
          item.projected
            ? "border border-dashed border-line text-muted-foreground"
            : barClass(category),
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-snug">{item.name}</span>
        {when && (
          <span className="block truncate text-xs leading-snug text-muted-foreground">{when}</span>
        )}
      </span>
      {item.seriesId && <RepeatIcon />}
    </>
  );
  const base = "flex items-center gap-2.5 rounded-lg px-2 py-1.5";
  return item.eventId ? (
    <Link
      to="/events/$id"
      params={{ id: item.eventId }}
      aria-label={itemLabel(item)}
      className={cn(
        base,
        "hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        className,
      )}
    >
      {body}
    </Link>
  ) : (
    <div
      role="img"
      aria-label={itemLabel(item)}
      className={cn(base, "text-muted-foreground", className)}
    >
      {body}
    </div>
  );
}

/** One item within one week row: a bar (all-day and multi-day) or a title with its time under it. */
export function EntryView({
  seg,
  category,
  today,
  tabbable = !seg.before,
  narrow = false,
}: {
  seg: Segment;
  category: EventCategory | undefined;
  today: string;
  /**
   * Whether the link is a stop in the tab order. The part of a bar that continues from the
   * previous week row is the same link again, so the calendar skips it; Home's week ahead has
   * no row before it, so there a bar that began earlier is its own first stop.
   */
  tabbable?: boolean;
  /**
   * For columns too narrow for the calendar's one-line title (Home's week ahead): an event with
   * a time gets the whole width for its name, and the category icon, the start time and the
   * repeat mark share the line under it. Bars are drawn as in the calendar.
   */
  narrow?: boolean;
}) {
  const { item } = seg;
  const Icon = categoryIcon(category);
  const past = (item.endDate ?? item.date) < today;
  const bar = seg.multi || !item.startTime;
  const startText = seg.multi
    ? !seg.before && item.startTime
      ? formatTime(item.startTime)
      : ""
    : "";
  const endText = seg.multi ? (!seg.after && item.endTime ? formatTime(item.endTime) : "") : "";
  const when = seg.multi ? "" : timeText(item);
  const timeLine = bar ? startText || endText : when;
  const place: CSSProperties = {
    gridColumn: `${seg.col0 + 1} / ${seg.col1 + 2}`,
    gridRow: seg.lane + 2,
  };
  const repeat = item.seriesId ? (
    <RepeatIcon className={cn("[&>svg]:size-3", bar && !item.projected && "text-current")} />
  ) : null;
  const title = (
    <span className="flex min-w-0 items-center gap-1 text-[12px] font-semibold leading-4">
      <Icon
        className={cn("size-3 shrink-0", bar ? "" : iconTextClass(category))}
        aria-hidden="true"
      />
      <span className="truncate">{item.name}</span>
      {repeat}
    </span>
  );
  const stack = narrow && !bar;
  const body = stack ? (
    <>
      <span className="block truncate text-[12px] font-semibold leading-4">{item.name}</span>
      <span className="flex min-w-0 items-center gap-1 text-[11px] leading-[14px] text-muted-foreground">
        <Icon className={cn("size-3 shrink-0", iconTextClass(category))} aria-hidden="true" />
        <span className="truncate">{formatTime(item.startTime!)}</span>
        {repeat}
      </span>
    </>
  ) : (
    <>
      {title}
      {timeLine && (
        <span
          className={cn(
            "flex justify-between gap-2 text-[11px] leading-[14px]",
            bar ? "pl-4" : "pl-4 text-muted-foreground",
          )}
        >
          <span className="truncate">{bar ? startText : when}</span>
          {bar && endText && <span className="shrink-0">{endText}</span>}
        </span>
      )}
    </>
  );
  const className = cn(
    "relative z-10 flex min-w-0 flex-col justify-center self-start text-left",
    bar
      ? cn(
          timeLine ? "h-[30px]" : "h-[22px]",
          "px-1.5",
          item.projected
            ? "border border-dashed border-line text-muted-foreground"
            : barClass(category),
          seg.before ? "rounded-l-none" : "ml-1 rounded-l-md",
          seg.after ? "rounded-r-none" : "mr-1 rounded-r-md",
        )
      : cn(
          "mx-1 rounded-md px-1 py-0.5",
          item.projected || past ? "text-muted-foreground" : "text-foreground",
        ),
  );
  if (item.projected)
    return (
      <div role="img" aria-label={itemLabel(item)} className={className} style={place}>
        {body}
      </div>
    );
  return (
    <Link
      to="/events/$id"
      params={{ id: item.eventId! }}
      aria-label={itemLabel(item)}
      tabIndex={tabbable ? undefined : -1}
      className={cn(
        className,
        bar ? "hover:brightness-95" : "hover:bg-surface-2",
        "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
      )}
      style={place}
    >
      {body}
    </Link>
  );
}
