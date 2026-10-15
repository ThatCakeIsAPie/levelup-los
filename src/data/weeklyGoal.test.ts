import { describe, expect, it } from "vitest";
import { DEFAULT_LEARNING_GOAL } from "@/stores/crmStore";
import type { Contact, Learning, LearningGoal, Sale } from "@/stores/crmStore";
import type { CrmPerson } from "@/stores/peopleStore";
import type { Attendance } from "@/stores/attendanceStore";
import type { CrmEvent } from "@/stores/eventsStore";
import { localNoon, type MoveLike } from "./pipeline/rules";
import {
  GOAL_CATEGORIES,
  GOAL_KINDS,
  addableCategories,
  goalProgress,
  goalUnit,
  goalWeek,
  itemLine,
  itemsFromLegacy,
  legacyGoalColumns,
  newGoalItem,
  parseGoalItems,
  weeklyGoalView,
  type GoalInput,
  type GoalItem,
} from "./weeklyGoal";

const today = "2026-10-14"; // the week is 2026-10-08 .. 2026-10-14
const me = "1";

let n = 0;
const learn = (l: Omit<Learning, "id" | "personId" | "date"> & Partial<Learning>): Learning => ({
  id: `l${n++}`,
  personId: me,
  date: today,
  ...l,
});
const contact = (byId: string, date: string): Contact => ({
  id: `k${n++}`,
  personId: "9",
  byId,
  date,
});
const customer = (id: string, ownerId: string, joinedDate?: string): CrmPerson => ({
  id,
  name: id,
  bizClass: "customer",
  ownerId,
  sponsorId: null,
  ...(joinedDate ? { joinedDate } : {}),
});
const sale = (
  id: string,
  customerId: string,
  date: string,
  pv: number,
  personId?: string,
): Sale => ({
  id,
  customerId,
  product: "P",
  date,
  pv,
  ...(personId ? { personId } : {}),
});
const attended = (eventId: string, personId: string, came?: boolean): Attendance => ({
  id: `a${n++}`,
  eventId,
  personId,
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...(came === undefined ? {} : { attended: came }),
});
const event = (id: string, date: string): CrmEvent => ({ id, date }) as CrmEvent;
const move = (personId: string, ownerId: string, milestone: string, day: string): MoveLike => ({
  personId,
  ownerId,
  milestone,
  movedAt: localNoon(day),
});

const input: GoalInput = {
  personId: me,
  today,
  learning: [
    learn({ kind: "pages", title: "A", amount: 20 }), // before units: pages
    learn({ kind: "pages", title: "A", amount: 3, unit: "chapters" }),
    learn({ kind: "pages", title: "A", amount: 25, unit: "minutes", date: "2026-10-08" }),
    learn({ kind: "podcast", title: "B", amount: 1 }), // before units: an episode
    learn({ kind: "podcast", title: "C", amount: 2, unit: "episodes" }),
    learn({ kind: "podcast", title: "D", amount: 45, unit: "minutes" }),
    learn({ kind: "workshop", title: "E", amount: 1 }),
    learn({ kind: "conference", title: "F", amount: 1 }),
    learn({ kind: "pages", title: "A", amount: 99, date: "2026-10-07" }), // last week
    learn({ kind: "pages", title: "A", amount: 50, personId: "2" }), // someone else
  ],
  contacts: [
    contact(me, today),
    contact(me, today),
    contact(me, "2026-10-08"),
    contact(me, "2026-10-07"), // last week
    contact("2", today), // someone else's check-in
  ],
  people: [
    { id: me, name: "Me", bizClass: "ibo", sponsorId: null },
    customer("c1", me, "2026-10-10"), // added by hand this week
    customer("c2", me, "2026-09-01"), // a customer for a while
    customer("c3", me), // made by the customer pipeline this week (no joined date)
    customer("c4", "2", "2026-10-10"), // someone else's
    customer("c5", me), // no date at all: not counted
  ],
  sales: [
    sale("s1", "c1", "2026-10-12", 60, me),
    sale("s2", me, "2026-10-13", 35), // personal order, from before personId
    sale("s3", "c2", "2026-10-09", 20), // the owner's PV, from before personId
    sale("s4", "c4", "2026-10-12", 100, "2"), // someone else's
    sale("s5", "c2", "2026-10-01", 40, me), // last week
  ],
  attendances: [
    attended("e1", me, true),
    attended("e2", me, true), // event last week
    attended("e3", me, false), // a no-show
    attended("e4", me), // not recorded
    attended("e3", "2", true), // someone else
  ],
  events: [
    event("e1", "2026-10-10"),
    event("e2", "2026-10-01"),
    event("e3", today),
    event("e4", "2026-10-12"),
  ],
  pipelineMoves: [
    move("p1", me, "contact", "2026-10-01"),
    move("p1", me, "first_meeting", "2026-10-09"), // counts
    move("p2", me, "first_plan", "2026-10-12"), // straight past First meeting: counts
    move("p3", me, "first_meeting", "2026-10-02"),
    move("p3", me, "contact", "2026-10-05"),
    move("p3", me, "first_meeting", "2026-10-10"), // again: already counted on the 2nd
    move("p4", "2", "first_meeting", "2026-10-11"), // someone else's board
    move("p5", me, "start", "2026-10-11"), // reaches nothing
  ],
  customerMoves: [
    { createdCustomerId: "c3", movedAt: localNoon("2026-10-12") },
    { createdCustomerId: null, movedAt: localNoon("2026-10-12") },
  ],
};

