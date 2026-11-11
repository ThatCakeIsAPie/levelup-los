import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { LearningPage } from "@/modules/learning/LearningPage";

export const Route = createFileRoute("/learning")({
  head: () => ({
    meta: [
      { title: pageTitle("Learning") },
      {
        name: "description",
        content: "Your learning streak, this week's goal and what you've logged.",
      },
    ],
  }),
  component: LearningPage,
});
