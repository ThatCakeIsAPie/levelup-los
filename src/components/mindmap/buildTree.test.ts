import { describe, expect, it } from "vitest";
import { buildForest, normalizeForest } from "./buildTree";
import type { Person } from "./types";

const person = (id: string, sponsorId: string | null, ppv?: number): Person => ({
  id,
  uid: id,
  name: `P${id}`,
  sponsorId,
  ppv,
  raw: {},
});

describe("normalizeForest", () => {
  it("keeps each person's PPV and adds it up into GPV", () => {
    const [root] = normalizeForest(
      buildForest([person("a", null, 25), person("b", "a", 150), person("c", "b")]),
    );
    expect(root.person.ppv).toBe(25);
    expect(root.person.gpv).toBe(175);
    expect(root.children[0].person.ppv).toBe(150);
    expect(root.children[0].children[0].person.ppv).toBe(0);
    expect(root.person.memberCount).toBe(3);
  });
});
