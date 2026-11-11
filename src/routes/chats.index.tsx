import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { ChatsScreen } from "@/modules/chat/ChatsScreen";

export const Route = createFileRoute("/chats/")({
  head: () => ({
    meta: [
      { title: pageTitle("Chats") },
      {
        name: "description",
        content: "Team announcements, the main chat, daily wins, groups and direct messages.",
      },
    ],
  }),
  component: ChatsIndex,
});

function ChatsIndex() {
  return <ChatsScreen />;
}
