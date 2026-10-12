import { describe, expect, it } from "vitest";
import { addYears } from "date-fns";
import { daysFromToday, localDate, parseDate } from "@/lib/dates";
import { seedAttendances, seedEvents, seedPeople } from "./seed";

const people = seedPeople();
const byId = new Map(people.map((p) => [p.id, p]));

describe("seed people", () => {
  it("every sponsor is an apprentice or IBO (prospects have no downline)", () => {
    for (const p of people) {
      if (p.bizClass === "customer" || !p.sponsorId) continue;
      const sponsor = byId.get(p.sponsorId);
      expect(sponsor, `${p.id} has a missing sponsor`).toBeDefined();
      expect(["apprentice", "ibo"], `${p.id} is sponsored by a ${sponsor?.bizClass}`).toContain(
        sponsor?.bizClass,
      );
    }
  });

  it("customers are owned by an apprentice or IBO and never sponsor anyone", () => {
    for (const c of people.filter((p) => p.bizClass === "customer")) {
      expect(["apprentice", "ibo"]).toContain(byId.get(c.ownerId ?? "")?.bizClass);
      expect(people.some((p) => p.sponsorId === c.id)).toBe(false);
    }
  });

  it("Jamal is an apprentice 53 days from IBO with prospects 9 and 21 and customer c8", () => {
    const jamal = byId.get("4")!;
    expect(jamal.bizClass).toBe("apprentice");
    expect(localDate(addYears(parseDate(jamal.businessStartDate!), 1))).toBe(daysFromToday(53));
    expect(byId.get("9")?.sponsorId).toBe("4");
    expect(byId.get("21")?.sponsorId).toBe("4");
    expect(people.filter((p) => p.ownerId === "4").map((p) => p.id)).toEqual(["c8"]);
  });
});

describe("seed events", () => {
  it("Fall Leadership Weekend is 26 days out with 20 invited and 12 tickets", () => {
    const e1 = seedEvents().find((e) => e.id === "e1")!;
    expect(e1.date).toBe(daysFromToday(26));
    const rows = seedAttendances().filter((a) => a.eventId === "e1");
    expect(rows).toHaveLength(20);
    expect(rows.filter((a) => a.hasTicket)).toHaveLength(12);
  });
});
