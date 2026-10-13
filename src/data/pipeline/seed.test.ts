import { describe, expect, it } from "vitest";
import { getDate } from "date-fns";
import { localDate } from "@/lib/dates";
import { seedPeople } from "../seed";
import { downlineIds, visibleIdSet } from "../access";
import { seedPipeline, mg1ThisMonth } from "./seed";
import { countReaches, monthBounds, monthOf, monthlySeries, reachesOf } from "./rules";

const people = seedPeople();
const byId = new Map(people.map((p) => [p.id, p]));
const data = seedPipeline(people);
const reaches = reachesOf(data.moves);
const today = localDate();
const month = monthOf(today);
const maria = downlineIds(people, "1");

describe("pipeline seed", () => {
  it("every prospect has a card, and every card is a prospect's", () => {
    const prospects = people.filter((p) => p.bizClass === "prospect").map((p) => p.id);
    const cards = new Set(data.cards.map((c) => c.personId));
    expect(prospects.filter((id) => !cards.has(id))).toEqual([]);
    for (const c of data.cards) expect(byId.get(c.personId)?.bizClass).toBe("prospect");
  });

  it("moves belong to apprentices or IBOs on Maria's team, and each card ends where its last move went", () => {
    for (const m of data.moves) {
      expect(["apprentice", "ibo"]).toContain(byId.get(m.ownerId)?.bizClass);
      expect(maria.has(m.ownerId)).toBe(true);
    }
    for (const c of data.cards) {
      const last = data.moves
        .filter((m) => m.personId === c.personId)
        .sort((a, b) => a.movedAt.localeCompare(b.movedAt))
        .at(-1);
      expect(last?.to).toBe(c.column);
      expect(last?.movedAt).toBe(c.enteredAt);
    }
  });

  it("no move is in the future", () => {
    const now = new Date().toISOString();
    expect(data.moves.filter((m) => m.movedAt > now)).toEqual([]);
  });

  it("first meetings: about 62 by the 13th, rising over the last six months", () => {
    const { from } = monthBounds(month);
    const thisMonth = countReaches(reaches, maria, from, today).first_meeting;
    expect(thisMonth).toBe(mg1ThisMonth(getDate(new Date())));
    const series = monthlySeries(reaches, maria, "first_meeting", month, 6).map((s) => s.count);
    expect(series.slice(0, 5)).toEqual([41, 48, 55, 60, 71]);
  });

  it("this month's registrations are real people, now apprentices", () => {
    const { from } = monthBounds(month);
    for (const r of reaches.filter((x) => x.milestone === "registered" && x.day >= from)) {
      expect(byId.get(r.personId)?.bizClass).toBe("apprentice");
    }
  });

  it("keeps Jamal's branch as the integration tests expect (19 people)", () => {
    expect(visibleIdSet(people, { personId: "4", role: "apprentice" }).size).toBe(19);
  });

  it("business people have unique names", () => {
    const names = people.filter((p) => p.bizClass !== "customer").map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("stays small enough for browser storage", () => {
    expect(JSON.stringify(data).length).toBeLessThan(800_000);
  });
});
