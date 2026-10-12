import { createFileRoute } from "@tanstack/react-router";
import { useCurrentUser } from "@/data";
import { CandidatePeople, PeopleList } from "@/modules/people-list/PeopleList";

export const Route = createFileRoute("/people/")({
  head: () => ({ meta: [{ title: "People — LevelUp LOS" }] }),
  component: PeoplePage,
});

function PeoplePage() {
  const user = useCurrentUser();
  return user.role === "candidate" ? <CandidatePeople /> : <PeopleList />;
}
