import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "@/modules/inbox/InboxPage";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Inbox — LevelUp LOS" },
      {
        name: "description",
        content: "Mentions, replies, approvals, reports, wins and check-ins in one list.",
      },
    ],
  }),
  component: InboxPage,
});
