import { createFileRoute } from "@tanstack/react-router";
import { CustomersPage } from "@/modules/customers/CustomersPage";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — LevelUp LOS" },
      {
        name: "description",
        content: "Your private customer list with purchases and last contact.",
      },
      { property: "og:title", content: "Customers — LevelUp LOS" },
      {
        property: "og:description",
        content: "Your private customer list with purchases and last contact.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersPage,
});
