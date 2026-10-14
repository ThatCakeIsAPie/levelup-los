import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/modules/settings/SettingsPage";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "Settings — LevelUp LOS" }] }),
  component: SettingsPage,
});
