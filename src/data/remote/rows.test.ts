import { describe, expect, it } from "vitest";
import {
  seedAttendances,
  seedContacts,
  seedEvents,
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

  it("round-trip sales with PV, monthly PV and milestone marks", () => {
    for (const s of seedSales()) expect(m.saleFromRow(m.saleToRow(s))).toEqual(s);
    for (const o of seedPvOverrides()) {
      expect(m.pvOverrideFromRow(m.pvOverrideToRow(o))).toEqual(o);
    }
    for (const k of seedMilestoneMarks()) {
      expect(m.milestoneMarkFromRow(m.milestoneMarkToRow(k))).toEqual(k);
    }
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
