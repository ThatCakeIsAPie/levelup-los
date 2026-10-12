import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/modules/campaigns/CampaignsPage";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Campaigns — LevelUp LOS" },
      {
        name: "description",
        content: "Send or schedule email, text, and voice note campaigns to your customers.",
      },
      { property: "og:title", content: "Campaigns — LevelUp LOS" },
      {
        property: "og:description",
        content: "Send or schedule email, text, and voice note campaigns to your customers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignsPage,
});
