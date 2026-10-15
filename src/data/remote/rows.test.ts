import { describe, expect, it } from "vitest";
import {
  seedAttendances,
  seedContacts,
  seedEvents,
  seedLearningGoals,
  seedMilestoneMarks,
  seedPeople,
  seedPvOverrides,
  seedSales,
} from "@/data/seed";
import { seedChat } from "@/data/chat/seed";
import * as m from "./rows";

describe("row mappers", () => {
  it("round-trip every seed person, event and attendance row", () => {
    for (const p of seedPeople()) {
      const row = m.personToRow(p);
      expect(m.personToRow(m.personFromRow(row))).toEqual(row);
    }
    for (const e of seedEvents()) expect(m.eventFromRow(m.eventToRow(e))).toEqual(e);
    for (const a of seedAttendances()) {
      const row = m.attendanceToRow(a);
      expect(m.attendanceToRow(m.attendanceFromRow(row))).toEqual(row);
    }
    for (const c of seedContacts()) {
      const row = m.contactToRow(c);
      expect(m.contactToRow(m.contactFromRow(row))).toEqual(row);
    }
  });

  it("round-trip sales with PV, monthly PV, milestone marks and history", () => {
    for (const s of seedSales()) expect(m.saleFromRow(m.saleToRow(s))).toEqual(s);
    for (const o of seedPvOverrides()) {
      expect(m.pvOverrideFromRow(m.pvOverrideToRow(o))).toEqual(o);
    }
    for (const k of seedMilestoneMarks()) {
      expect(m.milestoneMarkFromRow(m.milestoneMarkToRow(k))).toEqual(k);
    }
    const h = {
      personId: "1",
      code: "6_50" as const,
      firstReachedOn: "2025-06-01",
      lastMetOn: "2026-09-30",
      recordedBy: "1",
      recordedAt: "2026-09-30T10:00:00.000Z",
    };
    expect(m.milestoneHistoryFromRow(m.milestoneHistoryToRow(h))).toEqual(h);
    // A sale logged without a seller leaves person_id to the database.
    const row = m.saleToRow({ id: "x", customerId: "c1", product: "P", date: "2026-10-01" });
    expect(row.person_id).toBeUndefined();
    expect(row.pv).toBeNull();
  });

  it("round-trip the chat contract field for field", () => {
    const chat = seedChat();
    for (const c of chat.conversations)
      expect(m.conversationFromRow(m.conversationToRow(c))).toEqual(c);
    for (const x of chat.messages) expect(m.messageFromRow(m.messageToRow(x))).toEqual(x);
    for (const x of chat.conversationMembers)
      expect(m.conversationMemberFromRow(m.conversationMemberToRow(x))).toEqual(x);
    for (const x of chat.notifications)
      expect(m.notificationFromRow(m.notificationToRow(x))).toEqual(x);
    for (const x of chat.attachments) expect(m.attachmentFromRow(m.attachmentToRow(x))).toEqual(x);
  });

  it("normalises Postgres timestamps so string comparisons keep working", () => {
    expect(m.iso("2026-10-12 15:04:05.123+00")).toBe("2026-10-12T15:04:05.123Z");
    expect(m.iso("2026-10-12T10:04:05-05:00")).toBe("2026-10-12T15:04:05.000Z");
    expect(m.iso(null)).toBeNull();
  });

  it("keeps customers and business people within the table's checks", () => {
    const row = m.personToRow({
      id: "c",
      name: "C",
      bizClass: "customer",
      ownerId: "4",
      sponsorId: "4",
    });
    expect(row.sponsor_id).toBeNull();
    expect(row.owner_id).toBe("4");
    const ibo = m.personToRow({ id: "i", name: "I", bizClass: "ibo", ownerId: "4" });
    expect(ibo.owner_id).toBeNull();
  });

  it("maps the viewer's own activity to 'You' and back to their name", () => {
    const a = m.activityFromRow(
      {
        id: "a1",
        timestamp: "2026-10-12 10:00:00+00",
        actor_name: "Maria Reyes",
        actor_id: "1",
        entity_type: "person",
        entity_id: "2",
        kind: "updated",
        summary: "Edited notes",
      },
      "1",
    );
    expect(a.actorName).toBe("You");
    expect(m.activityToRow(a, "Maria Reyes").actor_name).toBe("Maria Reyes");
    expect(
      m.activityFromRow({ ...m.activityToRow(a, "Maria Reyes"), actor_id: "1" }, "2").actorName,
    ).toBe("Maria Reyes");
  });
});

