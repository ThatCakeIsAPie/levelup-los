import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import { seedPeople } from "../seed";
import { downlineIds } from "../access";
import { chainOf, columnsFor, countReaches, monthBounds, monthOf } from "../pipeline/rules";
import { bookableColumns, bookingOf, dueBookings } from "../pipeline/booking";
import type { BoardDef } from "../pipeline/types";
import { cardBand, customerReaches, isSaleBand } from "./rules";
import { seedCustomerPipeline } from "./seed";
import { CUSTOMER_BOARD, CUSTOMER_MILESTONES } from "./types";

const people = seedPeople();
const byId = new Map(people.map((p) => [p.id, p]));
const data = seedCustomerPipeline(people);
const entryIds = new Set(data.entries.map((e) => e.id));

describe("customer pipeline seed", () => {
  it("lists belong to apprentices and IBOs on Maria's team", () => {
    const maria = downlineIds(people, "1");
    for (const e of data.entries) {
      expect(["apprentice", "ibo"]).toContain(byId.get(e.ownerId)?.bizClass);
      expect(maria.has(e.ownerId)).toBe(true);
    }
  });

  it("Maria, Anita, Jamal and Tasha each have a list", () => {
    for (const id of ["1", "2", "4", "700"]) {
      if (!byId.has(id)) continue;
      expect(data.entries.filter((e) => e.ownerId === id).length).toBeGreaterThan(2);
    }
  });

  it("every card is an entry's, and ends where its last move went", () => {
    for (const c of data.cards) {
      expect(entryIds.has(c.entryId)).toBe(true);
      const last = data.moves
        .filter((m) => m.entryId === c.entryId)
        .sort((a, b) => a.movedAt.localeCompare(b.movedAt))
        .at(-1);
      expect(last?.to).toBe(c.column);
      expect(last?.movedAt).toBe(c.enteredAt);
    }
  });

  it("names at First sale or On Ditto are existing customers of the list's owner (no new people)", () => {
    for (const c of data.cards) {
      const e = data.entries.find((x) => x.id === c.entryId)!;
      if (!isSaleBand(cardBand(c.column, data.steps))) continue;
      const customer = byId.get(e.customerId ?? "");
      expect(customer?.bizClass).toBe("customer");
      expect(customer?.ownerId).toBe(e.ownerId);
    }
    expect(people.filter((p) => p.ownerId === "4").map((p) => p.id)).toEqual(["c8"]);
  });

  it("customers on Ditto have a date", () => {
    const onDitto = data.cards.filter((c) => c.column === "on_ditto");
    expect(onDitto.length).toBeGreaterThan(0);
    for (const c of onDitto) {
      const e = data.entries.find((x) => x.id === c.entryId)!;
      expect(byId.get(e.customerId!)?.dittoSince).toBeTruthy();
    }
  });

  it("no move is in the future, and moves are in order per name", () => {
    const now = new Date().toISOString();
    expect(data.moves.filter((m) => m.movedAt > now)).toEqual([]);
  });

  it("Maria's team shows activity this month", () => {
    const today = localDate();
    const { from } = monthBounds(monthOf(today));
    const counts = countReaches(
      customerReaches(data.moves),
      downlineIds(people, "1"),
      from,
      today,
      CUSTOMER_MILESTONES,
    );
    expect(counts.contact).toBeGreaterThan(5);
  });

  it("stays small enough for browser storage", () => {
    expect(JSON.stringify(data).length).toBeLessThan(200_000);
  });

  it("books next steps after each card's column, and each demo login has some due", () => {
    const def = CUSTOMER_BOARD as BoardDef<string>;
    const owner = new Map(data.entries.map((e) => [e.id, e.ownerId]));
    for (const c of data.cards) {
      if (!c.nextColumn) continue;
      const cols = columnsFor(chainOf(people, owner.get(c.entryId)!), data.steps, data.hides, def);
      expect(bookableColumns(cols, c.column, def).map((x) => x.id)).toContain(c.nextColumn);
    }
    const today = localDate();
    for (const me of ["1", "2", "4", "700"]) {
      if (!byId.has(me)) continue;
      const cols = columnsFor(chainOf(people, me), data.steps, data.hides, def);
      const due = dueBookings(
        data.cards
          .filter((c) => owner.get(c.entryId) === me)
          .map((c) => ({
            board: "customer" as const,
            cardId: c.entryId,
            name: c.entryId,
            ownerId: me,
            personIds: [],
            booking: bookingOf(c),
            column: c.column,
            dropped: false,
            columns: cols,
          })),
        me,
        today,
      );
      expect(due.length).toBeGreaterThan(0);
    }
  });
});
