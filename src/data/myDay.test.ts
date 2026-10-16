import { describe, expect, it } from "vitest";
import type { ActivityEvent } from "@/stores/activityStore";
import type { CrmPerson } from "@/stores/peopleStore";
import { localDate } from "@/lib/dates";
import { myDayItems, type MyDayInput } from "./myDay";

const today = localDate();
const at = (h: number, m = 0) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const yesterday = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString();
};

const people: CrmPerson[] = [
  { id: "me", name: "Maria Reyes", bizClass: "ibo" },
  { id: "p1", name: "Grace Kim", bizClass: "prospect", sponsorId: "me" },
  { id: "c1", name: "Omar Haddad", bizClass: "customer", ownerId: "me" },
  { id: "t1", name: "Jamal Brown", bizClass: "apprentice", sponsorId: "me" },
];

const base = (over: Partial<MyDayInput> = {}): MyDayInput => ({
  viewerId: "me",
  today,
  people,
  events: [{ id: "e1", name: "Night Owls", categoryId: "w1-night_owls", date: today }],
  activity: [],
  contacts: [],
  sales: [],
  learning: [],
  pipelineMoves: [],
  cancellations: [],
  customerMoves: [],
  entries: [],
  missedNotes: [],
  ...over,
});

const act = (o: Partial<ActivityEvent> & Pick<ActivityEvent, "kind">): ActivityEvent => ({
  id: crypto.randomUUID(),
  timestamp: at(9),
  actorName: "You",
  entityType: "person",
  entityId: "p1",
  relatedPersonId: "p1",
  summary: "",
  ...o,
});

