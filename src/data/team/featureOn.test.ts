import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

import { computeUnlocks } from "../unlocks";
import { featureOnFor, switchMap } from "./rules";
import { FEATURE_KEYS, featureDefault, type FeatureKey, type FeatureSwitch } from "./types";
import { getUnlocks, isFeatureOn, useFeature, useFeatureSwitches } from "./hooks";
import { useTeamStore } from "./store";
import { useSessionStore, type DemoUser, type Role } from "@/stores/sessionStore";

/** Who is looking: a leader, a deputy (an IBO acting for the leader), a member, a candidate. */
const WHO = {
  leader: { role: "leader" as Role, deputyOf: [] as string[] },
  deputy: { role: "ibo" as Role, deputyOf: ["1"] },
  member: { role: "ibo" as Role, deputyOf: [] as string[] },
  candidate: { role: "candidate" as Role, deputyOf: [] as string[] },
};
type Who = keyof typeof WHO;
const WHOS = Object.keys(WHO) as Who[];
type SwitchState = "on" | "off" | "missing";
const STATES: SwitchState[] = ["on", "off", "missing"];

/** What the team has stored for one feature in this state (a missing row is no entry). */
const stored = (key: FeatureKey, state: SwitchState): Partial<Record<FeatureKey, boolean>> =>
  state === "missing" ? {} : { [key]: state === "on" };

/** The rule, written out by hand (not through the code under test). */
function expected(who: Who, admin: boolean, key: FeatureKey, state: SwitchState): boolean {
  const teamOn = state === "missing" ? key === "agents" : state === "on";
  const canFlip = who === "leader" || who === "deputy";
  if (canFlip) return teamOn;
  return admin || teamOn;
}

describe("featureOnFor: the admin preview does not apply to someone who can flip the switches", () => {
  for (const key of FEATURE_KEYS)
    for (const who of WHOS)
      for (const admin of [false, true])
        for (const state of STATES) {
          const name = `${key}: ${who}${admin ? " + admin" : ""}, switch ${state}`;
          const want = expected(who, admin, key, state);
          it(`${name} -> ${want ? "on" : "off"}`, () => {
            const team = stored(key, state);
            const teamOn = team[key] ?? featureDefault(key);
            expect(featureOnFor({ ...WHO[who], admin }, teamOn)).toBe(want);
            // computeUnlocks goes through it, with the stored switches as they are (missing too)
            const u = computeUnlocks({
              ...WHO[who],
              admin,
              firstSponsor: true,
              threeTen: true,
              canChat: who !== "candidate",
              switches: team,
            });
            expect(u.feature[key]).toBe(want);
          });
        }

  it("a leader who is an admin loses a feature they switch off; a plain admin keeps the preview", () => {
    expect(featureOnFor({ role: "leader", admin: true }, false)).toBe(false);
    expect(featureOnFor({ role: "ibo", admin: true, deputyOf: ["1"] }, false)).toBe(false);
    expect(featureOnFor({ role: "ibo", admin: true, deputyOf: [] }, false)).toBe(true);
    expect(featureOnFor({ role: "apprentice", admin: true }, false)).toBe(true);
    expect(featureOnFor({ role: undefined, admin: false }, false)).toBe(false);
  });

  it("the areas follow: an admin leader with chats, library and campaigns off has none of them", () => {
    const u = computeUnlocks({
      role: "leader",
      admin: true,
      firstSponsor: true,
      threeTen: true,
      canChat: true,
      switches: { chats: false, library: false, campaigns: false, agents: false },
    });
    expect([u.can.chats, u.can.library, u.can.campaigns, u.can.inbox]).toEqual([
      false,
      false,
      false,
      true, // the inbox still carries pipeline notifications (a leader has the pipeline)
    ]);
    expect(u.feature).toEqual({ chats: false, library: false, campaigns: false, agents: false });
    // everything that is not a switched feature stays open to them
    expect(u.can.teamSettings && u.can.reports && u.can.eventPlanning && u.can.wallet).toBe(true);
  });
});

