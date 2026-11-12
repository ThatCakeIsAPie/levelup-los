import { useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  CalendarCheck,
  CalendarX,
  ClipboardList,
  Goal,
  KanbanSquare,
  MessageCircle,
  NotebookPen,
  ShoppingBag,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { EmptyState, SectionCard, TONE_CLASS, type IconTone } from "@/components/brand";
import { cn } from "@/lib/utils";
import { useMyDay, useVisibleIds, type MyDayItem, type MyDayKind } from "@/data";

const ICON: Record<MyDayKind, { icon: ComponentType<{ className?: string }>; tone: IconTone }> = {
  checkin: { icon: MessageCircle, tone: "primary" },
  sale: { icon: ShoppingBag, tone: "warn" },
  learning: { icon: BookOpen, tone: "info" },
  pipeline: { icon: KanbanSquare, tone: "primary" },
  customer_pipeline: { icon: KanbanSquare, tone: "warn" },
  step: { icon: CalendarX, tone: "neutral" },
  list: { icon: ClipboardList, tone: "neutral" },
  person: { icon: UserPlus, tone: "primary" },
  event: { icon: CalendarCheck, tone: "info" },
  goal: { icon: Goal, tone: "good" },
  note: { icon: NotebookPen, tone: "neutral" },
};

/**
 * Home's "What you did today": your own actions today, newest first, with
 * times (src/data/myDay.ts). Shows the latest few and "Show all".
 */
export function MyDayCard({ compact }: { compact?: boolean }) {
  const items = useMyDay();
  const visible = useVisibleIds();
  const [all, setAll] = useState(false);
  const limit = compact ? 4 : 5;
  const shown = all ? items : items.slice(0, limit);
  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          What you did today
          {items.length > 0 && (
            <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-ink">
              {items.length}
            </span>
          )}
        </span>
      }
      className={cn("gap-2", compact && "rounded-xl p-3 sm:px-3")}
    >
      {items.length === 0 ? (
        <EmptyState
          className="py-5"
          icon={<Sparkles />}
          title="Nothing logged yet today"
          body="Tap Log to add something: a check-in, a sale, some learning."
        />
      ) : (
        <>
          <ol aria-label="What you did today, newest first">
            {shown.map((it) => (
              <Row key={it.id} item={it} linkable={!!it.personId && visible.has(it.personId)} />
            ))}
          </ol>
          {items.length > limit && (
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              aria-expanded={all}
              className="w-fit rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {all ? "Show fewer" : `Show all ${items.length}`}
            </button>
          )}
        </>
      )}
    </SectionCard>
  );
}

function Row({ item, linkable }: { item: MyDayItem; linkable: boolean }) {
  const { icon: Icon, tone } = ICON[item.kind];
  const text =
    linkable && item.personId ? (
      <Link
        to="/people/$id"
        params={{ id: item.personId }}
        className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {item.text}
      </Link>
    ) : item.eventId ? (
      <Link
        to="/events/$id"
        params={{ id: item.eventId }}
        className="rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {item.text}
      </Link>
    ) : (
      item.text
    );
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-line py-2 first:border-t-0 first:pt-0.5">
      <span className={cn("grid size-7 place-items-center rounded-lg", TONE_CLASS[tone])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 pt-1 text-[13px] leading-snug [overflow-wrap:anywhere]">{text}</span>
      <span className="pt-1 text-[11.5px] tabular-nums text-muted-foreground">
        {item.time ?? "Today"}
      </span>
    </li>
  );
}
