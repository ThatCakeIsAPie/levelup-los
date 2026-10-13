import { createFileRoute } from "@tanstack/react-router";
import { IS_LOCAL_DEMO } from "@/lib/config";
import { LoginScreen } from "@/modules/login/LoginScreen";

const TITLE = IS_LOCAL_DEMO ? "Log in — LevelUp LOS" : "Sign in — LevelUp LOS";
const DESCRIPTION = IS_LOCAL_DEMO
  ? "Pick a demo user to explore LevelUp LOS as a leader, IBO, apprentice or candidate."
  : "Sign in to LevelUp LOS with your email.";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      {
        property: "og:description",
        content: IS_LOCAL_DEMO ? "Pick a demo user to explore LevelUp LOS." : DESCRIPTION,
      },
    ],
  }),
  component: LoginScreen,
});
