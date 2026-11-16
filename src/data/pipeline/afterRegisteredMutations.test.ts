import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { seedPeople } from "@/data/seed";
import { localDate } from "@/lib/dates";
// The stores persist to localStorage in the demo; there is none in this environment.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});

import { useCardTasksStore } from "../cardTasks/store";
import { addCardTask, canEditCard } from "../cardTasks/mutations";
import { useCustomerPipelineStore } from "../customerPipeline/store";
import { emptyPipeline, pipeline, usePipelineStore } from "./store";
import {
  addPipelineStep,
  deletePipelineStep,
  dropPipelineCard,
  hidePipelineStep,
  movePipelineCard,
  movePipelineStep,
  renamePipelineStep,
  restorePipelineCard,
} from "./mutations";

// Maria (1) -> Anita (2) -> Jamal (4, apprentice) -> Carlos (9, prospect). Sarah (7) is Jamal's crossline (under David, 3).
const as = (id: string) =>
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === id)! });
const person = (id: string) => usePeopleStore.getState().people.find((p) => p.id === id)!;
const setPerson = (id: string, patch: Record<string, unknown>) =>
  usePeopleStore.setState((s) => ({
    people: s.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  }));
const addStep = (label = "Activated") => {
  const r = addPipelineStep("registered", label);
  if (!r.ok || !r.step) throw new Error("step not added");
  return r.step.id;
};

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  usePipelineStore.setState(emptyPipeline());
  useCustomerPipelineStore.setState({ entries: [], cards: [], moves: [], steps: [], hides: [] });
  useCardTasksStore.setState({ tasks: [], notes: [] });
  as("2");
});

describe("steps after Registered: the leader's own", () => {
  it("adds, names, orders and deletes them like any step, with the same name rules", () => {
    const a = addStep("Activated");
    const b = addStep("Active 90 days");
    expect(pipeline().steps.map((s) => [s.band, s.position])).toEqual([
      ["registered", 0],
      ["registered", 1],
    ]);
    expect(addPipelineStep("registered", "activated")).toEqual({
      ok: false,
      error: "There's already a step with that name here.",
    });
    expect(addPipelineStep("registered", "Registered")).toEqual({
      ok: false,
      error: "That's a milestone's name.",
    });
    expect(addPipelineStep("registered", " ").ok).toBe(false);
    expect(addPipelineStep("registered", "x".repeat(25)).ok).toBe(false);
    expect(renamePipelineStep(a, "Active").ok).toBe(true);
    expect(movePipelineStep(b, -1).ok).toBe(true);
    expect(
      pipeline()
        .steps.sort((x, y) => x.position - y.position)
        .map((s) => s.id),
    ).toEqual([b, a]);
    expect(deletePipelineStep(a)).toEqual({ ok: true, moved: 0 });
  });

  it("the customer board takes none", () => {
    expect(addPipelineStep("registered", "Activated", "customer")).toEqual({
      ok: false,
      error: "Steps can't go there.",
    });
  });

  it("only the owner edits, an upline's can be hidden by the downline", () => {
    as("1");
    const id = addStep("From Maria");
    as("2");
    expect(renamePipelineStep(id, "Mine now").ok).toBe(false);
    expect(deletePipelineStep(id).ok).toBe(false);
    expect(hidePipelineStep(id).ok).toBe(true);
    expect(pipeline().hides).toHaveLength(1);
  });

  it("deleting one sends its cards back to Registered", () => {
    const id = addStep();
    expect(movePipelineCard("4", id).ok).toBe(true);
    expect(deletePipelineStep(id)).toEqual({ ok: true, moved: 1 });
    expect(pipeline().cards.find((c) => c.personId === "4")?.column).toBe("registered");
  });
});

