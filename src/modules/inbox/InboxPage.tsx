import { useMemo, useState } from "react";
import { Bell, CheckCheck } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead } from "@/data";
import { useInboxRows } from "./model";
import { NotificationRow } from "./NotificationRow";

type Filter = "all" | "needs" | "mentions";

/** Notifications: approvals and reports first-class, then mentions, replies, wins, events, check-ins. */
export function InboxPage() {
  const rows = useInboxRows();
  const [filter, setFilter] = useState<Filter>("all");
  const needs = rows.filter((r) => r.needsYou).length;
  const unread = rows.filter((r) => r.unread).length;
  const shown = useMemo(
    () =>
      rows.filter((r) =>
        filter === "needs"
          ? r.needsYou
          : filter === "mentions"
            ? r.type === "mention" || r.type === "reply"
            : true,
      ),
    [rows, filter],
  );
  const chips: { value: Filter; label: string; count?: number }[] = [
    { value: "all", label: "All" },
    { value: "needs", label: "Needs you", count: needs },
    { value: "mentions", label: "Mentions" },
  ];

  return (
    <div className="mx-auto grid w-full max-w-3xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Inbox"
        subtitle={unread ? `${unread} unread` : "You're all caught up"}
        logButton={false}
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={unread === 0}
            onClick={() => markAllNotificationsRead()}
          >
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter notifications">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={filter === c.value}
            onClick={() => setFilter(c.value)}
            className={cn(
              "rounded-full border border-line px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
              filter === c.value &&
                "border-foreground bg-foreground text-surface hover:bg-foreground",
            )}
          >
            {c.label}
            {c.count ? <span className="ml-1 tabular-nums">{c.count}</span> : null}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={filter === "all" ? "No notifications yet" : "Nothing here"}
          body={
            filter === "needs"
              ? "Drafts to approve and reports to review show up here."
              : "Mentions, replies, wins and check-ins from your chats show up here."
          }
        />
      ) : (
        <section className="rounded-card border border-line bg-surface px-4 py-1.5 sm:px-[18px]">
          <ul aria-label="Notifications">
            {shown.map((r) => (
              <NotificationRow key={r.key} row={r} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
