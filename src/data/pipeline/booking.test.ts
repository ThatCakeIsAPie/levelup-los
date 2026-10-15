import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import { CUSTOMER_BOARD, type CustomerBand } from "../customerPipeline/types";
import {
  NO_BOOKING,
  bookableColumns,
  bookingAfterMove,
  bookingError,
  bookingLabel,
  bookingView,
  cancelError,
  cancelSummary,
  cancelText,
  convertLegacyCard,
  convertLegacyCards,
  defaultBookingDate,
  dueBookings,
  dueState,
  legacyNextColumn,
  offersNotInterested,
  rescheduleChoices,
  validTime,
  type Booking,
  type BookingCandidate,
} from "./booking";
import { chainOf, columnsFor } from "./rules";
import { type BoardDef, type PipelineStep, type StepHide } from "./types";

// Maria (1) ── Anita (2) ── Jamal (4) ── Carlos (9, prospect)
const person = (id: string, sponsorId: string | null): CrmPerson => ({
  id,
  name: `P${id}`,
  bizClass: "ibo",
  sponsorId,
});
const people = [person("1", null), person("2", "1"), person("4", "2")];
const step = (
  id: string,
  ownerId: string,
  band: PipelineStep["band"],
  position: number,
  label = id,
): PipelineStep => ({ id, ownerId, band, label, position, createdAt: "2026-01-01T00:00:00.000Z" });
const steps: PipelineStep[] = [
  step("s-door", "1", "contact", 0, "Opened the Door"),
  step("s-book", "1", "first_meeting", 0, "Book"),
  step("s-mg2", "1", "first_meeting", 1, "MG2"),
  step("s-f1", "1", "first_plan", 0, "F1"),
  step("s-info2", "1", "first_plan", 1, "Info 2"),
  step("s-3way", "2", "first_meeting", 0, "3-way call"),
];
const hides: StepHide[] = [];
// Jamal's board: Not contacted, Contact made, Opened the Door, First meeting,
// Book, MG2, 3-way call, First plan, F1, Info 2, Registered, Not interested,
// Do not contact.
const cols = columnsFor(chainOf(people, "4"), steps, hides);
const ids = (cs: { id: string }[]) => cs.map((c) => c.id);
const booking = (nextColumn: string | null, date: string | null = null, time: string | null = null): Booking => ({
  nextColumn,
  nextStepDate: date,
  nextStepTime: time,
}); // prettier-ignore

describe("bookableColumns", () => {
  it("offers every column after the current one, milestones included, never the outcomes", () => {
    expect(ids(bookableColumns(cols, "s-mg2"))).toEqual([
      "s-3way",
      "first_plan",
      "s-f1",
      "s-info2",
      "registered",
    ]);
    expect(ids(bookableColumns(cols, "s-info2"))).toEqual(["registered"]);
    expect(bookableColumns(cols, "registered")).toEqual([]);
  });

  it("never offers Not contacted yet; from it, the whole board ahead", () => {
    const out = ids(bookableColumns(cols, "not_contacted"));
    expect(out[0]).toBe("contact");
    expect(out).not.toContain("not_contacted");
    expect(out).not.toContain("not_interested");
    expect(out).not.toContain("do_not_contact");
  });

  it("leaves out steps the person's line hides", () => {
    const hidden = columnsFor(chainOf(people, "4"), steps, [
      { personId: "2", stepId: "s-f1", createdAt: "" },
    ]);
    expect(ids(bookableColumns(hidden, "first_plan"))).toEqual(["s-info2", "registered"]);
  });

  it("places a card at a step this board doesn't show under its milestone", () => {
    // Maria's board has no 3-way call: a card there counts as First meeting.
    const maria = columnsFor(chainOf(people, "1"), steps, hides);
    expect(ids(bookableColumns(maria, "s-3way", undefined, "first_meeting"))).toEqual([
      "s-book",
      "s-mg2",
      "first_plan",
      "s-f1",
      "s-info2",
      "registered",
    ]);
  });

  it("works on the customer board", () => {
    const c = columnsFor<CustomerBand>(["1"], [], [], CUSTOMER_BOARD);
    expect(ids(bookableColumns(c, "contact", CUSTOMER_BOARD as BoardDef<string>))).toEqual([
      "first_meeting",
      "first_sale",
      "on_ditto",
    ]);
  });
});

describe("bookingView and dueState", () => {
  it("names the booked column and says when it's due", () => {
    const v = bookingView(booking("first_meeting", "2026-10-14", "19:00"), cols, "2026-10-14");
    expect(v?.column?.label).toBe("First meeting (MG1)");
    expect(v?.removed).toBe(false);
    expect(v?.due).toBe("today");
    expect(v?.time).toBe("19:00");
    expect(dueState("2026-10-13", "2026-10-14")).toBe("overdue");
    expect(dueState("2026-10-15", "2026-10-14")).toBe("upcoming");
  });

  it("is null when nothing is booked", () => {
    expect(bookingView(NO_BOOKING, cols)).toBeNull();
  });

  it("marks a booking whose column is gone as removed (deleted or hidden step)", () => {
    const v = bookingView(booking("s-gone", "2026-10-14"), cols, "2026-10-14");
    expect(v?.removed).toBe(true);
    expect(v?.column).toBeNull();
  });
});

