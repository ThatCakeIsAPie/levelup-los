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
  now: new Date("2026-11-14T18:00:00Z"),
};

const due = (over: Partial<DueTask> = {}): DueTask => ({
  taskId: "t1",
  board: "recruiting",
  cardId: "502",
  name: "Grace Kim",
  title: "Text Grace to confirm",
  dueDate: "2026-11-14",
  dueTime: null,
  state: "today",
  daysLate: 0,
  customerId: null,
  ...over,
});

describe("card tasks in Today's list", () => {
  it("lists a due task where booked steps appeared, scored 750 plus the days late", () => {
    const items = buildTodayItems({
      ...base,
      people: people.filter((p) => ["1", "502"].includes(p.id)),
      tasks: [due(), due({ taskId: "t2", daysLate: 3, state: "overdue", dueDate: "2026-11-11" })],
    });
    expect(items.map((i) => [i.kind, i.score])).toEqual([
      ["task", 753],
      ["task", 750],
    ]);
    expect(items[0]).toMatchObject({ filter: "pipeline", sub: "recruiting", key: "task:t2" });
    expect(items[1].person.name).toBe("Grace Kim");
  });

  it("caps the days late at 49 like booked steps", () => {
    const [i] = buildTodayItems({ ...base, tasks: [due({ daysLate: 400, state: "overdue" })] });
    expect(i.score).toBe(799);
  });

  it("stands in a list name for the person, and files a name that already buys under customers", () => {
    const items = buildTodayItems({
      ...base,
      tasks: [
        due({ taskId: "a", board: "customer", cardId: "le-1", name: "Lee List" }),
        due({
          taskId: "b",
          board: "customer",
          cardId: "le-2",
          name: "Ola Buyer",
          customerId: "c1",
        }),
      ],
    });
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey["task:a"]).toMatchObject({ filter: "pipeline", sub: "customer" });
    expect(byKey["task:a"].person).toMatchObject({
      id: "le-1",
      name: "Lee List",
      bizClass: "customer",
    });
    expect(byKey["task:b"].filter).toBe("customers");
    expect(groupToday(items).map((g) => g.filter)).toEqual(["customers", "pipeline"]);
  });

  it("leaves out a card hidden from reminders (Do not contact)", () => {
    const items = buildTodayItems({
      ...base,
      people: people.filter((p) => ["1", "502"].includes(p.id)),
      doNotContact: new Set(["502"]),
      tasks: [due()],
    });
    expect(items).toEqual([]);
  });
});
