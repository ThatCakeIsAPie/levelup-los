import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PipelinePage, type PipelineTab } from "@/modules/pipeline/PipelinePage";

interface PipelineSearch {
  tab?: "conversions";
}

/** `/pipeline?tab=conversions` opens the Conversions tab; the Board is the default. */
export const Route = createFileRoute("/pipeline")({
  validateSearch: (search: Record<string, unknown>): PipelineSearch => ({
    tab: search.tab === "conversions" ? "conversions" : undefined,
  }),
  head: () => ({ meta: [{ title: "Pipeline — LevelUp LOS" }] }),
  component: PipelineRoute,
});

function PipelineRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: PipelineTab = search.tab ?? "board";
  return (
    <PipelinePage
      tab={tab}
      onTab={(t) =>
        navigate({
          search: { tab: t === "conversions" ? "conversions" : undefined },
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}
