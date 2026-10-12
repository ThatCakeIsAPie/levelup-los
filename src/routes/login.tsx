import { createFileRoute } from "@tanstack/react-router";
import { LoginScreen } from "@/modules/login/LoginScreen";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — LevelUp LOS" },
      {
        name: "description",
        content:
          "Pick a demo user to explore LevelUp LOS as a leader, IBO, apprentice or candidate.",
      },
      { property: "og:title", content: "Log in — LevelUp LOS" },
      { property: "og:description", content: "Pick a demo user to explore LevelUp LOS." },
    ],
  }),
  component: LoginScreen,
});