const count = (item: GoalItem) => GOAL_CATEGORIES[item.kind].count(input, item.unit);

describe("goalWeek", () => {
  it("is today and the six days before", () => {
    expect(goalWeek(today)).toEqual({ from: "2026-10-08", to: today });
  });
});

describe("counting each category this week", () => {
  it("reading in the goal's unit (entries without one are pages)", () => {
    expect(count({ kind: "reading", target: 60, unit: "pages" })).toBe(20);
    expect(count({ kind: "reading", target: 5, unit: "chapters" })).toBe(3);
    expect(count({ kind: "reading", target: 60, unit: "minutes" })).toBe(25);
    expect(count({ kind: "reading", target: 60 })).toBe(20);
  });

  it("podcasts in the goal's unit (entries without one are episodes)", () => {
    expect(count({ kind: "podcasts", target: 3, unit: "episodes" })).toBe(3);
    expect(count({ kind: "podcasts", target: 60, unit: "minutes" })).toBe(45);
  });

  it("workshops and conferences together", () => {
    expect(count({ kind: "workshops", target: 1 })).toBe(2);
  });

  it("contacts the person logged", () => {
    expect(count({ kind: "contacts", target: 10 })).toBe(3);
  });

  it("new customers by the day they became one (joined date, else the move that made them)", () => {
    expect(count({ kind: "new_customers", target: 2 })).toBe(2);
  });

  it("PV of sales that count toward the person", () => {
    expect(count({ kind: "pv", target: 150 })).toBe(60 + 35 + 20);
  });

  it("events attended, by the event's date", () => {
    expect(count({ kind: "events", target: 1 })).toBe(1);
  });

  it("first meetings reached on the person's board, once per prospect", () => {
    expect(count({ kind: "first_meetings", target: 3 })).toBe(2);
  });

  it("nothing for someone with no rows", () => {
    for (const kind of GOAL_KINDS) {
      expect(GOAL_CATEGORIES[kind].count({ ...input, personId: "nobody" }, undefined)).toBe(0);
    }
  });
});

