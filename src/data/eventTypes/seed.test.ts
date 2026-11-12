import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { DEMO_USERS } from "@/stores/sessionStore";
import { filterAttendances, visibleIdSet } from "../access";
import { seedAttendances, seedContacts, seedEvents, seedMissedNotes, seedPeople } from "../seed";
import { categoryLookup, eventFormat, startingCategories } from "../eventCategories/rules";
import { missedAudience, missedEventStreaks, openMissedFollowUps } from "./missed";

const categories = startingCategories();
const categoryOf = categoryLookup(categories);

const people = seedPeople();
const events = seedEvents();
const attendances = seedAttendances();
const contacts = seedContacts(people);
const notes = seedMissedNotes();

/** What the Today list shows a demo user (same steps as useMissedFollowUps). */
function followUpsFor(personId: string) {
  const user = DEMO_USERS.find((u) => u.personId === personId)!;
  const ids = visibleIdSet(people, { personId, role: user.role });
  if (user.role === "candidate") return [];
  const streaks = missedEventStreaks({
    events,
    attendances: filterAttendances(attendances, ids),
    contacts: contacts.filter((c) => ids.has(c.personId)),
    notes: notes.filter((n) => ids.has(n.personId)),
    today: localDate(),
    categories,
  });
  const audience = missedAudience(
    people.filter((p) => ids.has(p.id)),
    personId,
  );
  return openMissedFollowUps(streaks, personId, audience).map(
    (s) => `${s.personId}:${s.latest.id}`,
  );
}

describe("seed: event categories and missed-event follow-ups", () => {
  it("uses every starting category, with formats its category allows", () => {
    const used = new Set(events.map((e) => e.categoryId));
    expect([...used].sort()).toEqual(categories.map((c) => c.id).sort());
    for (const e of events) expect(eventFormat(e, categoryOf(e))).toBe(e.format);
    expect(events.filter((e) => e.categoryId === "w1-night_owls")).toHaveLength(7);
  });

  it("gives the demo logins their follow-ups", () => {
    expect(followUpsFor("1").sort()).toEqual(["4:ws2", "700:no5", "7:tr2"]);
    expect(followUpsFor("2").sort()).toEqual(["4:ws2", "700:no5"]);
    expect(followUpsFor("4")).toEqual(["700:no5"]);
    expect(followUpsFor("700")).toEqual([]);
    expect(followUpsFor("20")).toEqual([]);
  });

  it("keeps Layla's miss handled by Priya's note", () => {
    const ids = visibleIdSet(people, { personId: "1", role: "leader" });
    const layla = missedEventStreaks({
      events,
      attendances: filterAttendances(attendances, ids),
      contacts,
      notes,
      today: localDate(),
    }).find((s) => s.personId === "14");
    expect(layla?.handled).toMatchObject({ kind: "note", note: { byId: "8" } });
  });
});
