import { describe, expect, it } from "vitest";
import { daysFromToday } from "@/lib/dates";
import type { CrmPerson, ReferralReminder } from "@/data";
import { buildTodayItems, groupToday, type TodayInput } from "./today";

const person = (id: string, o: Partial<CrmPerson> = {}): CrmPerson => ({
  id,
  name: `Person ${id}`,
  bizClass: "prospect",
  sponsorId: "lead",
  ...o,
});

const base = (o: Partial<TodayInput>): TodayInput => ({
  viewerId: "lead",
  role: "ibo",
  people: [person("lead", { bizClass: "ibo", sponsorId: null }), person("hector")],
  // Everyone contacted today, so only the referral items show.
  lastContact: new Map([["hector", daysFromToday(0)]]),
  settings: { teamDays: 14, customerDays: 30 },
  events: [],
  attendances: [],
  sales: [],
  ...o,
});

const reminder = (o: Partial<ReferralReminder> = {}): ReferralReminder => ({
  board: "recruiting",
  cardId: "hector",
  ref: { kind: "person", id: "hector" },
  name: "Person hector",
  days: 9,
  ...o,
});

describe("buildTodayItems: referral sources", () => {
  it("asks a referral source for names under Pipeline › Recruiting", () => {
    const items = buildTodayItems(base({ referrals: [reminder()] }));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "referral:recruiting:hector",
      kind: "referral",
      filter: "pipeline",
      sub: "recruiting",
      score: 92,
    });
    expect(items[0].person.name).toBe("Person hector");
    expect(groupToday(items)[0].subs?.map((s) => s.sub)).toEqual(["recruiting"]);
  });

  it("puts a name on your list under Customer pipeline, standing in with its name", () => {
    const items = buildTodayItems(
      base({
        referrals: [
          reminder({
            board: "customer",
            cardId: "le-1",
            ref: { kind: "entry", id: "le-1" },
            name: "Ray Dunn",
          }),
        ],
      }),
    );
    expect(items[0]).toMatchObject({ filter: "pipeline", sub: "customer" });
    expect(items[0].person).toMatchObject({ id: "le-1", name: "Ray Dunn" });
  });

  it("stays gentle: below a booked step or a contact that's overdue", () => {
    const items = buildTodayItems(
      base({
        people: [
          person("lead", { bizClass: "ibo", sponsorId: null }),
          person("hector"),
          person("ann"),
        ],
        lastContact: new Map([
          ["hector", daysFromToday(0)],
          ["ann", daysFromToday(-20)],
        ]),
        referrals: [reminder({ days: 60 })],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["prospect", "referral"]);
    expect(items[1].score).toBe(99);
  });

  it("respects Do not contact and never shows to candidates", () => {
    expect(
      buildTodayItems(base({ referrals: [reminder()], doNotContact: new Set(["hector"]) })),
    ).toEqual([]);
    expect(buildTodayItems(base({ referrals: [reminder()], role: "candidate" }))).toEqual([]);
  });
});