describe("weekly goal progress", () => {
  it("counts the default goal like before (pages, episodes, workshops)", () => {
    const view = weeklyGoalView(DEFAULT_LEARNING_GOAL, input);
    expect(view.items.map((i) => [i.item.kind, i.done])).toEqual([
      ["reading", 20],
      ["podcasts", 3],
      ["workshops", 2],
    ]);
    // 20/60, 3/3, 2/1 capped at 1.
    expect(view.progress).toBeCloseTo((20 / 60 + 1 + 1) / 3);
  });

  it("follows items as they're added and removed", () => {
    const goal: LearningGoal = {
      items: [
        { kind: "reading", target: 50, unit: "minutes" },
        { kind: "contacts", target: 6 },
      ],
    };
    expect(weeklyGoalView(goal, input).progress).toBeCloseTo((25 / 50 + 3 / 6) / 2);
    const added: LearningGoal = { items: [...goal.items, { kind: "pv", target: 230 }] };
    expect(weeklyGoalView(added, input).progress).toBeCloseTo((25 / 50 + 3 / 6 + 115 / 230) / 3);
    const removed: LearningGoal = { items: added.items.filter((i) => i.kind !== "contacts") };
    expect(weeklyGoalView(removed, input).progress).toBeCloseTo((25 / 50 + 115 / 230) / 2);
  });

  it("is 0 for an empty goal", () => {
    expect(weeklyGoalView({ items: [] }, input)).toEqual({ items: [], progress: 0 });
    expect(goalProgress([])).toBe(0);
  });

  it("caps each item at 100%", () => {
    expect(
      goalProgress([
        { done: 30, target: 10 },
        { done: 0, target: 5 },
      ]),
    ).toBe(0.5);
  });

  it("labels each item", () => {
    const [reading, , workshops] = weeklyGoalView(DEFAULT_LEARNING_GOAL, input).items;
    expect(itemLine(reading)).toBe("20 of 60 pages");
    expect(itemLine(workshops)).toBe("2 of 1 workshops");
    const pv = weeklyGoalView({ items: [{ kind: "pv", target: 150 }] }, input).items[0];
    expect(itemLine(pv)).toBe("115 of 150 PV");
    expect(pv.category.rowLabel()).toBe("PV");
    expect(GOAL_CATEGORIES.reading.rowLabel("minutes")).toBe("Reading (min)");
  });
});

describe("goals from before lists", () => {
  it("become reading, podcasts and workshops, leaving out 0 targets", () => {
    expect(itemsFromLegacy({ pages: 60, podcasts: 3, workshops: 1 })).toEqual(
      DEFAULT_LEARNING_GOAL.items,
    );
    expect(
      itemsFromLegacy({
        pages: 0,
        podcasts: 90,
        workshops: 2,
        readingUnit: "chapters",
        podcastUnit: "minutes",
      }),
    ).toEqual([
      { kind: "podcasts", target: 90, unit: "minutes" },
      { kind: "workshops", target: 2 },
    ]);
  });

  it("are kept in step when a list is saved", () => {
    expect(
      legacyGoalColumns([
        { kind: "contacts", target: 10 },
        { kind: "podcasts", target: 2, unit: "minutes" },
      ]),
    ).toEqual({ pages: 0, podcasts: 2, workshops: 0, readingUnit: null, podcastUnit: "minutes" });
    // And read back the same where the old shape can say it.
    const items = parseGoalItems(DEFAULT_LEARNING_GOAL.items);
    expect(itemsFromLegacy(legacyGoalColumns(items))).toEqual(items);
  });
});

describe("editing helpers", () => {
  it("offer what isn't in the goal yet, First meetings only with the pipeline", () => {
    const items = DEFAULT_LEARNING_GOAL.items;
    expect(addableCategories(items, { pipeline: false })).toEqual([
      "contacts",
      "new_customers",
      "pv",
      "events",
    ]);
    expect(addableCategories(items, { pipeline: true })).toContain("first_meetings");
    expect(addableCategories([{ kind: "first_meetings", target: 3 }], {})).not.toContain(
      "first_meetings",
    );
  });

  it("add a category with its default target and unit", () => {
    expect(newGoalItem("reading")).toEqual({ kind: "reading", target: 60, unit: "pages" });
    expect(newGoalItem("contacts")).toEqual({ kind: "contacts", target: 10 });
    expect(newGoalItem("pv")).toEqual({ kind: "pv", target: 100 });
  });

  it("give the learning log form the goal's units", () => {
    const goal: LearningGoal = {
      items: [
        { kind: "contacts", target: 5 },
        { kind: "reading", target: 30, unit: "minutes" },
      ],
    };
    expect(goalUnit(goal, "reading")).toBe("minutes");
    expect(goalUnit(goal, "podcasts")).toBeUndefined();
    expect(goalUnit(DEFAULT_LEARNING_GOAL, "podcasts")).toBe("episodes");
  });
});
