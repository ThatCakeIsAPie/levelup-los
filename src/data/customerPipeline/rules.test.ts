import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import { chainOf, columnsFor, countReaches, reachesOf, stepLabelError } from "../pipeline/rules";
import { RECRUITING_BOARD, type PipelineMove } from "../pipeline/types";
import {
  canEditListOf,
  canOwnList,
  cardBand,
  customerFromEntry,
  customerReaches,
  doNotContactIds,
  entryCards,
  entryError,
  isCustomerStale,
  moveEffects,
  visibleEntries,
} from "./rules";
import {
  CUSTOMER_BOARD,
  CUSTOMER_MILESTONES,
  type CustomerCard,
  type CustomerMove,
  type CustomerStep,
  type ListEntry,
} from "./types";

const person = (id: string, bizClass: CrmPerson["bizClass"], sponsorId: string | null = null) =>
  ({ id, name: `P${id}`, bizClass, sponsorId, ownerId: null }) as CrmPerson;

// Maria (1) → Anita (2) → Jamal (4) → Tasha (7); David (3) is Anita's crossline.
const people: CrmPerson[] = [
  person("1", "ibo"),
  person("2", "ibo", "1"),
  person("3", "ibo", "1"),
  person("4", "apprentice", "2"),
  person("7", "apprentice", "4"),
  person("9", "prospect", "4"),
  { ...person("c1", "customer"), ownerId: "4" },
];

const entry = (id: string, ownerId: string, extra: Partial<ListEntry> = {}): ListEntry => ({
  id,
  ownerId,
  name: `Name ${id}`,
  howKnown: null,
  phone: null,
  email: null,
  notes: null,
  rating: null,
  customerId: null,
  prospectId: null,
  addedBy: ownerId,
  createdAt: "2026-10-01T15:00:00.000Z",
  updatedAt: "2026-10-01T15:00:00.000Z",
  ...extra,
});

const step = (id: string, ownerId: string, band: CustomerStep["band"], position = 0) =>
  ({
    id,
    ownerId,
    band,
    label: id,
    position,
    createdAt: "2026-01-01T00:00:00.000Z",
  }) as CustomerStep;

const move = (
  entryId: string,
  to: string,
  band: CustomerMove["band"],
  movedAt: string,
  ownerId = "4",
): CustomerMove => ({
  id: `${entryId}-${to}-${movedAt}`,
  entryId,
  ownerId,
  from: null,
  to,
  band,
  movedAt,
  movedBy: ownerId,
  createdCustomerId: null,
  setDitto: false,
});

describe("the customer board layout", () => {
  it("has the start columns, four fixed milestones with inherited steps between them, and the outcomes", () => {
    const steps = [
      step("sampled", "1", "contact"),
      step("pm2", "2", "first_meeting"),
      step("sbox", "1", "first_sale"),
      step("crossline", "3", "contact"),
    ];
    const cols = columnsFor(chainOf(people, "4"), steps, [], CUSTOMER_BOARD);
    expect(cols.map((c) => c.id)).toEqual([
      "not_contacted",
      "contact",
      "sampled",
      "first_meeting",
      "pm2",
      "first_sale",
      "sbox",
      "on_ditto",
      "not_interested",
      "do_not_contact",
    ]);
    expect(cols.find((c) => c.id === "not_contacted")).toMatchObject({
      kind: "fixed",
      band: "start",
      label: "Not contacted yet",
    });
    expect(cols.find((c) => c.id === "on_ditto")).toMatchObject({
      kind: "milestone",
      label: "On Ditto",
    });
  });

  it("hides an upline's step for the hider's team only", () => {
    const steps = [step("sampled", "1", "contact")];
    const hides = [{ personId: "2", stepId: "sampled", createdAt: "" }];
    const ids = (id: string) =>
      columnsFor(chainOf(people, id), steps, hides, CUSTOMER_BOARD).map((c) => c.id);
    expect(ids("1")).toContain("sampled");
    expect(ids("4")).not.toContain("sampled");
  });

  it("gives the recruiting board the same fixed columns around its own milestones", () => {
    const cols = columnsFor(chainOf(people, "4"), [], [], RECRUITING_BOARD);
    expect(cols.map((c) => c.id)).toEqual([
      "not_contacted",
      "contact",
      "first_meeting",
      "first_plan",
      "registered",
      "not_interested",
      "do_not_contact",
    ]);
    expect(columnsFor(chainOf(people, "4"), [], [])).toEqual(cols);
  });

  it("won't let a step take a milestone's or a fixed column's name", () => {
    expect(stepLabelError("On Ditto", [], undefined, CUSTOMER_BOARD.reserved)).toMatch(/milestone/);
    expect(stepLabelError("do not contact", [], undefined, CUSTOMER_BOARD.reserved)).toMatch(
      /milestone/,
    );
    expect(stepLabelError("Sampled product", [], undefined, CUSTOMER_BOARD.reserved)).toBeNull();
    // Recruiting names are free on the customer board, and the other way round.
    expect(stepLabelError("First plan", [], undefined, CUSTOMER_BOARD.reserved)).toBeNull();
    expect(stepLabelError("First sale", [])).toBeNull();
  });

  it("knows each column's band (an unknown step counts as Contact)", () => {
    const steps = [step("sbox", "1", "first_sale")];
    expect(cardBand("not_contacted", steps)).toBe("start");
    expect(cardBand("do_not_contact", steps)).toBe("out");
    expect(cardBand("on_ditto", steps)).toBe("on_ditto");
    expect(cardBand("sbox", steps)).toBe("first_sale");
    expect(cardBand("gone", steps)).toBe("contact");
  });
});

