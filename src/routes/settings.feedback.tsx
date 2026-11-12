import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { FeedbackPage } from "@/modules/feedback/FeedbackPage";

export const Route = createFileRoute("/settings/feedback")({
  head: () => ({
    meta: [
      { title: pageTitle("Feedback") },
      { name: "description", content: "Read the feedback people sent from the app." },
    ],
  }),
  component: FeedbackPage,
});
