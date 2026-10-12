import { useMemo } from "react";
import { useVisiblePeople, type CrmPerson } from "@/data";

/** Visible people keyed by id (for name/stage lookups in lists). */
export function usePeopleMap(): Map<string, CrmPerson> {
  const people = useVisiblePeople();
  return useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
}
