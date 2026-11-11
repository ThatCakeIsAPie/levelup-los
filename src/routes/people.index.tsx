import { pageTitle } from "@/lib/brand";
import { createFileRoute } from "@tanstack/react-router";
import { useCurrentUser } from "@/data";
import { CandidatePeople, PeopleList } from "@/modules/people-list/PeopleList";

export const Route = createFileRoute("/people/")({
  head: () => ({ meta: [{ title: pageTitle("People") }] }),
  component: PeoplePage,
});

function PeoplePage() {
  const user = useCurrentUser();
  return user.role === "candidate" ? <CandidatePeople /> : <PeopleList />;
}
