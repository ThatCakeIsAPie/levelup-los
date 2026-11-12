import { describe, expect, it } from "vitest";
import { seedAttendances, seedContacts, seedEvents, seedPeople, seedSales } from "@/data/seed";
import { filterAttendances, visibleIdSet, type Viewer } from "@/data/access";
import { daysFromToday } from "@/lib/dates";
import type { CrmPerson, DueBooking, Role } from "@/data";
import {
  buildTodayItems,
  countByFilter,
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

function lastContactMap(ids: Set<string>) {
  const m = new Map<string, string>();
  for (const c of contacts) {
    if (!ids.has(c.personId)) continue;
    const prev = m.get(c.personId);
    if (!prev || c.date > prev) m.set(c.personId, c.date);
  }
  return m;
}

/** Inputs exactly as the dashboard would see them for a demo user. */
function inputFor(personId: string, role: Role): TodayInput {
  const viewer: Viewer = { personId, role };
  const ids = visibleIdSet(people, viewer);
  return {
    viewerId: personId,
    role,
    people: people.filter((p) => ids.has(p.id)),
    lastContact: lastContactMap(ids),
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

describe("buildTodayItems (seed data)", () => {
  const maria = buildTodayItems(inputFor("1", "leader"));

  it("puts Sarah Kim's missed ticket date first for Maria", () => {
    expect(maria[0].kind).toBe("ticket");
    expect(maria[0].person.name).toBe("Sarah Kim");
    if (maria[0].kind === "ticket") {
      expect(maria[0].daysLate).toBe(2);
      expect(maria[0].event.id).toBe("e1");
    }
  });

  it("includes overdue customers, overdue team members and anniversaries", () => {
    const keys = maria.map((i) => i.key);
    expect(keys).toContain("customer:c4"); // Omar Haddad, 52 days
    expect(keys).toContain("customer:c2"); // Peter Vargas, 36 days
    expect(keys).not.toContain("customer:c1"); // contacted 4 days ago
    expect(keys).toContain("team:3"); // David Chen, 20 days
    expect(keys).toContain("anniversary:4"); // Jamal, 53 days out
    expect(keys).toContain("anniversary:19"); // Sky Ortiz, 30-day notice
    expect(keys).not.toContain("team:1"); // never the viewer
  });

  it("never shows customers owned by someone else", () => {
    expect(maria.some((i) => i.key === "customer:c6")).toBe(false); // Anita's customer
  });

  it("ranks by urgency", () => {
    const idx = (k: string) => maria.findIndex((i) => i.key === k);
    expect(idx("anniversary:19")).toBeLessThan(idx("customer:c4")); // 30-day notice
    expect(idx("customer:c4")).toBeLessThan(idx("anniversary:4")); // 52/30 > 90-day notice
    expect(idx("anniversary:4")).toBeLessThan(idx("team:3")); // 90-day notice > 20/14
    for (let i = 1; i < maria.length; i++) {
      expect(maria[i - 1].score).toBeGreaterThanOrEqual(maria[i].score);
    }
  });

  it("counts items per filter", () => {
    const c = countByFilter(maria);
    expect(c.all).toBe(maria.length);
    expect(c.team + c.customers + c.events + c.pipeline).toBe(c.all);
    expect(c.customers).toBe(2);
  });

  it("shows Jamal his own anniversary and only his team", () => {
    const jamal = buildTodayItems(inputFor("4", "apprentice"));
    const own = jamal.find((i) => i.key === "anniversary:4");
    expect(own?.self).toBe(true);
    expect(jamal.some((i) => i.key === "team:3")).toBe(false); // David isn't in Jamal's team
    expect(jamal.some((i) => i.key === "customer:c8")).toBe(true); // Kofi, 31 days
  });

  it("gives candidates only their own event items", () => {
    const beau = buildTodayItems(inputFor("20", "candidate"));
    expect(beau.every((i) => i.filter === "events" && i.self)).toBe(true);
  });
});

describe("buildTodayItems (rules)", () => {
  const base = (over: Partial<TodayInput>): TodayInput => ({
    viewerId: "me",
    role: "leader",
    people: [person({ id: "me", bizClass: "ibo" })],
    lastContact: new Map(),
    settings,
    events: [],
    attendances: [],
    sales: [],
    ...over,
  });
  const event = { id: "ev", name: "Rally", categoryId: "w1-conference", date: daysFromToday(20) };
  const row = (o: Partial<TodayInput["attendances"][number]>) => ({
    id: "a",
    eventId: "ev",
    personId: "p",
    hasTicket: false,
    leadershipQualified: false,
    specialEventQualified: false,
    ...o,
  });

  it("flags follow-ups due today or tomorrow, not later ones", () => {
    const p = person({ id: "p" });
    const mk = (followUpDate: string) =>
      buildTodayItems(
        base({
          people: [p],
          lastContact: new Map([["p", daysFromToday(0)]]),
          events: [event],
          attendances: [row({ followUpDate, desireToAttend: "maybe" })],
        }),
      );
    expect(mk(daysFromToday(0))[0]?.kind).toBe("followup");
    expect(mk(daysFromToday(1))[0]?.kind).toBe("followup");
    expect(mk(daysFromToday(-3))[0]?.kind).toBe("followup");
    expect(mk(daysFromToday(2))).toHaveLength(0);
  });

  it("skips ticket holders, people who said no, and finished events", () => {
    const p = person({ id: "p" });
    const late = { plannedPurchaseDate: daysFromToday(-1) };
    const run = (o: object, ev = event) =>
      buildTodayItems(
        base({
          people: [p],
          lastContact: new Map([["p", daysFromToday(0)]]),
          events: [ev],
          attendances: [row(o)],
        }),
      );
    expect(run(late)).toHaveLength(1);
    expect(run({ ...late, hasTicket: true })).toHaveLength(0);
    expect(run({ ...late, desireToAttend: "no" })).toHaveLength(0);
    expect(run(late, { ...event, date: daysFromToday(-5) })).toHaveLength(0);
  });

  it("uses the contact thresholds", () => {
    const p = person({ id: "p" });
    const run = (teamDays: number) =>
      buildTodayItems(
        base({
          people: [p],
          lastContact: new Map([["p", daysFromToday(-10)]]),
          settings: { teamDays, customerDays: 30 },
        }),
      );
    expect(run(14)).toHaveLength(0);
    expect(run(7)).toHaveLength(1);
  });

  it("counts never-contacted people from the day they joined", () => {
    const fresh = person({ id: "n", joinedDate: daysFromToday(-3), bizClass: "apprentice" });
    const old = person({ id: "o", joinedDate: daysFromToday(-40), bizClass: "apprentice" });
    const items = buildTodayItems(base({ people: [fresh, old] }));
    expect(items.map((i) => i.key)).toEqual(["team:o"]);
    expect(items[0].kind === "team" && items[0].never).toBe(true);
  });
});

describe("do not contact", () => {
  it("drops every item about people in Do not contact", () => {
    const input = inputFor("1", "leader");
    const all = buildTodayItems(input);
    const customer = all.find((i) => i.kind === "customer")!;
    const skip = new Set([customer.person.id, "7"]);
    const left = buildTodayItems({ ...input, doNotContact: skip });
    expect(left.some((i) => skip.has(i.person.id))).toBe(false);
    expect(left.length).toBe(all.filter((i) => !skip.has(i.person.id)).length);
  });
});

describe("booked pipeline steps", () => {
  const col = { id: "first_meeting", band: "first_meeting", kind: "milestone", label: "First meeting (MG1)" } as const; // prettier-ignore
  const due = (o: Partial<DueBooking> & { cardId: string }): DueBooking => ({
    board: "recruiting",
    name: `Name ${o.cardId}`,
    ownerId: "me",
    column: col,
    date: daysFromToday(0),
    time: null,
    due: "today",
    daysLate: 0,
    ...o,
  });
  const input = (bookings: DueBooking[], over: Partial<TodayInput> = {}): TodayInput => ({
    viewerId: "me",
    role: "apprentice",
    people: [person({ id: "me", bizClass: "apprentice" }), person({ id: "p1", name: "Grace Kim" })],
    lastContact: new Map([["p1", daysFromToday(0)]]),
    settings,
    events: [],
    attendances: [],
    sales: [],
    bookings,
    ...over,
  });

  it("lists due steps under Pipeline, overdue ones first, above IBO anniversaries", () => {
    const items = buildTodayItems(
      input([
        due({ cardId: "p1", name: "Grace Kim" }),
        due({ cardId: "le-1", board: "customer", name: "Lena Orr", due: "overdue", daysLate: 2 }),
      ]),
    );
    expect(items.map((i) => i.key)).toEqual(["step:customer:le-1", "step:recruiting:p1"]);
    expect(items.every((i) => i.filter === "pipeline")).toBe(true);
    expect(items.map((i) => i.sub)).toEqual(["customer", "recruiting"]);
    expect(items[0].score).toBe(752);
    expect(items[0].score).toBeGreaterThan(700);
    expect(items[0].score).toBeLessThan(800);
    // A prospect is the real person; a list name stands in with its name.
    expect(items[1].person.name).toBe("Grace Kim");
    expect(items[0].person).toMatchObject({ id: "le-1", name: "Lena Orr" });
    expect(countByFilter(items).pipeline).toBe(2);
  });

  it("leaves out Do not contact and candidates", () => {
    expect(
      buildTodayItems(input([due({ cardId: "p1" })], { doNotContact: new Set(["p1"]) })),
    ).toHaveLength(0);
    expect(buildTodayItems(input([due({ cardId: "p1" })], { role: "candidate" }))).toHaveLength(0);
  });
});
