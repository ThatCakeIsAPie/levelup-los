import { beforeEach, describe, expect, it, vi } from "vitest";

// The map remembers its switches in localStorage; there is none in this environment.
const mem = vi.hoisted(() => new Map<string, string>());
vi.hoisted(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    },
  });
});

import { includedLabel, readTypeSwitches, typeSwitchKey, writeTypeSwitch } from "./typeSwitches";

describe("the map's three switches", () => {
  beforeEach(() => mem.clear());

  it("start off for someone who never touched the map", () => {
    expect(readTypeSwitches("me")).toEqual({ contact: false, prospect: false, filtered: false });
  });

  it("the old 'Include prospects' value becomes Prospects; Contacts and Filtered start off", () => {
    // What the single switch stored: "1" under <prefix>.mindmap.prospects.<person>.
    mem.set(typeSwitchKey("me", "prospect"), "1");
    expect(typeSwitchKey("me", "prospect")).toMatch(/\.mindmap\.prospects\.me$/);
    expect(readTypeSwitches("me")).toEqual({ contact: false, prospect: true, filtered: false });
    // Nobody else on this device inherits it.
    expect(readTypeSwitches("someone")).toEqual({
      contact: false,
      prospect: false,
      filtered: false,
    });
  });

  it("an old 'off' (nothing stored) stays off", () => {
    expect(readTypeSwitches("me").prospect).toBe(false);
  });

  it("each switch is remembered on its own, per viewer", () => {
    writeTypeSwitch("me", "contact", true);
    writeTypeSwitch("me", "filtered", true);
    expect(readTypeSwitches("me")).toEqual({ contact: true, prospect: false, filtered: true });
    writeTypeSwitch("me", "contact", false);
    expect(readTypeSwitches("me")).toEqual({ contact: false, prospect: false, filtered: true });
    expect(readTypeSwitches("you")).toEqual({ contact: false, prospect: false, filtered: false });
    const keys = (["contact", "prospect", "filtered"] as const).map((t) => typeSwitchKey("me", t));
    expect(new Set(keys).size).toBe(3);
  });

  it("names what is included, nothing when all are off", () => {
    const l = (contact: boolean, prospect: boolean, filtered: boolean) =>
      includedLabel({ contact, prospect, filtered });
    expect(l(false, false, false)).toBe("");
    expect(l(false, true, false)).toBe("prospects");
    expect(l(true, false, false)).toBe("contacts");
    expect(l(false, false, true)).toBe("filtered people");
    expect(l(true, true, false)).toBe("contacts and prospects");
    expect(l(true, false, true)).toBe("contacts and filtered people");
    expect(l(true, true, true)).toBe("contacts, prospects and filtered people");
  });
});
