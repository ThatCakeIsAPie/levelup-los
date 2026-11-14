import { Link } from "@tanstack/react-router";
import type { EventCategory } from "@/data";
import { cn } from "@/lib/utils";
import { barClass, categoryIcon, itemLabel, itemWhen } from "./calendarHelpers";
import { RepeatIcon } from "./RepeatIcon";
import type { CalItem } from "./calendar";

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
