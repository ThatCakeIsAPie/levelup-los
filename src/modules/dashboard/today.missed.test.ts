import { describe, expect, it } from "vitest";
import { daysFromToday } from "@/lib/dates";
import type { CrmPerson, MissedStreak } from "@/data";
import { buildTodayItems, countByFilter, type TodayInput } from "./today";

const person = (id: string, o: Partial<CrmPerson> = {}): CrmPerson => ({
  id,
  name: `Person ${id}`,
  bizClass: "apprentice",
  sponsorId: "lead",
  ...o,
});
const ev = (id: string, d: number) => ({
  id,
  name: "Night Owls",
  categoryId: "w1-night_owls",
  date: daysFromToday(d),
});
const streak = (personId: string, latestDaysAgo: number): MissedStreak => ({
  key: `${personId}:w1-night_owls`,
  personId,
  categoryId: "w1-night_owls",
  lastAttended: ev("o1", -latestDaysAgo - 7),
  missed: [ev("o2", -latestDaysAgo)],
  latest: ev("o2", -latestDaysAgo),
  notes: [],
});

const base = (o: Partial<TodayInput>): TodayInput => ({
  viewerId: "lead",
  role: "ibo",
  people: [person("lead"), person("tasha"), person("ed")],
  // Everyone contacted today, so only the missed items show.
  lastContact: new Map([
    ["tasha", daysFromToday(0)],
    ["ed", daysFromToday(0)],
  ]),
  settings: { teamDays: 14, customerDays: 30 },
  events: [],
  attendances: [],
  sales: [],
  ...o,
});

describe("buildTodayItems: missed-event follow-ups", () => {
  it("adds one Events item per open follow-up, most recent miss first", () => {
    const items = buildTodayItems(base({ missed: [streak("ed", 9), streak("tasha", 2)] }));
    expect(items.map((i) => i.key)).toEqual([
      "missed:tasha:w1-night_owls",
      "missed:ed:w1-night_owls",
    ]);
    expect(items[0]).toMatchObject({ kind: "missed", filter: "events", daysAgo: 2, score: 648 });
    expect(countByFilter(items).events).toBe(2);
  });

  it("never shows the viewer their own, nor anyone they can't see", () => {
    const items = buildTodayItems(base({ missed: [streak("lead", 2), streak("stranger", 2)] }));
    expect(items).toEqual([]);
  });

  it("isn't hidden by Do not contact, and candidates never get them", () => {
    const missed = [streak("tasha", 2)];
    expect(buildTodayItems(base({ missed, doNotContact: new Set(["tasha"]) }))).toHaveLength(1);
    expect(buildTodayItems(base({ missed, role: "candidate" }))).toEqual([]);
  });
});
