import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/brand";

// Placeholder created so other pages can link here; replaced by the navigation agent.
export const Route = createFileRoute("/settings/")({
  head: () => ({ meta: [{ title: "Settings — LevelUp LOS" }] }),
  component: Placeholder,
});

function Placeholder() {
  return (
    <div className="px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <EmptyState title="Settings" body="This page is being built." />
    </div>
  );
}
