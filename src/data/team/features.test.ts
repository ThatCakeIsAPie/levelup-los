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

  it("keeps every feature in the full list, in the key list and in the switch map (off)", () => {
    expect(FEATURE_KEYS).toEqual(FEATURES.map((f) => f.key));
    expect(FEATURE_KEYS).toContain("agents");
    expect(switchMap(seedFeatureSwitches()).agents).toBe(false);
  });

  it("is off in the unlocks until the team switches it on; an admin has it regardless", () => {
    const base = { role: "ibo" as const, firstSponsor: true, threeTen: false, canChat: true };
    expect(computeUnlocks({ ...base, switches: {} }).feature.agents).toBe(false);
    expect(computeUnlocks({ ...base, switches: { agents: true } }).feature.agents).toBe(true);
    expect(computeUnlocks({ ...base, admin: true, switches: {} }).feature.agents).toBe(true);
  });
});
