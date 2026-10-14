import { createFileRoute } from "@tanstack/react-router";
import { getLibraryChannelTitle } from "@/data";
import { LibraryPage } from "@/modules/library/LibraryPage";

/**
 * `?edit=true` opens the channel in edit mode (for its owner, leaders and
 * moderators); `&add=upload|link` also opens "Add a talk" (the New channel
 * sheet's first-lesson step).
 */
interface ChannelSearch {
  edit?: boolean;
  add?: "upload" | "link";
}

export const Route = createFileRoute("/library/$channelId")({
  validateSearch: (s: Record<string, unknown>): ChannelSearch => ({
    edit: s.edit === true || s.edit === "true" ? true : undefined,
    add: s.add === "upload" || s.add === "link" ? s.add : undefined,
  }),
  loader: ({ params }) => ({ title: getLibraryChannelTitle(params.channelId) }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? "Channel"} — LevelUp LOS` }],
  }),
  component: ChannelRoute,
});

function ChannelRoute() {
  const { channelId } = Route.useParams();
  const { edit, add } = Route.useSearch();
  return <LibraryPage channelId={channelId} edit={edit} add={add} />;
}
