import { Link } from "@tanstack/react-router";
import { SectionCard } from "@/components/brand";
import { useInboxRows } from "@/modules/inbox/model";
import { NotificationRow } from "@/modules/inbox/NotificationRow";

/** Home: the latest 3 unread notifications above the Today list; hidden when there are none. */
export function InboxCard({ compact }: { compact?: boolean }) {
  const rows = useInboxRows();
  const unread = rows.filter((r) => r.unread);
  if (unread.length === 0) return null;
  return (
    <SectionCard
      title="Inbox"
      className="gap-1"
      action={
        <Link to="/inbox" className="text-primary hover:underline">
          See all {unread.length}
        </Link>
      }
    >
      <ul aria-label="Latest unread notifications">
        {unread.slice(0, 3).map((r) => (
          <NotificationRow key={r.key} row={r} compact={compact} />
        ))}
      </ul>
    </SectionCard>
  );
}
