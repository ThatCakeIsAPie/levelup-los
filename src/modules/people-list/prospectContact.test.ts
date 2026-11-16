import { describe, expect, it } from "vitest";
import { DEFAULT_CHECK_IN_MONTHS, prospectCheckIn } from "@/data";
import { prospectContactState } from "./model";

const today = "2026-11-16";
const card = (rating: "hot" | "warm" | "cold" | null, column = "contact") => ({
  column,
  droppedAt: null,
  rating,
});
const state = (last: string | undefined, c: ReturnType<typeof card>) =>
  prospectContactState(
    last,
    prospectCheckIn({ joinedDate: "2026-01-01" }, last, c, DEFAULT_CHECK_IN_MONTHS, today),
  );

describe("People list: a prospect's contact flag follows the check-in interval", () => {
  it("a hot prospect contacted three weeks ago is not overdue (it was, by the 14-day count)", () => {
    expect(state("2026-10-26", card("hot"))).toMatchObject({ overdue: false, tone: "good" });
  });

  it("a hot prospect is overdue after three months, a cold one only after a year", () => {
    expect(state("2026-08-01", card("hot")).overdue).toBe(true);
    expect(state("2026-08-01", card("cold")).overdue).toBe(false);
    expect(state("2025-11-01", card("cold")).overdue).toBe(true);
  });

  it("Not interested waits a year whatever the rating; Do not contact is never overdue", () => {
    expect(state("2026-05-01", card("hot", "not_interested")).overdue).toBe(false);
    expect(state("2025-10-01", card("hot", "not_interested")).overdue).toBe(true);
    expect(state("2020-01-01", card("hot", "do_not_contact")).overdue).toBe(false);
  });

  it("more than twice the interval reads as bad, otherwise as a warning", () => {
    expect(state("2026-07-01", card("hot")).tone).toBe("warn");
    expect(state("2026-01-15", card("hot")).tone).toBe("bad");
  });
});
