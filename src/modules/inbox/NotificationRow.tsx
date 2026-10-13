import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { approveDraft, markNotificationsRead } from "@/data";
import { shortAgo } from "@/modules/chat/format";
import type { InboxRow, InboxTarget } from "./model";

export function useOpenInboxTarget() {
  const navigate = useNavigate();
  return (t: InboxTarget | null) => {
    if (!t) return;
    if (t.kind === "person") navigate({ to: "/people/$id", params: { id: t.id } });
    else if (t.kind === "team") navigate({ to: "/settings/team" });
    else if (t.conversationId) {
      navigate({
        to: "/chats/$id",
        params: { id: t.conversationId },
        search: t.messageId ? { m: t.messageId } : {},
      });
    }
  };
}

/**
 * One inbox row: tinted icon, bold title when unread, a one-line detail,
 * inline Approve / Review for drafts and Review report for leaders. The
 * title opens the target (the whole row is clickable) and marks it read.
 */
export function NotificationRow({ row, compact }: { row: InboxRow; compact?: boolean }) {
  const open = useOpenInboxTarget();
  const Icon = row.icon;
  const go = () => {
    markNotificationsRead(row.ids);
    open(row.target);
  };
  return (
    <li
      className={cn(
        "relative grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-2.5 border-t border-line text-[12.5px] first:border-t-0 hover:bg-surface-2/60",
        compact ? "py-2" : "py-2.5",
      )}
    >
      <span className={cn("grid size-8 place-items-center rounded-[9px]", row.tone)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <button
          type="button"
          onClick={go}
          className={cn(
            "block max-w-full text-left after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-ring",
            row.unread ? "font-bold" : "font-medium",
          )}
        >
          {row.title}
          {row.unread && <span className="sr-only"> (unread)</span>}
        </button>
        {row.sub && (
          <p className={cn("mt-0.5 text-[11.5px] text-muted-foreground", compact && "truncate")}>
            {row.sub}
          </p>
        )}
        {(row.draft || row.openReport) && !compact && (
          <div className="relative z-10 mt-2 flex flex-wrap gap-1.5">
            {row.draft && (
              <>
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    if (approveDraft(row.draft!.id)) {
                      markNotificationsRead(row.ids);
                      toast.success("Approved and posted to Announcements");
                    }
                  }}
                >
                  Approve
                </Button>
                <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={go}>
                  Review
                </Button>
              </>
            )}
            {row.openReport && (
              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={go}>
                Review report
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="grid justify-items-end gap-1.5 text-[10.5px] text-faint">
        <time dateTime={row.createdAt}>{shortAgo(row.createdAt)}</time>
        {row.unread && <span className="size-2 rounded-full bg-primary" aria-hidden="true" />}
      </div>
    </li>
  );
}
