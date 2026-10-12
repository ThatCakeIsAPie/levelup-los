import { format } from "date-fns";
import { parseDate } from "@/data";
import { EmptyState } from "@/components/brand";
import { cn } from "@/lib/utils";
import type { Dot, FeedItem } from "./feed";
import { fmtDate } from "./format";

const DOT_CLASS: Record<Dot, string> = {
  primary: "bg-primary",
  sky: "bg-sky",
  amber: "bg-amber",
  navy: "bg-stage-ibo",
  neutral: "bg-muted-foreground",
};

/** Vertical timeline with colored dots (mockup "Recent activity"). */
export function FeedList({
  items,
  showSub = false,
  emptyBody,
}: {
  items: FeedItem[];
  showSub?: boolean;
  emptyBody?: string;
}) {
  if (!items.length) {
    return (
      <EmptyState
        title="No activity yet"
        body={emptyBody ?? "Check-ins, events and stage changes will show up here."}
      />
    );
  }
  return (
    <ol className="grid">
      {items.map((it, i) => (
        <li
          key={it.id}
          className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2.5 py-2 text-[12.5px]"
        >
          {i < items.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute bottom-[-8px] left-2 top-5 w-[1.5px] bg-line"
            />
          )}
          <i
            aria-hidden="true"
            className={cn(
              "relative z-[1] ml-[3px] mt-1 block size-2.5 rounded-full",
              DOT_CLASS[it.dot],
            )}
          />
          <div className="min-w-0">
            <p className="break-words">{it.text}</p>
            {showSub && it.sub && (
              <p className="break-words text-xs text-muted-foreground">{it.sub}</p>
            )}
          </div>
          <time
            className="whitespace-nowrap text-faint"
            dateTime={it.when}
            title={format(it.when.length <= 10 ? parseDate(it.when) : new Date(it.when), "PPP")}
          >
            {fmtDate(it.when.length <= 10 ? it.when : format(new Date(it.when), "yyyy-MM-dd"))}
          </time>
        </li>
      ))}
    </ol>
  );
}
