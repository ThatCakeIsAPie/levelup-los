import { createFileRoute } from "@tanstack/react-router";
import { LearningPage } from "@/modules/learning/LearningPage";

export const Route = createFileRoute("/learning")({
  head: () => ({
    meta: [
      { title: "Learning — LevelUp LOS" },
      {
        name: "description",
        content: "Your learning streak, this week's goal and what you've logged.",
      },
    ],
  }),
  component: LearningPage,
});
