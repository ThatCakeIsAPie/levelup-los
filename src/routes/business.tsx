import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { BusinessHub } from "@/modules/business/BusinessHub";

export const Route = createFileRoute("/business")({
  head: () => ({ meta: [{ title: pageTitle("My business") }] }),
  component: BusinessHub,
});
