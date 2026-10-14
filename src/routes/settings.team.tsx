import { createFileRoute } from "@tanstack/react-router";
import { TeamSettings } from "@/modules/chat/TeamSettings";

export const Route = createFileRoute("/settings/team")({
  head: () => ({
    meta: [
      { title: "Team settings — LevelUp LOS" },
      {
        name: "description",
        content: "Designate moderators, approve announcements and review reports.",
      },
    ],
  }),
  component: TeamSettings,
});
