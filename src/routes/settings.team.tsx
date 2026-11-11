import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { TeamSettings } from "@/modules/chat/TeamSettings";

export const Route = createFileRoute("/settings/team")({
  head: () => ({
    meta: [
      { title: pageTitle("Team settings") },
      {
        name: "description",
        content: "Designate moderators, approve announcements and review reports.",
      },
    ],
  }),
  component: TeamSettings,
});
