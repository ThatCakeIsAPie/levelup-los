import { createFileRoute } from "@tanstack/react-router";
import { getConversationTitle } from "@/data";
import { ChatsScreen } from "@/modules/chat/ChatsScreen";

type ChatSearch = { m?: string };

export const Route = createFileRoute("/chats/$id")({
  validateSearch: (s: Record<string, unknown>): ChatSearch =>
    typeof s.m === "string" && s.m ? { m: s.m } : {},
  loader: ({ params }) => ({ title: getConversationTitle(params.id) }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? "Chat"} — LevelUp LOS` }],
  }),
  component: ChatPage,
});

function ChatPage() {
  const { id } = Route.useParams();
  const { m } = Route.useSearch();
  return <ChatsScreen selectedId={id} focusMessageId={m} />;
}
