import { createFileRoute } from "@tanstack/react-router";
import { BusinessHub } from "@/modules/business/BusinessHub";

export const Route = createFileRoute("/business")({
  head: () => ({ meta: [{ title: "My business — LevelUp LOS" }] }),
  component: BusinessHub,
});
