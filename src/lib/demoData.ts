import type { Row } from "@/lib/parseSpreadsheet";
import type { CrmPerson } from "@/stores/peopleStore";

/**
 * Build mind-map rows from the shared roster so both use the same people.
 * `pvOf` gives each person's PV this month (the same figure their growth path
 * uses); the map adds it up into GPV.
 */
export function rosterToRows(people: CrmPerson[], pvOf: (id: string) => number = () => 0): Row[] {
  return people
    .filter((p) => p.bizClass !== "customer")
    .map((p) => ({
      ID: p.id,
      Name: p.name,
      SponsorID: p.sponsorId ?? "",
      PPV: pvOf(p.id),
      Customers: people.filter((c) => c.ownerId === p.id).length,
    }));
}
