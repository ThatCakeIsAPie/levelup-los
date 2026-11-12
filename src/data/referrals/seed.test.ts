import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { seedPeople } from "../seed";
import { visibleIdSet, type Viewer } from "../access";
import { seedPipeline } from "../pipeline/seed";
import { seedCustomerPipeline } from "../customerPipeline/seed";
import { visibleEntries } from "../customerPipeline/rules";
import { REFERRAL_SOURCE } from "../pipeline/types";
import { referralIndex, referralReminders, type ReferralSourceCard } from "./rules";

const people = seedPeople();
const pipeline = seedPipeline(people);
const lists = seedCustomerPipeline(people);
const today = localDate();

function viewFor(viewer: NonNullable<Viewer>) {
  const ids = visibleIdSet(people, viewer);
  const entries = visibleEntries(lists.entries, people, viewer);
  const index = referralIndex(
    people.filter((p) => ids.has(p.id)),
    entries,
  );
  const byId = new Map(people.map((p) => [p.id, p]));
  const cards: ReferralSourceCard[] = [
    ...pipeline.cards
      .filter((c) => c.column === REFERRAL_SOURCE && ids.has(c.personId))
      .map((c) => ({
        board: "recruiting" as const,
        cardId: c.personId,
        ref: { kind: "person" as const, id: c.personId },
        name: byId.get(c.personId)!.name,
        ownerId: byId.get(c.personId)!.sponsorId!,
        column: c.column,
        enteredAt: c.enteredAt,
        personIds: [c.personId],
      })),
    ...lists.cards
      .filter((c) => c.column === REFERRAL_SOURCE)
      .flatMap((c) => {
        const e = entries.find((x) => x.id === c.entryId);
        return e
          ? [
              {
                board: "customer" as const,
                cardId: e.id,
                ref: { kind: "entry" as const, id: e.id },
                name: e.name,
                ownerId: e.ownerId,
                column: c.column,
                enteredAt: c.enteredAt,
                personIds: [],
              },
            ]
          : [];
      }),
  ];
  const reminders = referralReminders(cards, viewer.personId, today, (r) => index.count(r));
  return { index, entries, cards, reminders };
}

const entryId = (name: string) => lists.entries.find((e) => e.name === name)!.id;

describe("referral seed", () => {
  it("Maria: Nina and Wendy passed on names, Hector hasn't yet", () => {
    const { index, cards, reminders } = viewFor({ personId: "1", role: "leader" });
    expect(cards.map((c) => c.name).sort()).toEqual(
      ["Hector Ruiz", "Nina Alvarez", "Wendy Shaw", "Zane Hayes", "Ray Dunn"].sort(),
    );
    expect(index.referralsOf({ kind: "person", id: "570" }).map((c) => c.name)).toEqual([
      "Joy Alvarez",
      "Mae Collins",
      "Ty Jordan",
    ]);
    expect(
      index.referralsOf({ kind: "entry", id: entryId("Wendy Shaw") }).map((c) => c.name),
    ).toEqual(["Kara Bloom", "Leo Martin"]);
    expect(index.referrerOf({ kind: "person", id: "571" })?.name).toBe("Nina Alvarez");
    // Only her own cards: Jamal's Ray isn't Maria's to ask.
    expect(reminders.map((r) => r.name)).toEqual(["Hector Ruiz"]);
  });

  it("Jamal: Zane referred Andre Lewis; Ray has given no names after 9 days", () => {
    const { index, reminders } = viewFor({ personId: "4", role: "apprentice" });
    expect(index.referrerOf({ kind: "person", id: "21" })?.name).toBe("Zane Hayes");
    expect(index.count({ kind: "person", id: "205" })).toBe(1);
    expect(reminders.map((r) => [r.board, r.name, r.days])).toEqual([["customer", "Ray Dunn", 9]]);
  });

  it("Anita (Jamal's upline) sees his referrals, not Maria's", () => {
    const { index } = viewFor({ personId: "2", role: "ibo" });
    expect(index.referrerOf({ kind: "person", id: "21" })?.name).toBe("Zane Hayes");
    expect(index.contact({ kind: "person", id: "570" })).toBeNull();
  });

  it("every referrer is someone the list owner or sponsor can see", () => {
    for (const e of lists.entries) {
      if (e.referredByEntry)
        expect(lists.entries.find((x) => x.id === e.referredByEntry)?.ownerId).toBe(e.ownerId);
      if (e.referredBy) {
        const owner = people.find((p) => p.id === e.ownerId)!;
        const ids = visibleIdSet(people, { personId: owner.id, role: "apprentice" });
        expect(ids.has(e.referredBy)).toBe(true);
      }
    }
    for (const p of people.filter((x) => x.referredBy)) {
      const ids = visibleIdSet(people, { personId: p.sponsorId!, role: "apprentice" });
      expect(ids.has(p.referredBy!)).toBe(true);
    }
  });
});
