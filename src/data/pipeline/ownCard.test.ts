import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePeopleStore } from "@/stores/peopleStore";
import { DEMO_USERS, useSessionStore } from "@/stores/sessionStore";
import { seedPeople } from "@/data/seed";
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
import { useCustomerPipelineStore } from "../customerPipeline/store";
import { emptyPipeline, pipeline, usePipelineStore } from "./store";
import {
  addPipelineStep,
  dropPipelineCard,
  movePipelineCard,
  restorePipelineCard,
} from "./mutations";

// Maria (1) -> Anita (2) -> Jamal (4, apprentice) -> Carlos (9, prospect).
const as = (id: string) =>
  useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === id)! });
const card = (id: string) => pipeline().cards.find((c) => c.personId === id);

beforeEach(() => {
  usePeopleStore.setState({ people: seedPeople() });
  usePipelineStore.setState(emptyPipeline());
  useCustomerPipelineStore.setState({ entries: [], cards: [], moves: [], steps: [], hides: [] });
  useCardTasksStore.setState({ tasks: [], notes: [] });
});

describe("nobody moves, takes off or puts back their own card", () => {
  it("a registered person sees their card but their own moves, take-offs and put-backs do nothing", () => {
    as("2");
    const r = addPipelineStep("registered", "Activated");
    if (!r.ok || !r.step) throw new Error("step not added");
    const id = r.step.id;
    // Anita moves Jamal's card into the step, then he tries everything with his own card.
    expect(movePipelineCard("4", id).ok).toBe(true);
    const moves = pipeline().moves.length;
    as("4");
    expect(movePipelineCard("4", "registered")).toEqual({ ok: false, reason: "no-access" });
    expect(movePipelineCard("4", id)).toEqual({ ok: false, reason: "no-access" });
    expect(dropPipelineCard("4")).toBeNull();
    expect(card("4")).toMatchObject({ column: id, droppedAt: null });
    expect(pipeline().moves).toHaveLength(moves);
    // taken off by Anita, he cannot put it back
    as("2");
    expect(dropPipelineCard("4")).toBeTypeOf("function");
    as("4");
    restorePipelineCard("4");
    expect(card("4")?.droppedAt).not.toBeNull();
    // Anita (the owner) and Maria (an upline) still can
    as("2");
    restorePipelineCard("4");
    expect(card("4")?.droppedAt).toBeNull();
    expect(movePipelineCard("4", "registered").ok).toBe(true);
    as("1");
    expect(movePipelineCard("4", id).ok).toBe(true);
    expect(dropPipelineCard("4")).toBeTypeOf("function");
  });

  it("changes nothing for a prospect's card, or for moving someone else's", () => {
    as("2");
    expect(movePipelineCard("9", "first_meeting").ok).toBe(true);
    expect(dropPipelineCard("9")).toBeTypeOf("function");
    restorePipelineCard("9");
    expect(card("9")?.droppedAt).toBeNull();
  });
});
