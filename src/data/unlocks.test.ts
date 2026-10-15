import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/dates";
import {
  computeUnlocks,
  routeAccess,
  unlockStage,
  type UnlockInput,
  type Unlocks,
} from "./unlocks";
import { canManageEvents } from "./eventTypes/info";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "./seed";
import { hasEverReachedMilestone, historyUpdates, isMilestoneHeld } from "./growth/engine";
import type { CrmPerson } from "@/stores/peopleStore";
import type { GrowthMilestoneCode } from "./growth/types";
import { seedDeputies } from "./team/seed";
import { deputyOfIds } from "./team/rules";
import { DEMO_USERS } from "@/stores/sessionStore";

const base: UnlockInput = {
  role: "apprentice",
  firstSponsor: false,
  threeTen: false,
  switches: {},
  canChat: true,
};
const u = (patch: Partial<UnlockInput>) => computeUnlocks({ ...base, ...patch });
const ctx = { me: "700", ownsCustomer: (id: string) => id === "c11" };
const open = (path: string, x: Unlocks) => routeAccess(path, x, ctx).ok;

describe("unlock stages", () => {
  it("follows role and milestones; leaders and deputies count as leaders", () => {
    expect(unlockStage(base)).toBe("new_apprentice");
    expect(unlockStage({ ...base, firstSponsor: true })).toBe("first_sponsor");
    expect(unlockStage({ ...base, role: "ibo", firstSponsor: true, threeTen: true })).toBe(
      "builder",
    );
    expect(unlockStage({ ...base, role: "leader" })).toBe("leader");
    expect(unlockStage({ ...base, deputyOf: ["1"] })).toBe("leader");
    expect(unlockStage({ ...base, role: "candidate", firstSponsor: true })).toBe("candidate");
  });
});

describe("what each stage sees", () => {
  it("a new apprentice gets the basics and a hint about first sponsor", () => {
    const x = u({});
    for (const a of ["home", "customers", "learning", "events", "wallet", "profile"] as const)
      expect(x.can[a]).toBe(true);
    for (const a of [
      "team",
      "people",
      "pipeline",
      "reports",
      "eventPlanning",
      "teamSettings",
    ] as const)
      expect(x.can[a]).toBe(false);
    expect(x.can.inbox).toBe(false);
    expect(x.next?.milestone).toBe("first_sponsor");
  });

  it("first sponsor opens the team, people, pipeline and reports, not event planning", () => {
    const x = u({ firstSponsor: true });
    expect([x.can.team, x.can.people, x.can.pipeline, x.can.reports]).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(x.can.eventPlanning).toBe(false);
    expect(x.can.inbox).toBe(true); // stat requests
    expect(x.next?.milestone).toBe("3_10");
  });

  it("3/10 opens event planning; nothing left to unlock", () => {
    const x = u({ role: "ibo", firstSponsor: true, threeTen: true });
    expect(x.can.eventPlanning).toBe(true);
    expect(x.can.teamSettings).toBe(false);
    expect(x.next).toBeNull();
  });

  it("leaders and deputies get everything and team settings", () => {
    for (const x of [u({ role: "leader" }), u({ role: "ibo", deputyOf: ["1"] })]) {
      expect(x.can.eventPlanning && x.can.teamSettings && x.can.pipeline).toBe(true);
      expect(x.next).toBeNull();
    }
    expect(u({ deputyOf: ["1"] }).deputy).toBe(true);
  });

  it("candidates keep their limited view", () => {
    const x = u({ role: "candidate", canChat: false });
    expect(x.can.customers || x.can.pipeline || x.can.eventPlanning || x.can.campaigns).toBe(false);
    expect(x.can.team && x.can.people && x.can.events && x.can.wallet).toBe(true);
    expect(x.next).toBeNull();
  });
});

describe("feature switches", () => {
  it("chats, library and campaigns are off unless switched on; wallet stays on", () => {
    const off = u({ role: "leader" });
    expect([off.can.chats, off.can.library, off.can.campaigns]).toEqual([false, false, false]);
    expect(off.can.wallet).toBe(true);
    const on = u({ role: "leader", switches: { chats: true, library: true, campaigns: true } });
    expect([on.can.chats, on.can.library, on.can.campaigns]).toEqual([true, true, true]);
  });

  it("chats still need chat eligibility; campaigns never reach candidates", () => {
    const x = u({ role: "candidate", canChat: false, switches: { chats: true, campaigns: true } });
    expect(x.can.chats).toBe(false);
    expect(x.can.inbox).toBe(true);
    expect(x.can.campaigns).toBe(false);
  });

  it("the admin sees every feature and every area regardless of switches", () => {
    const x = u({ admin: true });
    expect(x.feature).toEqual({ chats: true, library: true, campaigns: true });
    expect(Object.values(x.can).every(Boolean)).toBe(true);
  });
});