describe("switchMap defaults", () => {
  it("no row: off for Chats, Library and Campaigns, on for AI agents", () => {
    expect(switchMap([])).toEqual({ chats: false, library: false, campaigns: false, agents: true });
  });

  it("an explicit row decides, on or off", () => {
    const row = (feature: FeatureKey, enabled: boolean): FeatureSwitch => ({
      workspaceId: "w1",
      feature,
      enabled,
    });
    expect(switchMap([row("agents", false)]).agents).toBe(false);
    expect(switchMap([row("agents", true)]).agents).toBe(true);
    expect(switchMap([row("library", true)]).library).toBe(true);
    expect(switchMap([row("library", false), row("chats", true)])).toEqual({
      chats: true,
      library: false,
      campaigns: false,
      agents: true,
    });
  });

  it("only AI agents has a default on", () => {
    expect(FEATURE_KEYS.filter((k) => featureDefault(k))).toEqual(["agents"]);
  });
});

// ---------------------------------------------------------------------------
// The hooks and the non-reactive readers agree with the rule (stores set directly; the hooks
// render once on the server, where zustand reads its initial state, so read the live snapshot instead).
// ---------------------------------------------------------------------------

const person = (personId: string, role: Role, admin: boolean): DemoUser => ({
  personId,
  name: `P${personId}`,
  role,
  ...(admin ? { admin: true } : {}),
});

function setWorld(who: Who, admin: boolean, switches: FeatureSwitch[]) {
  useSessionStore.setState({ user: person("77", WHO[who].role, admin) });
  useTeamStore.setState({
    deputies: WHO[who].deputyOf.map((leaderId) => ({ leaderId, deputyId: "77" })),
    switches,
  });
}

function renderFeature(key: FeatureKey): boolean {
  const Probe = () => createElement("i", null, useFeature(key) ? "on" : "off");
  return renderToStaticMarkup(createElement(Probe)) === "<i>on</i>";
}

describe("useFeature, isFeatureOn and getUnlocks agree with the rule", () => {
  const before = {
    user: useSessionStore.getState().user,
    team: useTeamStore.getState(),
  };
  beforeEach(() => {
    vi.spyOn(React, "useSyncExternalStore").mockImplementation((_subscribe, getSnapshot) =>
      getSnapshot(),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ user: before.user });
    useTeamStore.setState(before.team, true);
  });

  for (const key of FEATURE_KEYS)
    for (const who of WHOS)
      for (const admin of [false, true])
        for (const state of STATES) {
          it(`${key}: ${who}${admin ? " + admin" : ""}, switch ${state}`, () => {
            const rows: FeatureSwitch[] =
              state === "missing"
                ? []
                : [{ workspaceId: "w1", feature: key, enabled: state === "on" }];
            setWorld(who, admin, rows);
            const want = expected(who, admin, key, state);
            expect(isFeatureOn(key)).toBe(want);
            expect(renderFeature(key)).toBe(want);
            expect(getUnlocks().feature[key]).toBe(want);
          });
        }

  it("the switch list reads the real values for an admin leader (Team settings can switch back on)", () => {
    setWorld("leader", true, [
      { workspaceId: "w1", feature: "library", enabled: false },
      { workspaceId: "w1", feature: "agents", enabled: false },
    ]);
    const Probe = () => {
      const s = useFeatureSwitches();
      return createElement("i", null, FEATURE_KEYS.map((k) => `${k}=${s[k]}`).join(","));
    };
    expect(renderToStaticMarkup(createElement(Probe))).toBe(
      "<i>chats=false,library=false,campaigns=false,agents=false</i>",
    );
    expect(isFeatureOn("library")).toBe(false);
    // no stored switch at all: AI agents lists as on
    setWorld("leader", true, []);
    expect(renderToStaticMarkup(createElement(Probe))).toBe(
      "<i>chats=false,library=false,campaigns=false,agents=true</i>",
    );
  });
});
