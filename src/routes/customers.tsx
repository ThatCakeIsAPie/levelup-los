import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CustomersPage, type CustomersTab } from "@/modules/customers/CustomersPage";

interface CustomersSearch {
  tab?: "list" | "customers";
  /** Your list: whose list (an upline opening a downline's), default yours. */
  owner?: string;
}

/**
 * `/customers` opens the customer pipeline; `?tab=list` your list
 * (`&owner=<id>` a downline's), `?tab=customers` your customers.
 */
export const Route = createFileRoute("/customers")({
  validateSearch: (search: Record<string, unknown>): CustomersSearch => ({
    tab: search.tab === "list" || search.tab === "customers" ? search.tab : undefined,
    // The router parses a numeric-looking value (`owner=700`) as a number.
    owner:
      (typeof search.owner === "string" && search.owner) || typeof search.owner === "number"
        ? String(search.owner)
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Customers — LevelUp LOS" },
      {
        name: "description",
        content: "Your customer pipeline, your list and your private customer list.",
      },
      { property: "og:title", content: "Customers — LevelUp LOS" },
      {
        property: "og:description",
        content: "Your customer pipeline, your list and your private customer list.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersRoute,
});

function CustomersRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: CustomersTab = search.tab ?? "pipeline";
  return (
    <CustomersPage
      tab={tab}
      owner={search.owner}
      onTab={(t, owner) =>
        navigate({
          search: {
            tab: t === "pipeline" ? undefined : t,
            owner: t === "list" ? owner : undefined,
          },
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}
