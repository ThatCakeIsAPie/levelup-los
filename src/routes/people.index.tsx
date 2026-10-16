import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCurrentUser } from "@/data";
import { validatePeopleSearch, type PeopleSearch } from "@/modules/people-list/model";
import { CandidatePeople, PeopleList } from "@/modules/people-list/PeopleList";

/**
 * Filters live in the URL so a filtered list can be shared and Back works:
 * `/people?stage=apprentice,ibo&attn=contact` (stages and attention reasons
 * are comma-separated), `?seg=customers`, `loc`, `q`, `sort`.
 */
export const Route = createFileRoute("/people/")({
  validateSearch: validatePeopleSearch,
  head: () => ({ meta: [{ title: "People — LevelUp LOS" }] }),
  component: PeoplePage,
});

function PeoplePage() {
  const user = useCurrentUser();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setSearch = (next: PeopleSearch) =>
    void navigate({ search: next, replace: true, resetScroll: false });
  return user.role === "candidate" ? (
    <CandidatePeople />
  ) : (
    <PeopleList search={search} onSearch={setSearch} />
  );
}
