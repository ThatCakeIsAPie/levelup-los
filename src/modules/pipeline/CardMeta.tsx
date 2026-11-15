import { CalendarClock, ListChecks, MessageSquare } from "lucide-react";
import { PersonAvatar, Sensitive } from "@/components/brand";
import { cn } from "@/lib/utils";
import { isBlank, usePersonLookup, type CardSummary } from "@/data";
import { dueText } from "./format";

/** Open tasks may be for someone else than the owner: at most this many avatars show. */
const MAX_AVATARS = 2;

/**
 * The compact line on a card's face (desktop card, phone row, the profile's pipeline card): tasks
 * done of all, the earliest open due date (overdue and today toned like a booked step was), the
 * notes count, and who else the open tasks are for. Nothing for a card with no tasks and no notes.
 * The numbers come from `summarize` (src/data/cardTasks/rules.ts), the one function every surface uses.
 */
export function CardMeta({
  summary,
  ownerId,
  className,
}: {
  summary: CardSummary | undefined;
  /** The card's owner: their tasks are not marked with an avatar. */
  ownerId: string | null;
  className?: string;
}) {
  const who = usePersonLookup();
  if (!summary || isBlank(summary)) return null;
  const others = summary.assigneeIds
    .filter((id) => id !== ownerId)
    .slice(0, MAX_AVATARS)
    .map((id) => ({ id, ...who(id) }))
    .filter(
      (p): p is { id: string; name: string; stage: NonNullable<ReturnType<typeof who>>["stage"] } =>
        !!p.name,
    );
  const { due } = summary;
  const hot = due && (due.state === "overdue" || due.state === "today");
  return (
    <div
      data-card-meta
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {summary.total > 0 && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
          {summary.done}/{summary.total}
          <span className="sr-only"> tasks done</span>
        </span>
      )}
      {due && (
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 font-semibold",
            due.state === "overdue" ? "text-warn-ink" : due.state === "today" && "text-primary-ink",
          )}
        >
          <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
          <span
            className={cn(
              "truncate",
              hot && "rounded px-1",
              hot && (due.state === "overdue" ? "bg-warn-soft" : "bg-primary-soft"),
            )}
          >
            <span className="sr-only">Due </span>
            {dueText(due.date, due.time)}
            {due.state === "overdue" && <span className="sr-only"> (overdue)</span>}
          </span>
        </span>
      )}
      {summary.notes > 0 && (
        <span className="inline-flex items-center gap-1 tabular-nums">
          <MessageSquare className="size-3.5 shrink-0" aria-hidden="true" />
          {summary.notes}
          <span className="sr-only"> {summary.notes === 1 ? "note" : "notes"}</span>
        </span>
      )}
      {others.length > 0 && (
        <span className="inline-flex items-center">
          <span className="sr-only">
            For{" "}
            {others.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ", "}
                <Sensitive kind="name">{p.name}</Sensitive>
              </span>
            ))}
          </span>
          <span className="inline-flex -space-x-1" aria-hidden="true">
            {others.map((p) => (
              <PersonAvatar
                key={p.id}
                name={p.name}
                stage={p.stage}
                size="sm"
                className="size-[18px] text-[8px] ring-1 ring-surface"
              />
            ))}
          </span>
        </span>
      )}
    </div>
  );
}
