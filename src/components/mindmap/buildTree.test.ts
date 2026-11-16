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

  it("stamps the legs (people directly under) and the whole downline on every node", () => {
    const [root] = normalizeForest(
      buildForest([
        person("a", null),
        person("b", "a"),
        person("c", "a"),
        person("d", "b"),
        person("e", "d"),
      ]),
    );
    const at = (name: string, n = root): typeof root | undefined =>
      n.person.name === `P${name}` ? n : n.children.map((c) => at(name, c)).find(Boolean);
    const pair = (name: string) => {
      const p = at(name)!.person;
      return `${p.legCount}/${(p.memberCount ?? 1) - 1}`;
    };
    expect(pair("a")).toBe("2/4");
    expect(pair("b")).toBe("1/2");
    expect(pair("d")).toBe("1/1");
    expect(pair("c")).toBe("0/0");
    expect(pair("e")).toBe("0/0");
  });
});
