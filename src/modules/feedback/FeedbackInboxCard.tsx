import { MessageSquareText } from "lucide-react";
import { ActionRow, SectionCard } from "@/components/brand";
import { useCurrentUser } from "@/data";

/** Settings card that links to the Feedback reports; app admins only. */
export function FeedbackInboxCard() {
  if (!useCurrentUser().admin) return null;
  return (
    <SectionCard title="Feedback">
      <ActionRow
        icon={MessageSquareText}
        iconTone="info"
        title="Feedback reports"
        meta="What people asked to change, with a snapshot of their page"
        link={{ to: "/settings/feedback" }}
      />
    </SectionCard>
  );
}
