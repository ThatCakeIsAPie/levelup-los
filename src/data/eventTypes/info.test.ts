import { describe, expect, it } from "vitest";
import type { Attendance } from "@/stores/attendanceStore";
import { attentionItems } from "../attention";
import { canManageEvents } from "./info";

const row = (o: Partial<Attendance>): Attendance => ({
  id: "a",
  eventId: "e",
  personId: "p",
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...o,
});

describe("who may plan events", () => {
  it("lets everyone but candidates plan events (for now)", () => {
    expect(canManageEvents({ role: "leader" })).toBe(true);
    expect(canManageEvents({ role: "apprentice" })).toBe(true);
    expect(canManageEvents({ role: "candidate" })).toBe(false);
  });
});

describe("attentionItems for events whose category has no tickets", () => {
  const now = new Date(2026, 9, 13, 12);
  // A category without tickets (Night Owls); `tickets` comes from usesTickets(category).
  const upcoming = { tickets: false, date: "2026-10-16" };

  it("doesn't nag about tickets or helpers", () => {
    const rows = [
      row({ id: "1", desireToAttend: "yes" }),
      row({ id: "2", desireToAttend: "yes", plannedPurchaseDate: "2026-10-01" }),
    ];
    expect(attentionItems(upcoming, rows, now)).toEqual([]);
    // The same rows on a conference do need attention.
    expect(attentionItems({ ...upcoming, tickets: true }, rows, now)).toHaveLength(2);
  });

  it("still flags a follow-up that's due", () => {
    const items = attentionItems(upcoming, [row({ followUpDate: "2026-10-14" })], now);
    expect(items.map((i) => i.code)).toEqual(["followup_due"]);
  });

  it("never flags unrecorded attendance once it's over", () => {
    const past = { tickets: false, date: "2026-10-01" };
    expect(attentionItems(past, [row({ hasTicket: true })], now)).toEqual([]);
  });
});
