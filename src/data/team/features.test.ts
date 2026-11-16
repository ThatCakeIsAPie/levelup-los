import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_KEYS, featuresFor } from "./types";
import { switchMap } from "./rules";
import { seedFeatureSwitches } from "./seed";
import { computeUnlocks } from "../unlocks";

const keys = (source: "local" | "supabase") => featuresFor(source).map((f) => f.key);

describe("the feature list per data source", () => {
  it("offers AI agents with the hosted data source only", () => {
    expect(keys("supabase")).toEqual(["chats", "library", "campaigns", "agents"]);
    expect(keys("local")).toEqual(["chats", "library", "campaigns"]);
  });

  it("labels it 'AI agents', with no phase chip or helper line", () => {
    const f = FEATURES.find((x) => x.key === "agents");
    expect(f).toMatchObject({ label: "AI agents", hosted: true });
    expect(f?.phase).toBeUndefined();
    expect(f?.description).toBeUndefined();
  });

  it("keeps every feature in the full list, in the key list and in the switch map (agents on)", () => {
    expect(FEATURE_KEYS).toEqual(FEATURES.map((f) => f.key));
    expect(FEATURE_KEYS).toContain("agents");
    expect(switchMap(seedFeatureSwitches()).agents).toBe(true);
    expect(FEATURES.find((x) => x.key === "agents")?.defaultOn).toBe(true);
  });

  it("is on in the unlocks until the team switches it off; an admin previews a stored off", () => {
    const base = { role: "ibo" as const, firstSponsor: true, threeTen: false, canChat: true };
    expect(computeUnlocks({ ...base, switches: {} }).feature.agents).toBe(true);
    expect(computeUnlocks({ ...base, switches: { agents: true } }).feature.agents).toBe(true);
    expect(computeUnlocks({ ...base, switches: { agents: false } }).feature.agents).toBe(false);
    expect(
      computeUnlocks({ ...base, admin: true, switches: { agents: false } }).feature.agents,
    ).toBe(true);
  });
});