describe("bookingAfterMove", () => {
  const b = booking("first_plan", "2026-10-16");

  it("clears the booking when the card moves into the booked column", () => {
    expect(bookingAfterMove(b, "first_plan", cols)).toEqual(NO_BOOKING);
  });

  it("clears it when the card moves past the booked column (outcomes count as past)", () => {
    expect(bookingAfterMove(b, "s-f1", cols)).toEqual(NO_BOOKING);
    expect(bookingAfterMove(b, "registered", cols)).toEqual(NO_BOOKING);
    expect(bookingAfterMove(b, "not_interested", cols)).toEqual(NO_BOOKING);
  });

  it("keeps it when the card moves forward short of it, or backwards", () => {
    expect(bookingAfterMove(b, "s-3way", cols)).toEqual(b);
    expect(bookingAfterMove(b, "contact", cols)).toEqual(b);
    expect(bookingAfterMove(b, "not_contacted", cols)).toEqual(b);
  });

  it("places a step the owner's board doesn't show under its milestone", () => {
    const maria = columnsFor(chainOf(people, "1"), steps, hides);
    const mg2 = booking("s-mg2", "2026-10-16");
    expect(bookingAfterMove(mg2, "s-3way", maria, "first_meeting")).toEqual(mg2);
  });

  it("keeps a removed booking (it still asks to rebook)", () => {
    const gone = booking("s-gone", "2026-10-16");
    expect(bookingAfterMove(gone, "registered", cols)).toEqual(gone);
  });

  it("has nothing to keep without a booking", () => {
    expect(bookingAfterMove(NO_BOOKING, "first_plan", cols)).toEqual(NO_BOOKING);
  });
});

describe("booking form", () => {
  const ok = bookableColumns(cols, "contact");

  it("starts on tomorrow; reschedule offers tomorrow and next week", () => {
    expect(defaultBookingDate("2026-10-14")).toBe("2026-10-15");
    expect(rescheduleChoices("2026-10-31")).toEqual([
      { label: "Tomorrow", date: "2026-11-01" },
      { label: "Next week", date: "2026-11-07" },
    ]);
  });

  it("checks the column, the day and the time", () => {
    expect(bookingError(NO_BOOKING, ok)).toBeNull();
    expect(bookingError(booking("first_meeting", "2026-10-15"), ok)).toBeNull();
    expect(bookingError(booking("first_meeting", "2026-10-15", "18:30"), ok)).toBeNull();
    expect(bookingError(booking("first_meeting"), ok)).toBe("Pick a day.");
    expect(bookingError(booking("contact", "2026-10-15"), ok)).toMatch(/after/);
    expect(bookingError(booking("do_not_contact", "2026-10-15"), ok)).toMatch(/after/);
    expect(bookingError(booking("first_meeting", "2026-10-15", "25:00"), ok)).toMatch(/time/);
    expect(validTime("07:05")).toBe(true);
    expect(validTime("7pm")).toBe(false);
  });

  it("shortens a milestone to its team name", () => {
    expect(bookingLabel({ kind: "milestone", label: "First meeting (MG1)" })).toBe("MG1");
    expect(bookingLabel({ kind: "milestone", label: "Registered" })).toBe("Registered");
    expect(bookingLabel({ kind: "step", label: "Info 2" })).toBe("Info 2");
  });
});

describe("dueBookings (Home)", () => {
  const today = "2026-10-14";
  const cand = (o: Partial<BookingCandidate> & { cardId: string }): BookingCandidate => ({
    board: "recruiting",
    name: `Name ${o.cardId}`,
    ownerId: "4",
    personIds: [o.cardId],
    booking: booking("first_meeting", today),
    column: "contact",
    dropped: false,
    columns: cols,
    ...o,
  });

  it("lists the viewer's own steps due today or overdue, oldest first", () => {
    const out = dueBookings(
      [
        cand({ cardId: "a", booking: booking("first_meeting", today, "19:00") }),
        cand({ cardId: "b", booking: booking("s-book", "2026-10-12") }),
        cand({ cardId: "c", booking: booking("first_plan", "2026-10-15") }), // upcoming
        cand({ cardId: "d", booking: booking("first_meeting", today, "08:00") }),
      ],
      "4",
      today,
    );
    expect(out.map((d) => [d.cardId, d.due, d.daysLate])).toEqual([
      ["b", "overdue", 2],
      ["d", "today", 0],
      ["a", "today", 0],
    ]);
    expect(out[0].column.label).toBe("Book");
  });

  it("leaves out other people's cards, cards off the board and Do not contact", () => {
    const out = dueBookings(
      [
        cand({ cardId: "a", ownerId: "2" }),
        cand({ cardId: "b", dropped: true }),
        cand({ cardId: "c", column: "do_not_contact" }),
        cand({ cardId: "d", personIds: ["c9"] }),
        cand({ cardId: "e" }),
      ],
      "4",
      today,
      new Set(["c9"]),
    );
    expect(out.map((d) => d.cardId)).toEqual(["e"]);
  });

  it("leaves out removed steps and bookings without a day", () => {
    const out = dueBookings(
      [
        cand({ cardId: "a", booking: booking("s-gone", today) }),
        cand({ cardId: "b", booking: booking("first_meeting", null) }),
      ],
      "4",
      today,
    );
    expect(out).toEqual([]);
  });
});