describe("routeAccess", () => {
  it("locks team pages for a new apprentice with a first-sponsor reason", () => {
    const x = u({});
    for (const p of ["/mindmap", "/people", "/pipeline", "/reports", "/people/4"]) {
      const r = routeAccess(p, x, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toEqual({ kind: "milestone", milestone: "first_sponsor" });
    }
    for (const p of [
      "/",
      "/customers",
      "/events",
      "/events/e1",
      "/wallet",
      "/learning",
      "/settings",
    ])
      expect(open(p, x)).toBe(true);
  });

  it("always opens your own profile and your own customers", () => {
    const x = u({});
    expect(open("/people/700", x)).toBe(true);
    expect(open("/people/c11/", x)).toBe(true);
    expect(open("/people/c5", x)).toBe(false);
  });

  it("switched-off features and team settings explain themselves", () => {
    const x = u({ role: "ibo", firstSponsor: true, threeTen: true });
    const chats = routeAccess("/chats/main", x, ctx);
    expect(chats.ok ? null : chats.reason).toEqual({ kind: "feature", feature: "chats" });
    const lib = routeAccess("/library/talks", x, ctx);
    expect(lib.ok ? null : lib.reason).toEqual({ kind: "feature", feature: "library" });
    const team = routeAccess("/settings/team", x, ctx);
    expect(team.ok ? null : team.reason).toEqual({ kind: "leaders" });
    expect(open("/settings", x)).toBe(true);
  });

  it("candidates can't open customers, the pipeline, campaigns or (switched-on) chats", () => {
    const x = u({ role: "candidate", canChat: false, switches: { chats: true } });
    for (const p of ["/customers", "/pipeline", "/campaigns", "/chats"]) {
      const r = routeAccess(p, x, ctx);
      expect(r.ok ? null : r.reason).toEqual({ kind: "candidate" });
    }
  });

  it("the admin opens everything", () => {
    const x = u({ admin: true });
    for (const p of ["/chats", "/library", "/campaigns", "/inbox", "/settings/team", "/people/4"])
      expect(open(p, x)).toBe(true);
  });
});

describe("unlocks go by milestones ever reached, not held now", () => {
  // Ana registered 2025-01-01 and reached 3/10 when her 10th person registered;
  // one of them has since left, so she's at 9 people.
  const ibo = (id: string, sponsorId: string | null, start: string): CrmPerson => ({
    id,
    name: id,
    bizClass: "ibo",
    sponsorId,
    businessStartDate: start,
  });
  const team = [
    ibo("ana", null, "2025-01-01"),
    ibo("f1", "ana", "2025-02-01"),
    ibo("f2", "ana", "2025-02-01"),
    ibo("f3", "ana", "2025-02-01"),
    ...Array.from({ length: 7 }, (_, i) => ibo(`d${i}`, "f1", "2025-04-01")),
  ];
  const today = "2026-10-13";
  const recorded = historyUpdates(
    { people: team, sales: [], overrides: [], marks: [] },
    ["ana"],
    "2026-06-01",
  ).map((r) => ({ ...r, recordedAt: "2026-06-01T10:00:00.000Z" }));
  const now = {
    people: team.filter((p) => p.id !== "d6"),
    sales: [],
    overrides: [],
    marks: [],
    history: recorded,
  };
  const unlocks = () =>
    u({
      role: "ibo",
      firstSponsor: hasEverReachedMilestone(now, "ana", "first_sponsor", today),
      threeTen: hasEverReachedMilestone(now, "ana", "3_10", today),
    });

  it("dropping below 3/10 un-holds it on the path but keeps event planning", () => {
    expect(isMilestoneHeld(now, "ana", "3_10", today)).toBe(false);
    expect(unlocks().stage).toBe("builder");
    expect(unlocks().can.eventPlanning).toBe(true);
  });
});

describe("event planning goes through canManageEvents", () => {
  it("uses the unlock when given", () => {
    expect(canManageEvents({ role: "apprentice", eventPlanning: false })).toBe(false);
    expect(canManageEvents({ role: "ibo", eventPlanning: true })).toBe(true);
    expect(canManageEvents({ role: "candidate", eventPlanning: true })).toBe(false);
  });
});

describe("the demo cast", () => {
  const input = {
    people: seedPeople(),
    sales: seedSales(),
    overrides: seedPvOverrides(),
    marks: seedMilestoneMarks(),
  };
  const deputies = seedDeputies();
  const stageOf = (personId: string) => {
    const user = DEMO_USERS.find((d) => d.personId === personId)!;
    const ever = (c: GrowthMilestoneCode) =>
      hasEverReachedMilestone(input, personId, c, localDate());
    return computeUnlocks({
      role: user.role,
      admin: user.admin,
      deputyOf: deputyOfIds(deputies, personId),
      firstSponsor: ever("first_sponsor"),
      threeTen: ever("3_10"),
      switches: {},
      canChat: user.role !== "candidate",
    });
  };

  it("covers every stage: Tasha, Jamal, Anita, Maria, Marcus (deputy), Beau, admin", () => {
    expect(stageOf("700").stage).toBe("new_apprentice");
    expect(stageOf("4").stage).toBe("first_sponsor");
    expect(stageOf("2").stage).toBe("builder");
    expect(stageOf("1").stage).toBe("leader");
    expect(stageOf("6").deputy).toBe(true);
    expect(stageOf("6").can.eventPlanning).toBe(true);
    expect(stageOf("20").stage).toBe("candidate");
    const admin = stageOf("800");
    expect(admin.admin && admin.can.chats && admin.can.library && admin.can.campaigns).toBe(true);
  });
});
