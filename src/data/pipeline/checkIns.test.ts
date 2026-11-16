import { describe, expect, it } from "vitest";
import {
  CHECK_IN_BASIS_LABEL,
  DEFAULT_CHECK_IN_MONTHS,
  checkInBasis,
  everyMonths,
  monthsFor,
  monthsText,
  prospectCheckIn,
  revisitHint,
  validCheckInMonths,
  validCheckInSet,
  type CheckInCard,
} from "./checkIns";
import { FIXED_RECRUITING_COLUMNS } from "./types";

const SET = DEFAULT_CHECK_IN_MONTHS;
const card = (
  column: string,
  rating: CheckInCard["rating"] = null,
  droppedAt: string | null = null,
) => ({ column, rating, droppedAt }) satisfies CheckInCard;
/** Days since the date (in a fixed calendar, no clock). */
const check = (
  lastContact: string | undefined,
  c: CheckInCard | undefined,
  today: string,
  joined?: string,
) => prospectCheckIn({ joinedDate: joined }, lastContact, c, SET, today);

describe("defaults", () => {
  it("are Hot 3, Warm 6, Cold 12, Not interested 12", () => {
    expect(SET).toEqual({ hot: 3, warm: 6, cold: 12, notInterested: 12 });
  });
});

describe("which interval a card selects", () => {
  it("uses the rating's interval for a card on the board", () => {
    expect(checkInBasis(card("first_meeting", "hot"))).toBe("hot");
    expect(checkInBasis(card("first_meeting", "warm"))).toBe("warm");
    expect(checkInBasis(card("first_meeting", "cold"))).toBe("cold");
    expect(monthsFor("hot", SET)).toBe(3);
    expect(monthsFor("warm", SET)).toBe(6);
    expect(monthsFor("cold", SET)).toBe(12);
  });

  it("no rating, or no card at all, uses the Warm interval", () => {
    expect(checkInBasis(card("contact", null))).toBe("unrated");
    expect(checkInBasis(undefined)).toBe("unrated");
    expect(checkInBasis(null)).toBe("unrated");
    expect(monthsFor("unrated", SET)).toBe(SET.warm);
    expect(CHECK_IN_BASIS_LABEL.unrated).toBe("Not rated");
  });

  it("Not interested uses its own interval, whatever the rating", () => {
    for (const r of ["hot", "warm", "cold", null] as const) {
      expect(checkInBasis(card("not_interested", r))).toBe("not_interested");
    }
    expect(monthsFor("not_interested", SET)).toBe(12);
    expect(monthsFor("not_interested", { ...SET, notInterested: 24 })).toBe(24);
  });

  it("a card taken off the board uses Not interested, whatever its column and rating", () => {
    expect(checkInBasis(card("first_plan", "hot", "2026-10-01T00:00:00Z"))).toBe("not_interested");
    expect(checkInBasis(card("referral_source", "warm", "2026-10-01T00:00:00Z"))).toBe(
      "not_interested",
    );
    // Even a card dropped from Do not contact is a dropped card, not a "never".
    expect(checkInBasis(card("do_not_contact", "hot", "2026-10-01T00:00:00Z"))).toBe(
      "not_interested",
    );
  });

  it("Do not contact is never reminded", () => {
    expect(checkInBasis(card("do_not_contact", "hot"))).toBeNull();
    const c = check("2020-01-01", card("do_not_contact", "hot"), "2026-11-16");
    expect(c).toMatchObject({ basis: null, months: null, due: false, dueOn: null });
  });

  it("the Referral source column is treated by rating like any prospect", () => {
    expect(checkInBasis(card("referral_source", "hot"))).toBe("hot");
    expect(checkInBasis(card("referral_source", null))).toBe("unrated");
  });

  it("reads a stored rating leniently (unknown text is no rating)", () => {
    expect(checkInBasis({ column: "contact", droppedAt: null, rating: "lukewarm" as never })).toBe(
      "unrated",
    );
  });
});

