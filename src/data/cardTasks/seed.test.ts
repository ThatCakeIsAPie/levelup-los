import { describe, expect, it } from "vitest";
import { seedPeople } from "@/data/seed";
import { seedPipeline } from "../pipeline/seed";
import { seedCustomerPipeline } from "../customerPipeline/seed";
import { dueTasksFor } from "./rules";
import { seedCardTasks } from "./seed";

const NOW = new Date("2026-11-14T18:00:00Z");

describe("the card tasks demo seed", () => {
  const people = seedPeople();
  const data = seedCardTasks(people, NOW);
  const pipeline = seedPipeline(people, NOW);
  const lists = seedCustomerPipeline(people, NOW);

  it("puts tasks and notes on cards that are on a board", () => {
    expect(data.tasks.length).toBeGreaterThan(20);
    expect(data.notes.length).toBeGreaterThan(5);
    const prospects = new Set(pipeline.cards.map((c) => c.personId));
    const names = new Set(lists.cards.map((c) => c.entryId));
    for (const t of [...data.tasks, ...data.notes]) {
      expect([t.personId, t.entryId].filter(Boolean)).toHaveLength(1);
      if (t.personId) expect(prospects.has(t.personId), t.id).toBe(true);
      if (t.entryId) expect(names.has(t.entryId), t.id).toBe(true);
    }
  });

  it("gives the card's owner every task and every note", () => {
    const owner = (id: string | null) => people.find((p) => p.id === id)?.sponsorId;
    for (const t of data.tasks.filter((x) => x.personId))
      expect(t.assigneeId, t.id).toBe(owner(t.personId));
    for (const n of data.notes.filter((x) => x.personId))
      expect(n.authorId, n.id).toBe(owner(n.personId));
  });

  it("has unique ids, a time only with a date, ticked tasks stamped, and positions in order", () => {
    const ids = [...data.tasks.map((t) => t.id), ...data.notes.map((n) => n.id)];
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of data.tasks) {
      if (t.dueTime) expect(t.dueDate, t.id).not.toBeNull();
      expect(t.done, t.id).toBe(t.doneAt !== null);
    }
    const byCard = new Map<string, number[]>();
    for (const t of data.tasks) {
      const k = t.personId ?? t.entryId!;
      byCard.set(k, [...(byCard.get(k) ?? []), t.position]);
    }
    for (const [k, pos] of byCard) expect(pos, k).toEqual([...pos].sort((a, b) => a - b));
  });

  it("shows every shape: ticked, open without a day, overdue, today, later, a time, more than one note", () => {
    const day = (n: number) => new Date(NOW.getTime() + n * 864e5).toISOString().slice(0, 10);
    expect(data.tasks.some((t) => t.done)).toBe(true);
    expect(data.tasks.some((t) => !t.done && !t.dueDate)).toBe(true);
    expect(data.tasks.some((t) => !t.done && t.dueDate && t.dueDate < day(0))).toBe(true);
    expect(data.tasks.some((t) => !t.done && t.dueDate === day(0))).toBe(true);
    expect(data.tasks.some((t) => !t.done && t.dueDate && t.dueDate > day(0))).toBe(true);
    expect(data.tasks.some((t) => t.dueTime)).toBe(true);
    const perCard = new Map<string, number>();
    for (const n of data.notes)
      perCard.set(n.personId ?? n.entryId!, (perCard.get(n.personId ?? n.entryId!) ?? 0) + 1);
    expect([...perCard.values()].some((c) => c > 1)).toBe(true);
  });

  it("gives Maria, Anita, Jamal and Tasha tasks due today or overdue on their own cards", () => {
    const cards = new Map<string, { ownerId: string; name: string; customerId?: string | null }>();
    for (const c of pipeline.cards) {
      const p = people.find((x) => x.id === c.personId);
      if (p?.sponsorId) cards.set(`recruiting:${p.id}`, { ownerId: p.sponsorId, name: p.name });
    }
    for (const e of lists.entries)
      cards.set(`customer:${e.id}`, { ownerId: e.ownerId, name: e.name });
    for (const me of ["1", "2", "4", "700"]) {
      const due = dueTasksFor(data.tasks, me, cards, { now: NOW, timeZone: "UTC" }).filter(
        (t) => cards.get(`${t.board}:${t.cardId}`)?.ownerId === me,
      );
      expect(due.length, me).toBeGreaterThan(0);
    }
  });
});
