/**
 * Today's groups go by who the item is about (Jay's requests, 2026-10-16):
 * Team (registered people only), Customers, Pipeline (Recruiting / Customer)
 * and Events, plus "Invite your customers".
 */
import { describe, expect, it } from "vitest";
import { seedAttendances, seedContacts, seedEvents, seedPeople, seedSales } from "@/data/seed";
import { filterAttendances, visibleIdSet, type Viewer } from "@/data/access";
import { daysFromToday } from "@/lib/dates";
import { startingCategories } from "@/data/eventCategories/rules";
import type { Attendance, CrmEvent, CrmPerson, DueBooking, Role } from "@/data";
import {
  buildTodayItems,
  groupToday,
  INVITE_WINDOW_DAYS,
  MAX_INVITES,
  type TodayInput,
  type TodayItem,
} from "./today";

const people = seedPeople();
const contacts = seedContacts(people);
const events = seedEvents();
const attendances = seedAttendances();
const sales = seedSales();
const settings = { teamDays: 14, customerDays: 30 };

/** Inputs as the dashboard would see them for a demo user. */
function inputFor(personId: string, role: Role): TodayInput {
  const viewer: Viewer = { personId, role };
  const ids = visibleIdSet(people, viewer);
  const lastContact = new Map<string, string>();
  for (const c of contacts) {
    if (!ids.has(c.personId)) continue;
    const prev = lastContact.get(c.personId);
    if (!prev || c.date > prev) lastContact.set(c.personId, c.date);
  }
  return {
    viewerId: personId,
    role,
    people: people.filter((p) => ids.has(p.id)),
    lastContact,
    settings,
    events,
    attendances: filterAttendances(attendances, ids),
    sales: sales.filter((s) => ids.has(s.customerId)),
  };
}

const person = (o: Partial<CrmPerson> & { id: string }): CrmPerson => ({
  name: `Person ${o.id}`,
  bizClass: "prospect",
  ...o,
});
const me = person({ id: "me", name: "Maria", bizClass: "ibo" });
const empty = (over: Partial<TodayInput>): TodayInput => ({
  viewerId: "me",
  role: "ibo",
  people: [me],
  lastContact: new Map(),
  settings,
  events: [],
  attendances: [],
  sales: [],
  ...over,
});
const row = (id: string, eventId: string, personId: string, o: Partial<Attendance> = {}) => ({
  id,
  eventId,
  personId,
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...o,
});
const registered = (i: TodayItem) =>
  i.person.bizClass === "apprentice" || i.person.bizClass === "ibo";

describe("groups go by who the item is about", () => {
  it("never puts a prospect under Team, for any demo login", () => {
    const logins = [
      ["1", "leader"],
      ["2", "ibo"],
      ["4", "apprentice"],
      ["700", "apprentice"],
    ] as const;
    for (const [id, role] of logins) {
      const items = buildTodayItems(inputFor(id, role));
      expect(items.filter((i) => i.filter === "team").every(registered)).toBe(true);
      for (const i of items.filter((x) => x.kind === "prospect")) {
        expect(i).toMatchObject({ filter: "pipeline", sub: "recruiting" });
        expect(i.person.bizClass).toBe("prospect");
      }
      for (const i of items.filter((x) => x.filter === "customers")) {
        expect(i.person.bizClass).toBe("customer");
      }
    }
    // Maria's team has prospects nobody has checked in with lately.
    expect(buildTodayItems(inputFor("1", "leader")).some((i) => i.kind === "prospect")).toBe(true);
  });

  it('puts "Check in with Finley Underwood" (a prospect) under Pipeline › Recruiting', () => {
    const finley = person({ id: "f", name: "Finley Underwood", joinedDate: daysFromToday(-60) });
    const sam = person({
      id: "s",
      name: "Sam Ortiz",
      bizClass: "apprentice",
      joinedDate: daysFromToday(-60),
    });
    const items = buildTodayItems(empty({ people: [me, finley, sam] }));
    expect(items.find((i) => i.person.id === "f")).toMatchObject({
      key: "prospect:f",
      kind: "prospect",
      filter: "pipeline",
      sub: "recruiting",
    });
    expect(items.find((i) => i.person.id === "s")).toMatchObject({ kind: "team", filter: "team" });
    const groups = groupToday(items);
    expect(groups.map((g) => g.filter)).toEqual(["team", "pipeline"]);
    expect(groups[1].subs?.map((s) => s.sub)).toEqual(["recruiting"]);
  });

  it("counts an apprentice past their year as registered (Team)", () => {
    const old = person({
      id: "a",
      bizClass: "apprentice",
      businessStartDate: daysFromToday(-400),
      joinedDate: daysFromToday(-400),
    });
    const items = buildTodayItems(empty({ people: [me, old] }));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.filter === "team")).toBe(true);
  });

  it("puts booked steps on names that already buy under Customers, the rest under Pipeline › Customer", () => {
    const col = { id: "on_ditto", band: "on_ditto", kind: "milestone", label: "On Ditto" } as const;
    const step = (cardId: string, customerId?: string): DueBooking => ({
      board: "customer",
      cardId,
      name: `Name ${cardId}`,
      ownerId: "me",
      column: col,
      date: daysFromToday(0),
      time: null,
      due: "today",
      daysLate: 0,
      ...(customerId ? { customerId } : {}),
    });
    const items = buildTodayItems(empty({ bookings: [step("le-1", "c9"), step("le-2")] }));
    expect(items.find((i) => i.key === "step:customer:le-1")).toMatchObject({
      filter: "customers",
    });
    expect(items.find((i) => i.key === "step:customer:le-1")?.sub).toBeUndefined();
    expect(items.find((i) => i.key === "step:customer:le-2")).toMatchObject({
      filter: "pipeline",
      sub: "customer",
    });
  });

  it("keeps event items under Events whoever they're about, customers on the list included", () => {
    const ev: CrmEvent = {
      id: "ev",
      name: "Rally",
      categoryId: "w1-monthly_meeting",
      date: daysFromToday(9),
    };
    const cust = person({ id: "c", name: "Cara", bizClass: "customer", ownerId: "me" });
    const pro = person({ id: "p", name: "Pat" });
    const late = { plannedPurchaseDate: daysFromToday(-1) };
    const items = buildTodayItems(
      empty({
        people: [me, cust, pro],
        lastContact: new Map([
          ["c", daysFromToday(0)],
          ["p", daysFromToday(0)],
        ]),
        events: [ev],
        attendances: [row("a1", "ev", "c", late), row("a2", "ev", "p", late)],
      }),
    );
    expect(items.map((i) => [i.kind, i.person.id, i.filter])).toEqual([
      ["ticket", "c", "events"],
      ["ticket", "p", "events"],
    ]);
  });

  it("respects Do not contact in every group", () => {
    const input = inputFor("1", "leader");
    const all = buildTodayItems(input);
    const prospect = all.find((i) => i.kind === "prospect")!;
    const left = buildTodayItems({ ...input, doNotContact: new Set([prospect.person.id]) });
    expect(left.some((i) => i.person.id === prospect.person.id)).toBe(false);
  });

  it("groups in the chip order, each keeping the list's order", () => {
    const items = buildTodayItems(inputFor("1", "leader"));
    const groups = groupToday(items);
    expect(groups.map((g) => g.filter)).toEqual(["team", "customers", "pipeline", "events"]);
    expect(groups.flatMap((g) => g.items)).toHaveLength(items.length);
    for (const g of groups) {
      expect(g.items).toEqual(items.filter((i) => i.filter === g.filter));
      if (g.subs) expect(g.subs.flatMap((x) => x.items)).toHaveLength(g.items.length);
    }
  });
});

