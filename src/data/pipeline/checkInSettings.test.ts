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

import { DEFAULT_CHECK_IN_MONTHS, type CheckInMonths } from "./checkIns";
import { setCheckInMonths, setConversionTargets, setTeamGoal } from "./mutations";
import { chainOf, effectiveSettings } from "./rules";
import { emptyPipeline, pipeline, usePipelineStore } from "./store";
import type { TeamSetting } from "./types";

const at = "2026-01-01T00:00:00.000Z";
const row = (personId: string, checkIns: CheckInMonths | null | undefined): TeamSetting => ({
  personId,
  mg1Goal: null,
  targets: null,
  ...(checkIns === undefined ? {} : { checkIns }),
  updatedAt: at,
});
const A: CheckInMonths = { hot: 1, warm: 2, cold: 3, notInterested: 4 };
const B: CheckInMonths = { hot: 10, warm: 20, cold: 30, notInterested: 36 };

describe("check-in intervals inherited down the sponsor line (effectiveSettings)", () => {
  // root -> mid -> leaf -> deep
  const chain = ["root", "mid", "leaf", "deep"];
  const used = (settings: TeamSetting[], c = chain) => effectiveSettings(c, settings);

  it("is the defaults when nobody up the line set them", () => {
    expect(used([])).toMatchObject({ checkIns: DEFAULT_CHECK_IN_MONTHS, checkInsFrom: null });
    // Rows that exist only for goals (or saved before the field existed) set nothing.
    expect(used([row("root", null), row("mid", undefined)]).checkInsFrom).toBeNull();
  });

  it("uses a person's own values", () => {
    expect(used([row("deep", A)])).toMatchObject({ checkIns: A, checkInsFrom: "deep" });
  });

  it("uses the sponsor's, and from two and three levels up", () => {
    expect(used([row("leaf", A)])).toMatchObject({ checkIns: A, checkInsFrom: "leaf" });
    expect(used([row("mid", A)])).toMatchObject({ checkIns: A, checkInsFrom: "mid" });
    expect(used([row("root", A)])).toMatchObject({ checkIns: A, checkInsFrom: "root" });
  });

  it("the nearest upline who set them wins, and the whole set comes from that one person", () => {
    const eff = used([row("root", B), row("mid", A)]);
    expect(eff.checkInsFrom).toBe("mid");
    expect(eff.checkIns).toEqual(A); // not a mix of mid's Hot and root's Cold
    expect(used([row("root", A), row("mid", B), row("leaf", A)]).checkInsFrom).toBe("leaf");
    // The order of the rows in the table does not matter.
    expect(used([row("mid", A), row("root", B)]).checkInsFrom).toBe("mid");
  });

  it("a person who cleared theirs (null) falls through to the next one up", () => {
    expect(used([row("root", B), row("leaf", null)])).toMatchObject({
      checkIns: B,
      checkInsFrom: "root",
    });
  });

  it("someone not in the line is never used (a downline, a sideline, a crossline)", () => {
    const rows = [row("deep", A), row("side", A), row("other", B)];
    expect(used(rows, ["root", "mid"]).checkInsFrom).toBeNull();
    expect(used(rows, ["root", "mid", "leaf"]).checkInsFrom).toBeNull();
    expect(used(rows, ["root", "mid", "leaf", "deep"]).checkInsFrom).toBe("deep");
  });

  it("goals and check-ins are resolved separately", () => {
    const rows: TeamSetting[] = [
      { personId: "root", mg1Goal: 50, targets: null, checkIns: B, updatedAt: at },
      { personId: "mid", mg1Goal: 20, targets: null, checkIns: null, updatedAt: at },
    ];
    expect(used(rows)).toMatchObject({ mg1Goal: 20, goalFrom: "mid", checkInsFrom: "root" });
  });

  it("works on the demo people's sponsor chain", () => {
    const people = seedPeople();
    const jamal = chainOf(people, "4");
    expect(jamal[0]).toBe("1");
    expect(jamal.at(-1)).toBe("4");
    expect(used([row("1", B)], jamal)).toMatchObject({ checkIns: B, checkInsFrom: "1" });
    expect(used([row("1", B), row("4", A)], jamal)).toMatchObject({
      checkIns: A,
      checkInsFrom: "4",
    });
    // Jamal's own values are not Maria's.
    expect(used([row("1", B), row("4", A)], chainOf(people, "1")).checkInsFrom).toBe("1");
  });
});

describe("saving your own check-in intervals (demo store)", () => {
  const as = (id: string) =>
    useSessionStore.setState({ user: DEMO_USERS.find((u) => u.personId === id)! });
  const mine = (id: string) => pipeline().settings.find((s) => s.personId === id);

  beforeEach(() => {
    usePeopleStore.setState({ people: seedPeople() });
    usePipelineStore.setState({ ...emptyPipeline(), settings: [] });
  });

  it("saves all four for you, and clears them with null", () => {
    as("1");
    expect(setCheckInMonths(A)).toBe(true);
    expect(mine("1")?.checkIns).toEqual(A);
    expect(setCheckInMonths(null)).toBe(true);
    expect(mine("1")?.checkIns).toBeNull();
  });

  it("refuses anything outside 1 to 36 months (nothing is saved)", () => {
    as("1");
    expect(setCheckInMonths({ ...A, hot: 0 })).toBe(false);
    expect(setCheckInMonths({ ...A, notInterested: 37 })).toBe(false);
    expect(setCheckInMonths({ ...A, cold: 2.5 })).toBe(false);
    expect(mine("1")).toBeUndefined();
  });

  it("writes only your own row", () => {
    as("4");
    setCheckInMonths(B);
    expect(mine("4")?.checkIns).toEqual(B);
    expect(pipeline().settings.map((s) => s.personId)).toEqual(["4"]);
  });

  it("does not disturb your goal and targets, and they do not disturb it", () => {
    as("1");
    setTeamGoal(40);
    setConversionTargets({ contactToMeeting: 20, meetingToPlan: 30, planToRegistered: 40 });
    setCheckInMonths(A);
    expect(mine("1")).toMatchObject({
      mg1Goal: 40,
      targets: { contactToMeeting: 20, meetingToPlan: 30, planToRegistered: 40 },
      checkIns: A,
    });
    setTeamGoal(null);
    setConversionTargets(null);
    expect(mine("1")).toMatchObject({ mg1Goal: null, targets: null, checkIns: A });
  });

  it("a person's change reaches their downline and not their upline", () => {
    const people = seedPeople();
    as("1");
    setCheckInMonths(B); // Maria
    const rows = () => pipeline().settings;
    const jamal = chainOf(people, "4");
    expect(effectiveSettings(jamal, rows()).checkInsFrom).toBe("1");
    as("4");
    setCheckInMonths(A); // Jamal
    expect(effectiveSettings(jamal, rows())).toMatchObject({ checkIns: A, checkInsFrom: "4" });
    expect(effectiveSettings(chainOf(people, "1"), rows())).toMatchObject({
      checkIns: B,
      checkInsFrom: "1",
    });
    setCheckInMonths(null); // Jamal resets
    expect(effectiveSettings(jamal, rows())).toMatchObject({ checkIns: B, checkInsFrom: "1" });
  });
});
