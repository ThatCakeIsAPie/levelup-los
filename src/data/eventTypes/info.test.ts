import { describe, expect, it } from "vitest";
import type { Attendance } from "@/stores/attendanceStore";
import { attentionItems } from "../attention";
import {
  EVENT_TYPES,
  allowsVirtual,
  canManageEvents,
  eventFormat,
  eventModes,
  usesTickets,
  usesTravel,
} from "./info";

const row = (o: Partial<Attendance>): Attendance => ({
  id: "a",
  eventId: "e",
  personId: "p",
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...o,
});

describe("event types", () => {
  it("follows the plan's table", () => {
    expect(EVENT_TYPES.filter(allowsVirtual)).toEqual([
      "info_session",
      "training",
      "monthly_meeting",
      "conference",
    ]);
    expect(EVENT_TYPES.filter(usesTickets)).toEqual(["monthly_meeting", "conference"]);
    expect(EVENT_TYPES.filter(usesTravel)).toEqual(["conference"]);
  });

  it("keeps in-person-only types in person", () => {
    expect(eventFormat({ type: "night_owls", format: "virtual" })).toBe("in_person");
    expect(eventFormat({ type: "training" })).toBe("in_person");
    expect(eventModes({ type: "info_session", format: "both" })).toEqual(["in_person", "virtual"]);
    expect(eventModes({ type: "conference", format: "virtual" })).toEqual(["virtual"]);
  });

  it("lets everyone but candidates plan events (for now)", () => {
    expect(canManageEvents({ role: "leader" })).toBe(true);
    expect(canManageEvents({ role: "apprentice" })).toBe(true);
    expect(canManageEvents({ role: "candidate" })).toBe(false);
  });
});

describe("attentionItems for events without tickets", () => {
  const now = new Date(2026, 9, 13, 12);
  const upcoming = { type: "night_owls" as const, date: "2026-10-16" };

  it("doesn't nag about tickets or helpers", () => {
    const rows = [
      row({ id: "1", desireToAttend: "yes" }),
      row({ id: "2", desireToAttend: "yes", plannedPurchaseDate: "2026-10-01" }),
    ];
    expect(attentionItems(upcoming, rows, now)).toEqual([]);
    // The same rows on a conference do need attention.
    expect(attentionItems({ ...upcoming, type: "conference" }, rows, now)).toHaveLength(2);
  });

  it("still flags a follow-up that's due", () => {
    const items = attentionItems(upcoming, [row({ followUpDate: "2026-10-14" })], now);
    expect(items.map((i) => i.code)).toEqual(["followup_due"]);
  });

  it("never flags unrecorded attendance once it's over", () => {
    const past = { type: "work_session" as const, date: "2026-10-01" };
    expect(attentionItems(past, [row({ hasTicket: true })], now)).toEqual([]);
  });
});
