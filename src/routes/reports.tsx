import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { ReportsPage } from "@/modules/reports/ReportsPage";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: pageTitle("Reports") },
      {
        name: "description",
        content: "Download activity, contact, attendance, and payment reports as CSV.",
      },
      { property: "og:title", content: pageTitle("Reports") },
      {
        property: "og:description",
        content: "Download activity, contact, attendance, and payment reports as CSV.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsPage,
});