describe("a registered person's card", () => {
  it("moves into a step and back, and the person never changes", () => {
    const id = addStep();
    const before = { ...person("4") };
    const r = movePipelineCard("4", id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registered).toBe(false);
    expect(r.move).toMatchObject({
      personId: "4",
      from: null,
      to: id,
      milestone: "registered",
      ownerId: "2",
      movedBy: "2",
    });
    expect(pipeline().cards.find((c) => c.personId === "4")).toMatchObject({ column: id });
    expect(person("4")).toEqual(before);
    const back = movePipelineCard("4", "registered");
    expect(back.ok && back.registered).toBe(false);
    expect(pipeline().moves.map((m) => [m.from, m.to, m.milestone])).toEqual([
      [null, id, "registered"],
      [id, "registered", "registered"],
    ]);
    expect(person("4")).toEqual(before);
  });

  it("is refused every other column, and Registered when it is already there", () => {
    addStep();
    for (const to of [
      "contact",
      "first_meeting",
      "first_plan",
      "not_contacted",
      "referral_source",
      "not_interested",
      "do_not_contact",
    ])
      expect(movePipelineCard("4", to)).toEqual({ ok: false, reason: "after-registered-only" });
    expect(movePipelineCard("4", "registered")).toEqual({ ok: false, reason: "same-column" });
    expect(movePipelineCard("4", "no-such-step")).toEqual({ ok: false, reason: "unknown-column" });
    expect(pipeline().moves).toHaveLength(0);
    expect(pipeline().cards).toHaveLength(0);
  });

  it("is refused for a candidate (no pipeline yet)", () => {
    const id = addStep();
    as("20");
    expect(movePipelineCard("4", id)).toEqual({ ok: false, reason: "no-access" });
  });

  it("undo removes the move and restores the card, not the person", () => {
    const id = addStep();
    const first = movePipelineCard("4", id);
    const second = movePipelineCard("4", "registered");
    if (!first.ok || !second.ok) throw new Error("moves failed");
    second.undo();
    expect(pipeline().cards.find((c) => c.personId === "4")?.column).toBe(id);
    expect(pipeline().moves).toHaveLength(1);
    first.undo();
    expect(pipeline().cards.find((c) => c.personId === "4")).toBeUndefined();
    expect(person("4").bizClass).toBe("apprentice");
    expect(person("4").businessStartDate).toBe("2026-01-08");
  });

  it("can be taken off the board and put back; the person stays what they are", () => {
    addStep();
    const undo = dropPipelineCard("4");
    expect(undo).toBeTypeOf("function");
    expect(pipeline().cards.find((c) => c.personId === "4")).toMatchObject({
      column: "registered",
    });
    expect(pipeline().cards.find((c) => c.personId === "4")?.droppedAt).not.toBeNull();
    expect(movePipelineCard("4", "registered")).toEqual({ ok: false, reason: "not-on-board" });
    expect(person("4").bizClass).toBe("apprentice");
    restorePipelineCard("4");
    expect(pipeline().cards.find((c) => c.personId === "4")?.droppedAt).toBeNull();
    expect(dropPipelineCard("4")).toBeTypeOf("function");
    expect(dropPipelineCard("4")).toBeNull();
  });
});

describe("a prospect registers first", () => {
  it("cannot go to a step after Registered; moving into Registered registers; undo of each does its own thing", () => {
    const id = addStep();
    expect(movePipelineCard("9", id)).toEqual({ ok: false, reason: "registered-only" });
    const reg = movePipelineCard("9", "registered");
    expect(reg.ok && reg.registered).toBe(true);
    expect(person("9")).toMatchObject({ bizClass: "apprentice", businessStartDate: localDate() });
    const hist = person("9").stageHistory?.length;
    const inStep = movePipelineCard("9", id);
    expect(inStep.ok && inStep.registered).toBe(false);
    expect(person("9").stageHistory?.length).toBe(hist);
    if (!inStep.ok || !reg.ok) throw new Error("moves failed");
    inStep.undo();
    expect(person("9").bizClass).toBe("apprentice"); // undoing the step move does not un-register
    expect(pipeline().cards.find((c) => c.personId === "9")?.column).toBe("registered");
    reg.undo();
    expect(person("9").bizClass).toBe("prospect"); // undoing the registering move does
    expect(pipeline().cards.find((c) => c.personId === "9")).toBeUndefined(); // no stored card before the first move
  });
});

describe("tasks and notes on a registered person's card", () => {
  const ref = { board: "recruiting" as const, id: "4" };
  it("do not exist while no step after Registered does (as before)", () => {
    setPerson("4", { businessStartDate: localDate() });
    expect(canEditCard(ref)).toBe(false);
    expect(addCardTask(ref, { title: "Call" }).ok).toBe(false);
  });
  it("work while the card is in progress: registered since the cutoff, or in a step", () => {
    const id = addStep();
    expect(canEditCard(ref)).toBe(false); // registered in January: finished
    setPerson("4", { businessStartDate: localDate() });
    expect(canEditCard(ref)).toBe(true);
    expect(addCardTask(ref, { title: "Call" }).ok).toBe(true);
    setPerson("4", { businessStartDate: "2026-01-08" });
    expect(canEditCard(ref)).toBe(false);
    expect(movePipelineCard("4", id).ok).toBe(true);
    expect(canEditCard(ref)).toBe(true);
    // taken off the board: no longer in progress
    dropPipelineCard("4");
    expect(canEditCard(ref)).toBe(false);
  });
  it("a prospect's card is unchanged", () => {
    expect(canEditCard({ board: "recruiting", id: "9" })).toBe(true);
  });
});
