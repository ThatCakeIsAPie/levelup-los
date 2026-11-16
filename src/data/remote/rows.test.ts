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

  it("round-trip an occurrence of a repeating event and its series", () => {
    const e = {
      id: "S1-2026-12-08",
      name: "Info session",
      categoryId: "w1-info_session",
      date: "2026-12-08",
      format: "in_person" as const,
      seriesId: "S1",
      seriesDate: "2026-12-08",
      seriesOverrides: ["date", "name"],
    };
    expect(m.eventFromRow(m.eventToRow(e))).toEqual(e);
    // The database's own row says the same.
    expect(
      m.eventFromRow({
        id: e.id,
        name: e.name,
        category_id: e.categoryId,
        date: e.date,
        format: "in_person",
        series_id: "S1",
        series_date: "2026-12-08",
        series_overrides: ["date", "name"],
      } as never),
    ).toEqual(e);
    // An event that doesn't repeat has no series columns to send.
    const plain = m.eventToRow(seedEvents()[0]);
    expect(plain.series_id).toBeUndefined();
    expect(m.EVENT_SERVER_COLUMNS).toEqual(["series_id", "series_date", "series_overrides"]);
    const series = {
      id: "S1",
      freq: "monthly_weekday" as const,
      startsOn: "2026-11-10",
      endsOn: "2027-02-28",
      skipped: ["2026-12-08"],
      createdBy: "1",
      name: "Info session",
      categoryId: "w1-info_session",
      location: "Dallas, TX",
      format: "in_person" as const,
      lengthDays: 0,
    };
    expect(m.seriesFromRow(m.seriesToRow(series) as never)).toEqual({
      ...series,
      notes: undefined,
      ticketUrl: undefined,
    });
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

describe("card rows leave the removed booking and note alone", () => {
  const GONE = ["next_column", "next_step_date", "next_step_time", "note"];

  it("never carry a booking column or the card's note, so a card update cannot overwrite them", async () => {
    const { seedCustomerPipeline } = await import("@/data/customerPipeline/seed");
    const { seedPipeline } = await import("@/data/pipeline/seed");
    const people = seedPeople();
    const cards = seedPipeline(people).cards;
    const customerCards = seedCustomerPipeline(people).cards;
    expect(cards.length).toBeGreaterThan(0);
    expect(customerCards.length).toBeGreaterThan(0);
    for (const c of cards) for (const k of GONE) expect(k in m.cardToRow(c)).toBe(false);
    for (const c of customerCards)
      for (const k of GONE) expect(k in m.customerCardToRow(c)).toBe(false);
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

  it("round-trips card tasks and notes, keeping a time as HH:mm", () => {
    const row = {
      id: "t1",
      person_id: "9",
      entry_id: null,
      title: "Call Carlos",
      done: true,
      done_at: "2026-11-14T15:00:00+00:00",
      done_by: "4",
      due_date: "2026-11-19",
      due_time: "09:00:00",
      assignee_id: "4",
      position: 2,
      created_by: "1",
      created_at: "2026-11-01T10:00:00+00:00",
      updated_at: "2026-11-14T15:00:00+00:00",
    };
    const task = m.cardTaskFromRow(row as never);
    expect(task).toMatchObject({
      dueTime: "09:00",
      doneAt: "2026-11-14T15:00:00.000Z",
      entryId: null,
    });
    expect(m.cardTaskToRow(task)).toMatchObject({
      id: "t1",
      due_time: "09:00",
      position: 2,
      done: true,
    });
    expect(m.cardTaskToRow(m.cardTaskFromRow(m.cardTaskToRow(task) as never))).toEqual(
      m.cardTaskToRow(task),
    );
    // the row the app sends has no workspace: the database defaults it to the caller's team
    expect(m.cardTaskToRow(task)).not.toHaveProperty("workspace_id");
    const note = m.cardNoteFromRow({
      id: "n1",
      entry_id: "le-1",
      person_id: null,
      author_id: "1",
      body: "Hello",
      created_at: "2026-11-01T10:00:00+00:00",
    } as never);
    expect(note).toEqual({
      id: "n1",
      personId: null,
      entryId: "le-1",
      authorId: "1",
      body: "Hello",
      createdAt: "2026-11-01T10:00:00.000Z",
    });
    expect(m.cardNoteToRow(note)).not.toHaveProperty("workspace_id");
    expect(m.CARD_TASK_SERVER_COLUMNS).toEqual([
      "done_at",
      "done_by",
      "created_by",
      "created_at",
      "updated_at",
    ]);
    expect(m.CARD_NOTE_SERVER_COLUMNS).toEqual(["author_id", "created_at"]);
  });

  it("round-trip a Home layout, with its hidden cards when there are any", () => {
    const plain = { order: ["today", "team", "myDay"], side: ["team"] };
    // Nothing hidden: the row keeps the two-key shape the database always accepted.
    expect(m.homeLayoutToRow("4", plain)).toEqual({ person_id: "4", layout: plain });
    expect(Object.keys(m.homeLayoutToRow("4", { ...plain, hidden: [] }).layout as object)).toEqual([
      "order",
      "side",
    ]);
    const hidden = { ...plain, hidden: ["myDay", "futureCard"] };
    const row = m.homeLayoutToRow("4", hidden);
    expect(row).toEqual({ person_id: "4", layout: hidden });
    expect(m.homeLayoutFromRow(row as never)).toEqual(["4", hidden]);
    expect(m.homeLayoutFromRow(m.homeLayoutToRow("4", plain) as never)).toEqual(["4", plain]);
  });

  it("read a Home layout row saved before hiding, and one that isn't a layout", () => {
    const old = { person_id: "4", layout: { order: ["today"], side: [] } };
    const [id, l] = m.homeLayoutFromRow(old as never);
    expect(id).toBe("4");
    expect(l).toStrictEqual({ order: ["today"], side: [] });
    // Bad hidden entries are dropped, a bad shape is the default (an empty layout).
    expect(
      m.homeLayoutFromRow({
        person_id: "4",
        layout: { order: ["today"], side: [], hidden: ["team", "team", "<x>", 7] },
      } as never)[1],
    ).toEqual({ order: ["today"], side: [], hidden: ["team"] });
    expect(m.homeLayoutFromRow({ person_id: "4", layout: [] } as never)[1]).toEqual({
      order: [],
      side: [],
    });
  });
});