describe("customer pipeline row mappers", () => {
  it("round-trip every seed list entry, step, card and move", async () => {
    const { seedCustomerPipeline } = await import("@/data/customerPipeline/seed");
    const data = seedCustomerPipeline(seedPeople());
    for (const e of data.entries) {
      const row = m.listEntryToRow(e);
      expect(m.listEntryToRow(m.listEntryFromRow(row))).toEqual(row);
      // The customer link is the database's: never sent.
      expect("customer_id" in row).toBe(false);
    }
    for (const s of data.steps) expect(m.customerStepFromRow(m.customerStepToRow(s))).toEqual(s);
    for (const c of data.cards) {
      const row = m.customerCardToRow(c);
      expect(m.customerCardToRow(m.customerCardFromRow(row))).toEqual(row);
    }
    for (const mv of data.moves) {
      expect(m.customerMoveFromRow(m.customerMoveToRow(mv))).toEqual(mv);
    }
    const p = seedPeople().find((x) => x.id === "c2")!;
    expect(m.personToRow(p).ditto_since).toBe(p.dittoSince);
  });
});

describe("weekly goal row mappers", () => {
  const legacyRow = {
    person_id: "2",
    workspace_id: "w1",
    pages: 70,
    podcasts: 0,
    workshops: 1,
    reading_unit: "chapters",
    podcast_unit: null,
    items: null,
  };

  it("read a row from before lists as reading, podcasts and workshops (0 = not in the goal)", () => {
    expect(m.goalFromRow(legacyRow)).toEqual([
      "2",
      {
        items: [
          { kind: "reading", target: 70, unit: "chapters" },
          { kind: "workshops", target: 1 },
        ],
      },
    ]);
    // No units saved: pages and episodes.
    expect(
      m.goalFromRow({ ...legacyRow, podcasts: 3, reading_unit: null, podcast_unit: null })[1],
    ).toEqual({
      items: [
        { kind: "reading", target: 70, unit: "pages" },
        { kind: "podcasts", target: 3, unit: "episodes" },
        { kind: "workshops", target: 1 },
      ],
    });
  });

  it("write the list and keep the old columns in step", () => {
    const row = m.goalToRow("1", {
      items: [
        { kind: "contacts", target: 15 },
        { kind: "reading", target: 120, unit: "minutes" },
        { kind: "first_meetings", target: 5 },
      ],
    });
    expect(row).toEqual({
      person_id: "1",
      items: [
        { kind: "contacts", target: 15 },
        { kind: "reading", target: 120, unit: "minutes" },
        { kind: "first_meetings", target: 5 },
      ],
      pages: 120,
      podcasts: 0,
      workshops: 0,
      reading_unit: "minutes",
      podcast_unit: null,
    });
    // An empty goal stays empty (not the legacy default).
    const empty = m.goalToRow("1", { items: [] });
    expect(empty).toMatchObject({ items: [], pages: 0, podcasts: 0, workshops: 0 });
    expect(m.goalFromRow({ ...legacyRow, ...empty, workspace_id: "w1" })[1]).toEqual({
      items: [],
    });
  });

  it("round-trip every seed goal, with jsonb's own key order", () => {
    for (const [personId, goal] of Object.entries(seedLearningGoals())) {
      const row = m.goalToRow(personId, goal);
      // Postgres hands jsonb objects back with their keys reordered.
      const fromDb = {
        ...row,
        workspace_id: "w1",
        items: (row.items as Record<string, unknown>[]).map(({ kind, target, unit }) =>
          unit ? { unit, kind, target } : { kind, target },
        ),
      };
      const [id, back] = m.goalFromRow(fromDb as Parameters<typeof m.goalFromRow>[0]);
      expect(id).toBe(personId);
      expect(back).toEqual(goal);
      expect(JSON.stringify(m.goalToRow(id, back))).toBe(JSON.stringify(row));
    }
  });

  it("drop what the app doesn't know and fit units to the category", () => {
    const [, goal] = m.goalFromRow({
      ...legacyRow,
      items: [
        { kind: "reading", target: 30, unit: "episodes" },
        { kind: "podcasts", target: 2 },
        { kind: "contacts", target: 5, unit: "minutes" },
        { kind: "contacts", target: 9 },
        { kind: "someday", target: 4 },
        { kind: "pv", target: 0 },
        "junk",
      ],
    });
    expect(goal.items).toEqual([
      { kind: "reading", target: 30, unit: "pages" },
      { kind: "podcasts", target: 2, unit: "episodes" },
      { kind: "contacts", target: 5 },
    ]);
  });
});