describe("myDayItems", () => {
  it("lists your own actions today, newest first, with times", () => {
    const items = myDayItems(
      base({
        contacts: [
          { id: "k1", personId: "t1", byId: "me", date: today, createdAt: at(8, 5) },
          { id: "k2", personId: "c1", byId: "me", date: today, createdAt: at(11) },
        ],
        sales: [
          { id: "s1", customerId: "c1", product: "Nutrilite", date: today, amount: 40, pv: 12, createdAt: at(10) }, // prettier-ignore
        ],
        learning: [
          { id: "l1", personId: "me", kind: "pages", title: "Atomic Habits", amount: 20, date: today, createdAt: at(7) }, // prettier-ignore
        ],
        pipelineMoves: [
          { id: "m1", personId: "p1", ownerId: "me", from: "contact", to: "first_meeting", milestone: "first_meeting", movedAt: at(12), movedBy: "me" }, // prettier-ignore
        ],
      }),
    );
    expect(items.map((i) => i.text)).toEqual([
      "Moved Grace Kim to First meeting",
      "Got in touch with Omar Haddad",
      "Logged a sale to Omar Haddad: Nutrilite · $40 · 12 PV",
      "Checked in with Jamal Brown",
      "Read 20 pages of Atomic Habits",
    ]);
    expect(items[0].time).toMatch(/^12:00 PM$/);
    expect(items.map((i) => i.kind)).toEqual([
      "pipeline",
      "checkin",
      "sale",
      "checkin",
      "learning",
    ]);
  });

  it("leaves out other days, other people's actions and automatic contacts", () => {
    const items = myDayItems(
      base({
        contacts: [
          { id: "k1", personId: "t1", byId: "me", date: localDate(new Date(yesterday())) },
          { id: "k2", personId: "t1", byId: "t1", date: today },
          { id: "k3", personId: "t1", byId: "me", date: today, source: "message" },
        ],
        learning: [
          { id: "l1", personId: "t1", kind: "podcast", title: "Pod", amount: 1, date: today },
        ],
        pipelineMoves: [
          { id: "m1", personId: "p1", ownerId: "me", from: null, to: "contact", milestone: "contact", movedAt: at(9), movedBy: "t1" }, // prettier-ignore
          { id: "m2", personId: "p1", ownerId: "me", from: null, to: "contact", milestone: "contact", movedAt: yesterday(), movedBy: "me" }, // prettier-ignore
        ],
        activity: [
          act({ kind: "created", summary: "Added Grace Kim (Prospect)", actorName: "Jamal Brown", actorId: "t1" }), // prettier-ignore
          act({ kind: "created", summary: "Added Grace Kim (Prospect)", timestamp: yesterday() }),
          // Another demo login on this device ("You", but someone else's id).
          act({ kind: "created", summary: "Added Grace Kim (Prospect)", actorId: "t1" }),
        ],
      }),
    );
    expect(items).toEqual([]);
  });

  it("puts entries known only by their day after the timed ones", () => {
    const items = myDayItems(
      base({
        contacts: [{ id: "k1", personId: "t1", byId: "me", date: today }],
        learning: [
          { id: "l1", personId: "me", kind: "workshop", title: "Leadership", amount: 1, date: today, createdAt: at(6) }, // prettier-ignore
        ],
      }),
    );
    expect(items.map((i) => [i.text, i.time])).toEqual([
      ["Went to a workshop: Leadership", "6:00 AM"],
      ["Checked in with Jamal Brown", null],
    ]);
  });

  it("covers people, events, goals, lists, cancelled steps and handled notes", () => {
    const items = myDayItems(
      base({
        activity: [
          act({ kind: "created", summary: "Added Grace Kim (Prospect)", timestamp: at(8) }),
          act({ kind: "assigned_event", entityType: "attendance", entityId: "a1", relatedEventId: "e1", timestamp: at(9) }), // prettier-ignore
          act({ kind: "marked_attended", entityType: "attendance", entityId: "a2", relatedPersonId: "me", relatedEventId: "e1", timestamp: at(10) }), // prettier-ignore
          act({ kind: "updated", relatedPersonId: "me", entityId: "me", summary: "Edited weekly goal", meta: { goal: true }, timestamp: at(11) }), // prettier-ignore
          act({ kind: "updated", summary: "Edited phone", timestamp: at(12) }),
          act({ kind: "updated", summary: "Change undone", timestamp: at(12, 30) }),
          act({ kind: "note", summary: "MG1 cancelled · No-show", meta: { cancellationId: "x1" }, timestamp: at(13) }), // prettier-ignore
          act({ kind: "created", entityType: "event", entityId: "e1", relatedPersonId: undefined, relatedEventId: "e1", summary: "Created event Night Owls", timestamp: at(14) }), // prettier-ignore
        ],
        cancellations: [
          { id: "x1", board: "recruiting", cardId: "p1", ownerId: "me", column: "first_meeting", bookedDate: today, bookedTime: null, reason: "no_show", reasonText: null, cancelledAt: at(13), cancelledBy: "me" }, // prettier-ignore
        ],
        recruitingColumns: [
          {
            id: "first_meeting",
            band: "first_meeting",
            kind: "milestone",
            label: "First meeting (MG1)",
          },
        ],
        entries: [
          { id: "le1", ownerId: "me", name: "Jay Holloway", howKnown: null, phone: null, email: null, notes: null, rating: null, customerId: null, prospectId: null, addedBy: "me", createdAt: at(15), updatedAt: at(15) } as never, // prettier-ignore
          { id: "le2", ownerId: "t1", name: "Kim Bray", howKnown: null, phone: null, email: null, notes: null, rating: null, customerId: null, prospectId: null, addedBy: "me", createdAt: at(15, 30), updatedAt: at(15, 30) } as never, // prettier-ignore
        ],
        missedNotes: [
          {
            id: "n1",
            personId: "t1",
            eventId: "e1",
            note: "Was sick",
            byId: "me",
            createdAt: at(16),
          },
        ],
      }),
    );
    expect(items.map((i) => i.text)).toEqual([
      "Noted Jamal Brown missing Night Owls: Was sick",
      "Added Kim Bray to Jamal Brown's list",
      "Added Jay Holloway to your list",
      "Created event Night Owls",
      "Grace Kim: MG1 cancelled · No-show",
      "Updated Grace Kim's details",
      "Updated your weekly goal",
      "Went to Night Owls",
      "Added Grace Kim to Night Owls",
      "Added Grace Kim (Prospect)",
    ]);
  });

  it("counts your own orders and customer pipeline moves", () => {
    const items = myDayItems(
      base({
        sales: [
          { id: "s1", customerId: "me", product: "Protein", date: today, pv: 30, createdAt: at(9) },
        ],
        entries: [
          { id: "le1", ownerId: "me", name: "Lena Ortega", howKnown: null, phone: null, email: null, notes: null, rating: null, customerId: null, prospectId: null, addedBy: "t1", createdAt: yesterday(), updatedAt: yesterday() } as never, // prettier-ignore
        ],
        customerMoves: [
          { id: "cm1", entryId: "le1", ownerId: "me", from: "contact", to: "first_meeting", band: "first_meeting", movedAt: at(10), movedBy: "me", createdCustomerId: null, setDitto: false }, // prettier-ignore
        ],
      }),
    );
    expect(items.map((i) => i.text)).toEqual([
      "Moved Lena Ortega to First meeting on the customer pipeline",
      "Logged your own order: Protein · 30 PV",
    ]);
  });
});
