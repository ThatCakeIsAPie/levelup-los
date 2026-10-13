import { createFileRoute } from "@tanstack/react-router";
import { getCatalogItemTitle } from "@/data";
import { ItemPage } from "@/modules/library/ItemPage";

/** `?channel=<id>` shows the lesson inside that channel (lesson number, previous / next). */
interface ItemSearch {
  channel?: string;
}

export const Route = createFileRoute("/library/item/$itemId")({
  validateSearch: (s: Record<string, unknown>): ItemSearch => ({
    channel: typeof s.channel === "string" && s.channel ? s.channel : undefined,
  }),
  loader: ({ params }) => ({ title: getCatalogItemTitle(params.itemId) }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? "Talk"} — LevelUp LOS` }],
  }),
  component: ItemRoute,
});

function ItemRoute() {
  const { itemId } = Route.useParams();
  const { channel } = Route.useSearch();
  return <ItemPage itemId={itemId} channelId={channel} />;
}