describe("who sees and edits a list", () => {
  const entries = [entry("a", "4"), entry("b", "7"), entry("c", "3"), entry("d", "1")];
  const ids = (personId: string, role: "leader" | "ibo" | "apprentice" | "candidate") =>
    visibleEntries(entries, people, { personId, role })
      .map((e) => e.id)
      .sort();

  it("the owner and their uplines, never crosslines or downlines' uplines' lists", () => {
    expect(ids("1", "leader")).toEqual(["a", "b", "c", "d"]);
    expect(ids("2", "ibo")).toEqual(["a", "b"]);
    expect(ids("4", "apprentice")).toEqual(["a", "b"]);
    expect(ids("7", "apprentice")).toEqual(["b"]);
    expect(ids("3", "ibo")).toEqual(["c"]);
  });

  it("candidates have no list", () => {
    expect(visibleEntries(entries, people, { personId: "9", role: "candidate" })).toEqual([]);
    expect(canEditListOf(people, { personId: "9", role: "candidate" }, "9")).toBe(false);
  });

  it("only apprentices and IBOs have a list; uplines can add to it", () => {
    expect(canOwnList(people.find((p) => p.id === "9"))).toBe(false);
    expect(canOwnList(people.find((p) => p.id === "c1"))).toBe(false);
    expect(canEditListOf(people, { personId: "4", role: "apprentice" }, "7")).toBe(true);
    expect(canEditListOf(people, { personId: "7", role: "apprentice" }, "4")).toBe(false);
    expect(canEditListOf(people, { personId: "3", role: "ibo" }, "4")).toBe(false);
    expect(canEditListOf(people, { personId: "4", role: "apprentice" }, "9")).toBe(false);
  });

  it("checks names, lengths and emails", () => {
    expect(entryError({ name: "  " })).toMatch(/name/);
    expect(entryError({ name: "x".repeat(81) })).toMatch(/80/);
    expect(entryError({ name: "Dana", email: "dana@" })).toMatch(/email/);
    expect(entryError({ name: "Dana", email: "dana@example.com", howKnown: "Gym" })).toBeNull();
  });
});

