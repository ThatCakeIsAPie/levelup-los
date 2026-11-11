import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "@/modules/settings/SettingsPage";

export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: pageTitle("Settings") }] }),
  component: SettingsPage,
});