describe("due on or after the last contact plus the interval, in calendar months", () => {
  const hot = card("first_meeting", "hot");

  it("is not due the day before, and is due on the day", () => {
    expect(check("2026-08-16", hot, "2026-11-15")).toMatchObject({
      due: false,
      dueOn: "2026-11-16",
    });
    expect(check("2026-08-16", hot, "2026-11-16")).toMatchObject({
      due: true,
      dueOn: "2026-11-16",
    });
    expect(check("2026-08-16", hot, "2026-12-30").due).toBe(true);
  });

  it("a hot prospect last contacted 20 days ago is not due; one last contacted 4 months ago is", () => {
    expect(check("2026-10-27", hot, "2026-11-16").due).toBe(false);
    expect(check("2026-07-16", hot, "2026-11-16").due).toBe(true);
  });

  it("month ends: Jan 31 plus a month is the last day of February", () => {
    const one = prospectCheckIn({}, "2026-01-31", hot, { ...SET, hot: 1 }, "2026-02-27");
    expect(one).toMatchObject({ dueOn: "2026-02-28", due: false });
    expect(prospectCheckIn({}, "2026-01-31", hot, { ...SET, hot: 1 }, "2026-02-28").due).toBe(true);
  });

  it("leap day: Feb 29 plus a year is Feb 28 the next year; plus 12 months from Feb 28 is Feb 28", () => {
    const cold = card("contact", "cold");
    expect(check("2028-02-29", cold, "2029-02-27").due).toBe(false);
    expect(check("2028-02-29", cold, "2029-02-28")).toMatchObject({
      due: true,
      dueOn: "2029-02-28",
    });
    // A leap February is February 29 for a one-month interval from Jan 31.
    expect(prospectCheckIn({}, "2028-01-31", hot, { ...SET, hot: 1 }, "2028-02-29")).toMatchObject({
      dueOn: "2028-02-29",
      due: true,
    });
  });

  it("crosses a year", () => {
    expect(check("2026-11-30", card("contact", "warm"), "2027-05-30").dueOn).toBe("2027-05-30");
    expect(check("2026-11-30", card("contact", "warm"), "2027-05-29").due).toBe(false);
  });

  it("counts from the day added when never contacted", () => {
    const c = check(undefined, hot, "2026-11-16", "2026-08-16");
    expect(c).toMatchObject({ never: true, due: true, dueOn: "2026-11-16", days: 92 });
    expect(check(undefined, hot, "2026-11-15", "2026-08-16")).toMatchObject({
      never: true,
      due: false,
    });
  });

  it("with no contact and no day added, it is listed (as before), counted from today", () => {
    const c = check(undefined, hot, "2026-11-16");
    expect(c).toMatchObject({ never: true, due: true, dueOn: null, days: null });
    expect(c.intervalDays).toBe(92);
  });

  it("a contact is preferred to the day added", () => {
    expect(check("2026-11-01", hot, "2026-11-16", "2025-01-01")).toMatchObject({
      never: false,
      due: false,
    });
  });

  it("reports days since contact and the interval's length in days (the score's divisor)", () => {
    const c = check("2026-08-16", card("contact", "warm"), "2026-11-16");
    expect(c.days).toBe(92);
    expect(c.intervalDays).toBe(184); // Aug 16 to Feb 16
    expect(c.months).toBe(6);
  });

  it("uses the set it is given, so each of the four can change", () => {
    const mine = { hot: 1, warm: 2, cold: 24, notInterested: 36 };
    const run = (c: CheckInCard) => prospectCheckIn({}, "2026-01-01", c, mine, "2026-12-31");
    expect(run(card("x", "hot")).months).toBe(1);
    expect(run(card("x", "warm")).months).toBe(2);
    expect(run(card("x", "cold")).months).toBe(24);
    expect(run(card("not_interested", "cold")).months).toBe(36);
    expect(run(card("x", "cold")).due).toBe(false);
    expect(run(card("x", "hot")).due).toBe(true);
  });
});

describe("validation and wording", () => {
  it("accepts whole months from 1 to 36", () => {
    expect([0, 1, 36, 37, 2.5, -3, NaN].map(validCheckInMonths)).toEqual([
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(validCheckInSet(SET)).toBe(true);
    expect(validCheckInSet({ ...SET, cold: 37 })).toBe(false);
  });

  it("reads 12 as a year", () => {
    expect(monthsText(12)).toBe("a year");
    expect(monthsText(1)).toBe("1 month");
    expect(monthsText(9)).toBe("9 months");
    expect(everyMonths(12)).toBe("every year");
    expect(everyMonths(1)).toBe("every month");
    expect(everyMonths(3)).toBe("every 3 months");
  });

  it("words the Not interested column's hint from the interval in use", () => {
    expect(revisitHint(12)).toBe("Revisit in a year");
    expect(revisitHint(9)).toBe("Revisit in 9 months");
    expect(revisitHint(1)).toBe("Revisit in 1 month");
    expect(revisitHint(24)).toBe("Revisit in 24 months");
    // The column's own text (before anything is set) matches the default.
    const col = FIXED_RECRUITING_COLUMNS.find((c) => c.id === "not_interested");
    expect(col?.hint).toBe(revisitHint(SET.notInterested));
  });
});
