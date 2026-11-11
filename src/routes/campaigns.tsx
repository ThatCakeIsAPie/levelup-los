import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/modules/campaigns/CampaignsPage";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: pageTitle("Campaigns") },
      {
        name: "description",
        content: "Send or schedule email, text, and voice note campaigns to your customers.",
      },
      { property: "og:title", content: pageTitle("Campaigns") },
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
