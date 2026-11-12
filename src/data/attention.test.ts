import { describe, expect, it } from "vitest";
import { getComparisonEvents } from "@/lib/selectors";
import { daysFromToday } from "@/lib/dates";
import type { Attendance } from "@/stores/attendanceStore";
import { seedAttendances, seedEvents, seedPeople } from "./seed";
import { filterAttendances, visibleIdSet } from "./access";
import { attentionItems, needsTicket, upcomingAttentionCount } from "./attention";
import { categoryLookup, startingCategories, usesTickets } from "./eventCategories/rules";

// Each event with whether its category uses tickets (as the hooks pass it).
const categoryOf = categoryLookup(startingCategories());
const events = seedEvents().map((e) => ({ ...e, tickets: usesTickets(categoryOf(e)) }));
const rows = seedAttendances();
const people = seedPeople();
const event = (id: string) => events.find((e) => e.id === id)!;
const forEvent = (id: string, all = rows) => all.filter((a) => a.eventId === id);

const row = (o: Partial<Attendance>): Attendance => ({
  id: "x",
  eventId: "e1",
  personId: "p",
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...o,
});

describe("attentionItems", () => {
  it("puts a passed ticket date first, one item per person", () => {
    const items = attentionItems(event("e1"), forEvent("e1"));
    expect(items[0].code).toBe("date_passed");
    expect(items[0].a.personId).toBe("7"); // Sarah Kim
    expect(new Set(items.map((i) => i.a.personId)).size).toBe(items.length);
  });

  it("ignores ticket holders and people not going unless a follow-up is due", () => {
    const e = event("e1");
    expect(attentionItems(e, [row({ hasTicket: true, desireToAttend: "yes" })])).toEqual([]);
    expect(attentionItems(e, [row({ desireToAttend: "no" })])).toEqual([]);
    const due = row({ desireToAttend: "no", followUpDate: daysFromToday(2) });
    expect(attentionItems(e, [due])[0].code).toBe("followup_due");
  });

  it("only flags unrecorded attendance once an event is over", () => {
    const past = event("e4");
    const unrecorded = row({ eventId: "e4", hasTicket: true });
    const late = row({ eventId: "e4", desireToAttend: "yes" });
    expect(attentionItems(past, [unrecorded, late]).map((i) => i.code)).toEqual(["unrecorded"]);
  });
});

describe("upcomingAttentionCount (Events nav badge)", () => {
  it("equals the sum of the counts on the upcoming event cards", () => {
    const ids = visibleIdSet(people, { personId: "1", role: "leader" });
    const visible = filterAttendances(rows, ids);
    const perCard =
      attentionItems(event("e1"), forEvent("e1", visible)).length +
      attentionItems(event("e5"), forEvent("e5", visible)).length;
    expect(perCard).toBeGreaterThan(0);
    expect(upcomingAttentionCount(events, visible)).toBe(perCard);
  });

  it("skips finished events", () => {
    const pastOnly = events.filter((e) => e.id === "e4");
    expect(upcomingAttentionCount(pastOnly, [row({ eventId: "e4", hasTicket: true })])).toBe(0);
  });
});

describe("needsTicket", () => {
  it("counts everyone without a ticket who hasn't said no (e1: 7 of 20)", () => {
    expect(forEvent("e1").filter(needsTicket)).toHaveLength(7);
  });
});

describe("getComparisonEvents", () => {
  it("picks the previous same-category event and the one about a year ago", () => {
    const r = getComparisonEvents(event("e1"), events);
    expect(r.prior?.id).toBe("e3"); // Summer Conference, the last conference before
    expect(r.lastYear?.id).toBe("e2"); // last year's Fall Leadership Weekend
    expect(getComparisonEvents(event("e5"), events).prior?.id).toBe("e4");
  });
});

describe("do not contact", () => {
  it("leaves people in Do not contact out of every reminder", () => {
    const e = event("e1");
    const all = forEvent("e1");
    const skip = new Set(["7"]); // Sarah Kim
    const items = attentionItems(e, all, undefined, skip);
    expect(items.some((i) => i.a.personId === "7")).toBe(false);
    expect(items.length).toBe(attentionItems(e, all).length - 1);
    expect(upcomingAttentionCount(events, rows, undefined, skip)).toBe(
      upcomingAttentionCount(
        events,
        rows.filter((a) => a.personId !== "7"),
      ),
    );
  });
});
