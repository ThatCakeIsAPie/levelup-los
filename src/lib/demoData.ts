import type { Row } from "@/lib/parseSpreadsheet";
import type { CrmPerson } from "@/stores/peopleStore";

/** Build mind-map rows from the shared roster so both use the same people. */
export function rosterToRows(people: CrmPerson[]): Row[] {
  return people
    .filter((p) => p.bizClass !== "customer")
    .map((p) => ({
      ID: p.id,
      Name: p.name,
      SponsorID: p.sponsorId ?? "",
      PPV: 300,
      GPV: 300,
      Customers: people.filter((c) => c.ownerId === p.id).length,
    }));
}
