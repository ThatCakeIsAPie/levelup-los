import { describe, expect, it } from "vitest";
import type { Attendance, BizClass, CrmPerson } from "@/data";
import { countByStage, filterByStage, stageChips } from "./stageFilter";

const today = new Date(2026, 9, 16);
const person = (id: string, bizClass: BizClass, extra: Partial<CrmPerson> = {}): CrmPerson => ({
  id,
  name: id,
  bizClass,
  ...extra,
});
const people = new Map(
  [
    person("a1", "apprentice", { businessStartDate: "2026-03-01" }),
    // Past their first year: counts as an IBO.
    person("a2", "apprentice", { businessStartDate: "2025-01-10" }),
    person("i1", "ibo"),
    person("p1", "prospect"),
    person("c1", "customer"),
  ].map((p) => [p.id, p]),
);
const row = (personId: string) => ({ id: `r-${personId}`, eventId: "e1", personId }) as Attendance;
const rows = ["a1", "a2", "i1", "p1", "c1", "gone"].map(row);
const ids = (rs: Attendance[]) => rs.map((a) => a.personId);

describe("attendee stage filter", () => {
  it("none selected shows everyone", () => {
    expect(filterByStage(rows, people, [], today)).toBe(rows);
  });

  it("shows several stages together, by effective stage", () => {
    expect(ids(filterByStage(rows, people, ["ibo"], today))).toEqual(["a2", "i1"]);
    expect(ids(filterByStage(rows, people, ["apprentice", "prospect"], today))).toEqual([
      "a1",
      "p1",
    ]);
    expect(ids(filterByStage(rows, people, ["customer"], today))).toEqual(["c1"]);
  });

  it("counts per stage, skipping people you can't see", () => {
    expect(countByStage(rows, people, today)).toEqual({
      apprentice: 1,
      ibo: 2,
      prospect: 1,
      customer: 1,
    });
  });

  it("shows the Customer chip only when there are customers or it's selected", () => {
    const none = { apprentice: 1, ibo: 0, prospect: 2, customer: 0 };
    expect(stageChips(none, [])).toEqual(["apprentice", "ibo", "prospect"]);
    expect(stageChips(none, ["customer"])).toEqual(["apprentice", "ibo", "customer", "prospect"]);
    expect(stageChips({ ...none, customer: 1 }, [])).toContain("customer");
  });
});