describe("invite your customers", () => {
  const mine = [
    person({ id: "c1", name: "Grace", bizClass: "customer", ownerId: "me" }),
    person({ id: "c2", name: "Omar", bizClass: "customer", ownerId: "me" }),
  ];
  const theirs = person({ id: "c3", name: "Wes", bizClass: "customer", ownerId: "other" });
  const ev = (id: string, key: string, days: number): CrmEvent => ({
    id,
    name: `Event ${id}`,
    categoryId: key.startsWith("team-") ? key : `w1-${key}`,
    date: daysFromToday(days),
  });
  const run = (over: Partial<TodayInput> = {}) =>
    buildTodayItems(
      empty({
        role: "apprentice",
        people: [me, ...mine, theirs],
        lastContact: new Map(["c1", "c2", "c3"].map((id) => [id, daysFromToday(0)])),
        events: [
          ev("mm", "monthly_meeting", 10),
          ev("conf", "conference", 5),
          ev("is", "info_session", 3),
        ],
        ...over,
      }),
    ).filter((i) => i.kind === "invite");

  it("suggests the soonest events customers are welcome at, under Events", () => {
    const items = run();
    expect(items.map((i) => i.key)).toEqual(["invite:is", "invite:mm"]);
    expect(items.length).toBeLessThanOrEqual(MAX_INVITES);
    expect(items.every((i) => i.filter === "events" && i.self)).toBe(true);
    const first = items[0];
    expect(first.kind === "invite" && first.customers.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("leaves out customers already on the list and Do not contact", () => {
    const one = run({
      attendances: [row("a", "is", "c1")],
      doNotContact: new Set(["c2"]),
    });
    expect(one.map((i) => i.key)).toEqual(["invite:mm"]);
    expect(one[0].kind === "invite" && one[0].customers.map((c) => c.id)).toEqual(["c1"]);
  });

  it("leaves out events too far off, past ones and ones put off", () => {
    expect(run({ events: [ev("far", "info_session", INVITE_WINDOW_DAYS + 1)] })).toHaveLength(0);
    expect(run({ events: [ev("past", "info_session", -1)] })).toHaveLength(0);
    expect(run({ dismissedInvites: new Set(["is"]) }).map((i) => i.key)).toEqual(["invite:mm"]);
  });

  it("follows the categories' 'customers welcome' setting", () => {
    // The team switched it off for info sessions and has its own customer night.
    const categories = [
      ...startingCategories().map((c) =>
        c.id === "w1-info_session" ? { ...c, welcomesCustomers: false } : c,
      ),
      {
        ...startingCategories()[0],
        id: "team-customer_night",
        name: "Customer night",
        welcomesCustomers: true,
        position: 6,
      },
    ];
    const items = run({
      categories,
      events: [ev("is", "info_session", 3), ev("cn", "team-customer_night", 6)],
    });
    expect(items.map((i) => i.key)).toEqual(["invite:cn"]);
  });

  it("needs customers of your own, and never for candidates", () => {
    expect(run({ people: [me, theirs] })).toHaveLength(0);
    expect(run({ role: "candidate" })).toHaveLength(0);
  });

  it("ranks below the other event items", () => {
    const items = buildTodayItems(
      empty({
        role: "apprentice",
        people: [me, ...mine],
        lastContact: new Map(["c1", "c2"].map((id) => [id, daysFromToday(0)])),
        events: [ev("is", "info_session", 0)],
        attendances: [row("a", "is", "c1", { followUpDate: daysFromToday(0) })],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(["followup", "invite"]);
    expect(items[1].score).toBe(200);
    expect(items[1].kind === "invite" && items[1].customers.map((c) => c.id)).toEqual(["c2"]);
  });
});
