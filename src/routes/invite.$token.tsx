import { brand } from "@/brand/brand";
import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "@/modules/invites/InvitePage";

export const Route = createFileRoute("/invite/$token")({
  head: () => ({
    meta: [
      { title: pageTitle("You're invited") },
      { name: "description", content: `Join your team on ${brand.name}.` },
      { property: "og:title", content: `You're invited to ${brand.name}` },
      { property: "og:description", content: `Join your team on ${brand.name}.` },
    ],
  }),
  component: InviteRoute,
});

function InviteRoute() {
  const { token } = Route.useParams();
  // Keyed so a different token starts fresh.
  return <InvitePage key={token} token={token} />;
}