describe("cancelling a booked step", () => {
  it("needs a reason; Other needs words, at most 200 characters", () => {
    expect(cancelError(null, null)).toBe("Pick a reason.");
    expect(cancelError("no_show", null)).toBeNull();
    expect(cancelError("other", "  ")).toBe("Say what happened.");
    expect(cancelError("other", "Car broke down")).toBeNull();
    expect(cancelError("other", "x".repeat(201))).toMatch(/200/);
  });

  it("keeps the text only for Other", () => {
    expect(cancelText("no_show", "ignored")).toBeNull();
    expect(cancelText("other", "  Sick kid ")).toBe("Sick kid");
  });

  it("writes the activity line", () => {
    expect(cancelSummary("MG1", "no_show", null)).toBe("MG1 cancelled · No-show");
    expect(cancelSummary("Info 2", "unreachable", null)).toBe(
      "Info 2 cancelled · Couldn't reach them",
    );
    expect(cancelSummary("F1", "other", "Car broke down")).toBe("F1 cancelled · Car broke down");
  });

  it("offers Not interested only for 'Not interested anymore'", () => {
    expect(offersNotInterested("not_interested")).toBe(true);
    expect(offersNotInterested("they_cancelled")).toBe(false);
    expect(offersNotInterested(null)).toBe(false);
  });
});

describe("legacy free-text next steps", () => {
  it("books the column a text names: label, team name or common name", () => {
    expect(legacyNextColumn("Book", cols, "first_meeting")).toBe("s-book");
    expect(legacyNextColumn("mg2.", cols, "first_meeting")).toBe("s-mg2");
    expect(legacyNextColumn("MG1", cols, "s-door")).toBe("first_meeting");
    expect(legacyNextColumn("  info ", cols, "s-mg2")).toBe("first_plan");
    expect(legacyNextColumn("Register", cols, "s-info2")).toBe("registered");
  });

  it("only books a column after the card's current one", () => {
    expect(legacyNextColumn("MG1", cols, "s-book")).toBeNull();
    expect(legacyNextColumn("Book", cols, "first_plan")).toBeNull();
  });

  it("names on the customer board", () => {
    const c = columnsFor<CustomerBand>(["1"], [], [], CUSTOMER_BOARD);
    const def = CUSTOMER_BOARD as BoardDef<string>;
    expect(legacyNextColumn("Offer Ditto", c, "first_sale", def)).toBe("on_ditto");
    expect(legacyNextColumn("First sale", c, "contact", def)).toBe("first_sale");
    expect(legacyNextColumn("Text Fri", c, "contact", def)).toBeNull();
  });

  it("converts a card: a named column is booked with its day, other text becomes the note", () => {
    const card = { column: "s-door", nextStep: "MG1", nextStepDate: "2026-10-16" };
    expect(convertLegacyCard(card, cols)).toEqual({
      column: "s-door",
      nextColumn: "first_meeting",
      nextStepDate: "2026-10-16",
      nextStepTime: null,
      note: null,
    });
    const text = {
      column: "s-door",
      nextStep: "Bring to Fall Weekend",
      nextStepDate: "2026-11-08",
    };
    expect(convertLegacyCard(text, cols)).toEqual({
      column: "s-door",
      nextColumn: null,
      nextStepDate: null,
      nextStepTime: null,
      note: "Bring to Fall Weekend",
    });
  });

  it("leaves converted cards alone", () => {
    const done = [
      { column: "contact", nextColumn: "first_meeting", nextStepDate: "2026-10-16", nextStepTime: null, note: "x" },
    ]; // prettier-ignore
    expect(convertLegacyCards(done, () => ({ columns: cols, band: null }))).toBe(done);
    const old = [{ column: "contact", nextStep: "Info", nextStepDate: null }];
    expect(convertLegacyCards(old, () => ({ columns: cols, band: null }))[0]).toMatchObject({
      nextColumn: "first_plan",
      note: null,
    });
  });
});
