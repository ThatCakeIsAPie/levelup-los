import { brand } from "@/brand/brand";
import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { IS_LOCAL_DEMO } from "@/lib/config";
import { LoginScreen } from "@/modules/login/LoginScreen";

const TITLE = IS_LOCAL_DEMO ? pageTitle("Log in") : pageTitle("Sign in");
const DESCRIPTION = IS_LOCAL_DEMO
  ? `Pick a demo user to explore ${brand.name} as a leader, IBO, apprentice or candidate.`
  : `Sign in to ${brand.name} with your email.`;

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      {
        property: "og:description",
        content: IS_LOCAL_DEMO ? `Pick a demo user to explore ${brand.name}.` : DESCRIPTION,
      },
    ],
  }),
  component: LoginScreen,
});
