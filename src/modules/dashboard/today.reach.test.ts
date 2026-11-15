import { describe, expect, it } from "vitest";
import { seedPeople } from "@/data/seed";
import type { DueTask } from "@/data";
import { buildTodayItems, groupToday, type TodayInput } from "./today";

const people = seedPeople();
const maria = people.find((p) => p.id === "1")!;

const base: TodayInput = {
  viewerId: "1",
  role: "leader",
  people: [maria],
  lastContact: new Map(),
  settings: { teamDays: 14, customerDays: 30 },
  events: [],
  attendances: [],
  sales: [],
  now: new Date("2026-11-15T18:00:00Z"),
};

const due = (over: Partial<DueTask>): DueTask => ({
  taskId: "t",
  board: "recruiting",
  cardId: "c",
  name: "Someone",
  title: "Call",
  dueDate: "2026-11-15",
  dueTime: null,
  state: "today",
  daysLate: 0,
  customerId: null,
  ...over,
});

describe("a task due later today stays reachable in Today", () => {
  // Today shows a group's first 3 (2 on phones) and \"See all N\"; the cap is the card's, the list holds everything.
  const tasks = [
    due({
      taskId: "a",
      cardId: "a",
      name: "Gray Reyes",
      state: "overdue",
      daysLate: 2,
      dueDate: "2026-11-13",
    }),
    due({
      taskId: "b",
      cardId: "b",
      name: "Carlos Rivera",
      state: "overdue",
      daysLate: 1,
      dueDate: "2026-11-14",
    }),
    due({ taskId: "c", cardId: "c", name: "Andre Lewis" }),
    due({
      taskId: "d",
      cardId: "d",
      name: "Rowan Xiong",
      dueTime: "18:30",
      title: "First meeting (MG1)",
    }),
  ];

  it("is in the list and in its group's items, behind the overdue ones, ranked with the other tasks due today", () => {
    const items = buildTodayItems({ ...base, tasks });
    expect(items.map((i) => i.key)).toEqual(["task:a", "task:b", "task:c", "task:d"]);
    const pipeline = groupToday(items).find((g) => g.filter === "pipeline")!;
    expect(pipeline.items).toHaveLength(4);
    expect(pipeline.items.at(-1)!.person.name).toBe("Rowan Xiong");
  });

  it("is the first of the day's tasks when it is the only one due today", () => {
    const items = buildTodayItems({ ...base, tasks: [tasks[0], tasks[1], tasks[3]] });
    expect(items.slice(0, 3).map((i) => i.key)).toContain("task:d");
  });
});
