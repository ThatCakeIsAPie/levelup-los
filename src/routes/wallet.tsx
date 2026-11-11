import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { WalletPage } from "@/modules/wallet/WalletPage";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: pageTitle("Wallet") },
      {
        name: "description",
        content: "See what you owe and what you've paid for shared event costs.",
      },
      { property: "og:title", content: pageTitle("Wallet") },
      {
        property: "og:description",
        content: "See what you owe and what you've paid for shared event costs.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WalletPage,
});
