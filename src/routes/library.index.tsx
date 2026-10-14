import { createFileRoute } from "@tanstack/react-router";
import { LibraryPage } from "@/modules/library/LibraryPage";

export const Route = createFileRoute("/library/")({
  head: () => ({
    meta: [
      { title: "Library — LevelUp LOS" },
      {
        name: "description",
        content: "Your team's channels of talks, videos and documents, and where you left off.",
      },
    ],
  }),
  component: LibraryIndex,
});

function LibraryIndex() {
  return <LibraryPage />;
}
