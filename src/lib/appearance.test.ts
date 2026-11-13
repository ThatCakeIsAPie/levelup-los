import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppearance, getAppearance, imageUrl, initAppearance } from "./appearance";

/** A just-enough document: the root's dataset and style, and a head that keeps its <link> children. */
function fakeDocument() {
  const vars = new Map<string, string>();
  const links: Array<Record<string, unknown>> = [];
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (k: string, v: string) => void vars.set(k, v),
      removeProperty: (k: string) => void vars.delete(k),
    },
  };
  const head = {
    querySelectorAll: () =>
      links.map((l) => ({
        remove: () => void links.splice(links.indexOf(l), 1),
      })),
    appendChild: (l: Record<string, unknown>) => void links.push(l),
  };
  const doc = {
    documentElement: root,
    head,
    createElement: () => ({ setAttribute: () => undefined }) as Record<string, unknown>,
  };
  return { doc, root, vars, links };
}

describe("imageUrl", () => {
  it("puts a file name under the site's base path", () => {
    expect(imageUrl("stained-glass.webp")).toBe(import.meta.env.BASE_URL + "stained-glass.webp");
    expect(imageUrl("./a/b.webp")).toBe(import.meta.env.BASE_URL + "a/b.webp");
  });
  it("leaves full and root-relative URLs alone", () => {
    expect(imageUrl("https://example.com/x.webp")).toBe("https://example.com/x.webp");
    expect(imageUrl("blob:abc")).toBe("blob:abc");
    expect(imageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(imageUrl("/x.webp")).toBe("/x.webp");
  });
});

describe("applyAppearance", () => {
  let env: ReturnType<typeof fakeDocument>;
  beforeEach(() => {
    env = fakeDocument();
    vi.stubGlobal("document", env.doc);
    applyAppearance({ glass: false, backgroundImage: null, backgroundImagePortrait: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sets the root switch and the picture variables, and preloads the right variants", () => {
    applyAppearance({ glass: true, backgroundImage: "a.webp", backgroundImagePortrait: "b.webp" });
    expect(env.root.dataset.glass).toBe("on");
    expect(env.root.dataset.backdrop).toBe("on");
    expect(env.vars.get("--backdrop-image")).toContain("a.webp");
    expect(env.vars.get("--backdrop-image-portrait")).toContain("b.webp");
    expect(env.links.map((l) => l.href)).toEqual([imageUrl("a.webp"), imageUrl("b.webp")]);
    expect(env.links[0].media).toMatch(/^not all and /);
    expect(env.links[1].media).toMatch(/max-width: 760px/);
  });

  it("reuses the landscape picture for portrait when there is no portrait file", () => {
    applyAppearance({ backgroundImage: "a.webp", backgroundImagePortrait: null });
    expect(env.vars.get("--backdrop-image-portrait")).toBe(env.vars.get("--backdrop-image"));
    expect(env.links).toHaveLength(1);
  });

  it("changes only what is passed", () => {
    applyAppearance({ glass: true, backgroundImage: "a.webp" });
    applyAppearance({ glass: false });
    expect(env.root.dataset.glass).toBe("off");
    expect(env.root.dataset.backdrop).toBe("on");
    expect(getAppearance().backgroundImage).toBe("a.webp");
  });

  it("removes the picture, its variables and its preload hints", () => {
    applyAppearance({ backgroundImage: "a.webp", backgroundImagePortrait: "b.webp" });
    applyAppearance({ backgroundImage: null, backgroundImagePortrait: null });
    expect(env.root.dataset.backdrop).toBe("off");
    expect(env.vars.size).toBe(0);
    expect(env.links).toHaveLength(0);
  });

  it("initAppearance applies what is already set", () => {
    applyAppearance({ glass: true });
    env.root.dataset.glass = "off";
    initAppearance();
    expect(env.root.dataset.glass).toBe("on");
  });
});