describe("cards and moves", () => {
  it("an entry without a card sits in Not contacted yet from the day it was added", () => {
    const cards: CustomerCard[] = [
      {
        entryId: "b",
        column: "contact",
        enteredAt: "2026-10-05T10:00:00.000Z",
        nextColumn: null,
        nextStepDate: null,
        nextStepTime: null,
        note: null,
        updatedAt: "",
      },
    ];
    const out = entryCards([entry("a", "4"), entry("b", "4")], cards);
    expect(out.map((x) => [x.entry.id, x.card.column, x.stored])).toEqual([
      ["a", "not_contacted", false],
      ["b", "contact", true],
    ]);
    expect(out[0].card.enteredAt).toBe("2026-10-01T15:00:00.000Z");
  });

  it("First sale makes a customer once; On Ditto marks them (once)", () => {
    expect(moveEffects({ customerId: null }, "contact", undefined)).toEqual({
      createCustomer: false,
      setDitto: false,
    });
    expect(moveEffects({ customerId: null }, "first_sale", undefined)).toEqual({
      createCustomer: true,
      setDitto: false,
    });
    expect(moveEffects({ customerId: "c1" }, "first_sale", {})).toEqual({
      createCustomer: false,
      setDitto: false,
    });
    // Straight to On Ditto from the list: a customer and a subscription at once.
    expect(moveEffects({ customerId: null }, "on_ditto", undefined)).toEqual({
      createCustomer: true,
      setDitto: true,
    });
    expect(moveEffects({ customerId: "c1" }, "on_ditto", { dittoSince: "2026-09-01" })).toEqual({
      createCustomer: false,
      setDitto: false,
    });
    // Outcomes never make a customer.
    expect(moveEffects({ customerId: null }, "out", undefined).createCustomer).toBe(false);
  });

  it("the customer belongs to the list's owner, with the entry's details", () => {
    const c = customerFromEntry(
      entry("a", "7", { name: "Grace", phone: "555", howKnown: "Gym" }),
      "new-id",
      "2026-10-13",
    );
    expect(c).toMatchObject({
      id: "new-id",
      name: "Grace",
      bizClass: "customer",
      ownerId: "7",
      sponsorId: null,
      phone: "555",
      joinedDate: "2026-10-13",
      notes: "From your list: Gym",
    });
  });

  it("counts each milestone once per name; start and outcome columns count nothing", () => {
    const moves = [
      move("a", "not_contacted", "start", "2026-10-01T10:00:00.000Z"),
      move("a", "contact", "contact", "2026-10-02T10:00:00.000Z"),
      move("a", "sbox", "first_sale", "2026-10-05T10:00:00.000Z"), // skips First meeting
      move("a", "contact", "contact", "2026-10-06T10:00:00.000Z"), // back again
      move("a", "first_sale", "first_sale", "2026-10-07T10:00:00.000Z"),
      move("b", "contact", "contact", "2026-10-03T10:00:00.000Z"),
      move("b", "not_interested", "out", "2026-10-04T10:00:00.000Z"),
    ];
    const reaches = customerReaches(moves);
    const counts = countReaches(reaches, null, "2026-10-01", "2026-10-31", CUSTOMER_MILESTONES);
    expect(counts).toEqual({ contact: 2, first_meeting: 1, first_sale: 1, on_ditto: 0 });
    expect(reaches.find((r) => r.personId === "a" && r.milestone === "first_meeting")?.day).toBe(
      reaches.find((r) => r.personId === "a" && r.milestone === "first_sale")?.day,
    );
  });

  it("recruiting reaches are unchanged by the generic version", () => {
    const m: PipelineMove = {
      id: "1",
      personId: "9",
      ownerId: "4",
      from: null,
      to: "first_plan",
      milestone: "first_plan",
      movedAt: "2026-10-02T10:00:00.000Z",
      movedBy: "4",
    };
    expect(reachesOf([m]).map((r) => r.milestone)).toEqual([
      "contact",
      "first_meeting",
      "first_plan",
    ]);
    expect(countReaches(reachesOf([m]), null, "2026-10-01", "2026-10-31")).toEqual({
      contact: 1,
      first_meeting: 1,
      first_plan: 1,
      registered: 0,
    });
  });

  it("goes quiet after 14 days only while being worked", () => {
    const old = "2026-09-01T15:00:00.000Z";
    expect(isCustomerStale(old, "contact", "2026-10-13")).toBe(true);
    expect(isCustomerStale(old, "first_meeting", "2026-10-13")).toBe(true);
    expect(isCustomerStale(old, "first_sale", "2026-10-13")).toBe(false);
    expect(isCustomerStale(old, "start", "2026-10-13")).toBe(false);
    expect(isCustomerStale(old, "on_ditto", "2026-10-13")).toBe(false);
    expect(isCustomerStale(old, "out", "2026-10-13")).toBe(false);
    expect(isCustomerStale("2026-10-10T15:00:00.000Z", "contact", "2026-10-13")).toBe(false);
  });
});

describe("do not contact", () => {
  it("hides the customer and the prospect behind a name in Do not contact", () => {
    const entries = [
      entry("a", "4", { customerId: "c1", prospectId: "9" }),
      entry("b", "4", { customerId: "c2" }),
    ];
    const card = (entryId: string, column: string): CustomerCard => ({
      entryId,
      column,
      enteredAt: "",
      nextColumn: null,
      nextStepDate: null,
      nextStepTime: null,
      note: null,
      updatedAt: "",
    });
    expect([
      ...doNotContactIds(entries, [card("a", "do_not_contact"), card("b", "contact")]),
    ]).toEqual(["c1", "9"]);
    expect(doNotContactIds(entries, [card("a", "not_interested")]).size).toBe(0);
  });
});
