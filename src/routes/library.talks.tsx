import { createFileRoute } from "@tanstack/react-router";
import {
  CATALOG_FORMATS,
  CATALOG_KINDS,
  SORT_LABEL,
  type CatalogFilters,
  type CatalogFormat,
  type CatalogKind,
  type CatalogSort,
} from "@/data";
import { TalksPage } from "@/modules/library/TalksPage";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

export const Route = createFileRoute("/library/talks")({
  // e.g. /library/talks?topic=t-recruiting&format=panel&sort=oldest&q=invite
  validateSearch: (s: Record<string, unknown>): CatalogFilters => ({
    q: str(s.q),
    speaker: str(s.speaker),
    topic: str(s.topic),
    event: str(s.event),
    format: CATALOG_FORMATS.includes(s.format as CatalogFormat)
      ? (s.format as CatalogFormat)
      : undefined,
    kind: CATALOG_KINDS.includes(s.kind as CatalogKind) ? (s.kind as CatalogKind) : undefined,
    sort: typeof s.sort === "string" && s.sort in SORT_LABEL ? (s.sort as CatalogSort) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "All talks — LevelUp LOS" },
      {
        name: "description",
        content:
          "Every talk, panel and workshop: filter by speaker, format, topic, type and event.",
      },
    ],
  }),
  component: TalksRoute,
});

function TalksRoute() {
  const filters = Route.useSearch();
  return <TalksPage filters={filters} />;
}
