import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "@/modules/invites/InvitePage";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: "You're invited — LevelUp LOS" },
      { name: "description", content: "Join your team on LevelUp LOS." },
      { property: "og:title", content: "You're invited to LevelUp LOS" },
      { property: "og:description", content: "Join your team on LevelUp LOS." },
    ],
  }),
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  // Keyed so a different token starts fresh.
  return <InvitePage key={token} token={token} />;
}
