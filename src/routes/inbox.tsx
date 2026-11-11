import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "@/modules/inbox/InboxPage";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: pageTitle("Inbox") },
      {
        name: "description",
        content: "Mentions, replies, approvals, reports, wins and check-ins in one list.",
      },
    ],
  }),
  component: InboxPage,
});
