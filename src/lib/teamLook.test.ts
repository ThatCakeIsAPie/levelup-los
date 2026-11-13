import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brand } from "@/brand/brand";
import { defaultLook, type TeamLook } from "@/data/teamLook/types";
import { parseLook } from "@/data/teamLook/rules";
import { getAppearance } from "./appearance";
import {
  applyTeamLook,
  cssAlpha,
  cssToHex,
  getTeamLogoUrl,
  safeImageUrl,
  teamImageUrl,
  type ResolvedLook,
} from "./teamLook";

const HEX = "0123456789abcdef0123456789abcdef";
const CTX = { supabaseUrl: "https://abc.supabase.co", origin: "http://127.0.0.1:4901" };
const STORED = `https://abc.supabase.co/storage/v1/object/public/team-appearance/w1/bg-${HEX}.webp`;

describe("picture URLs", () => {
  it("builds a storage URL only from a validated path", () => {
    expect(teamImageUrl(`w1/bg-${HEX}.webp`, CTX)).toBe(STORED);
    expect(teamImageUrl(`w1/logo-${HEX}.png`, CTX)).toContain(
      "/object/public/team-appearance/w1/logo-",
    );
    expect(teamImageUrl(`w1/bg-${HEX}.webp") ; url(x`, CTX)).toBeNull();
    expect(teamImageUrl(`../w1/bg-${HEX}.webp`, CTX)).toBeNull();
    expect(
      teamImageUrl(`w1/bg-${HEX}.webp`, { ...CTX, supabaseUrl: "javascript:alert(1)" }),
    ).toBeNull();
    expect(teamImageUrl(`w1/bg-${HEX}.webp`, { ...CTX, supabaseUrl: "" })).toBeNull();
    expect(teamImageUrl(null, CTX)).toBeNull();
  });
  it("lets only a storage URL of this project or a blob of this page into CSS", () => {
    expect(safeImageUrl(STORED, CTX)).toBe(STORED);
    const blob = "blob:http://127.0.0.1:4901/3b241101-e2bb-4255-8caf-4136c566a962";
    expect(safeImageUrl(blob, CTX)).toBe(blob);
    for (const bad of [
      "blob:http://evil.example/3b241101-e2bb-4255-8caf-4136c566a962",
      "https://evil.example/storage/v1/object/public/team-appearance/w1/bg-" + HEX + ".webp",
      "https://abc.supabase.co/storage/v1/object/public/other-bucket/w1/bg-" + HEX + ".webp",
      STORED + '")',
      STORED + "?x=1",
      `${STORED}\n`,
      "data:image/svg+xml;base64,AAAA",
      "javascript:alert(1)",
      "url(x)",
      '"); background:url(//evil/x',
      "/relative.webp",
      "",
      null,
      5,
    ]) {
      expect(safeImageUrl(bad, CTX), String(bad)).toBeNull();
    }
  });
  it("reads colours and alphas out of computed token values", () => {
    expect(cssToHex("#ABC")).toBe("#aabbcc");
    expect(cssToHex(" #1b2230 ")).toBe("#1b2230");
    expect(cssToHex("#1b223080")).toBe("#1b2230");
    expect(cssToHex("rgb(27, 34, 48)")).toBe("#1b2230");
    expect(cssToHex("rgba(27 34 48 / 0.5)")).toBe("#1b2230");
    expect(cssToHex("red")).toBeNull();
    expect(cssAlpha("rgba(24, 30, 43, 0.66)")).toBe(0.66);
    expect(cssAlpha("rgba(24, 30, 43, 62%)")).toBe(0.62);
    expect(cssAlpha("#181e2b")).toBe(1);
    expect(cssAlpha("nope")).toBeNull();
  });
});

/** A just-enough document: the root's dataset, style and classes, a head, and the team stylesheet. */
function fakeDocument() {
  const vars = new Map<string, string>();
  const nodes: Array<Record<string, unknown>> = [];
  const classes = new Set<string>();
  const root = {
    dataset: {} as Record<string, string>,
    classList: {
      contains: (c: string) => classes.has(c),
      add: (c: string) => void classes.add(c),
      remove: (c: string) => void classes.delete(c),
      toggle: (c: string, on?: boolean) => (on ? classes.add(c) : classes.delete(c)),
    },
    style: {
      setProperty: (k: string, v: string) => void vars.set(k, v),
      removeProperty: (k: string) => void vars.delete(k),
    },
  };
  const head = {
    querySelectorAll: () =>
      nodes
        .filter((n) => n.rel)
        .map((l) => ({ remove: () => void nodes.splice(nodes.indexOf(l), 1) })),
    appendChild: (n: Record<string, unknown>) => void nodes.push(n),
  };
  const doc = {
    documentElement: root,
    head,
    getElementById: (id: string) => nodes.find((n) => n.id === id) ?? null,
    createElement: () => {
      const n: Record<string, unknown> = { setAttribute: () => undefined, disabled: false };
      n.remove = () => void nodes.splice(nodes.indexOf(n), 1);
      return n;
    },
  };
  return { doc, root, vars, nodes };
}

describe("applyTeamLook", () => {
  let env: ReturnType<typeof fakeDocument>;
  beforeEach(() => {
    env = fakeDocument();
    vi.stubGlobal("document", env.doc);
    vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
    applyTeamLook(null);
  });
  afterEach(() => vi.unstubAllGlobals());

  const resolved = (look: Partial<TeamLook>, over: Partial<ResolvedLook> = {}): ResolvedLook => ({
    look: { ...defaultLook(), ...look },
    backgroundUrl: null,
    logoUrl: null,
    ...over,
  });
  const style = () => env.nodes.find((n) => n.id === "team-look");

  it("leaves the brand alone for no look and for an all-default look", () => {
    applyTeamLook(null);
    applyTeamLook(resolved({}));
    expect(style()).toBeUndefined();
    expect(getAppearance()).toMatchObject({
      glass: brand.glass,
      backgroundImage: brand.backgroundImage,
      teamPicture: false,
    });
    expect(env.root.dataset.backdropSource).toBe("brand");
    expect(getTeamLogoUrl()).toBeNull();
  });

  it("writes derived colours into one stylesheet for :root and .dark", () => {
    applyTeamLook(resolved({ colors: { main: "#336699", highlight: null, sidebar: null } }));
    const css = String(style()?.textContent);
    expect(css).toMatch(/^:root\{--brand-teal:#[0-9a-f]{6};/);
    expect(css).toContain(".dark{");
    expect(css).not.toContain("--brand-sky");
    applyTeamLook(resolved({}));
    expect(style()).toBeUndefined();
  });

  it("shows a team picture with glass, and marks it as the team's own", () => {
    applyTeamLook(
      resolved(
        { background: "picture", backgroundPath: `w1/bg-${HEX}.webp`, glass: true },
        { backgroundUrl: "blob:http://x/3b241101-e2bb-4255-8caf-4136c566a962" },
      ),
    );
    // Not this page's origin: refused, so the brand's own background shows.
    expect(getAppearance().teamPicture).toBe(false);
    vi.stubGlobal("location", { origin: "http://x" });
    applyTeamLook(
      resolved(
        { background: "picture", backgroundPath: `w1/bg-${HEX}.webp`, glass: true },
        { backgroundUrl: "blob:http://x/3b241101-e2bb-4255-8caf-4136c566a962" },
      ),
    );
    expect(getAppearance()).toMatchObject({
      glass: true,
      teamPicture: true,
      backgroundImagePortrait: null,
    });
    expect(env.root.dataset).toMatchObject({ glass: "on", backdrop: "on", backdropSource: "team" });
  });

  it("turns glass off when the background is none", () => {
    applyTeamLook(resolved({ background: "none", glass: true }));
    expect(getAppearance()).toMatchObject({ glass: false, backgroundImage: null });
    expect(env.root.dataset).toMatchObject({ glass: "off", backdrop: "off" });
  });

  it("never lets a malicious stored value reach the DOM", () => {
    const hostile = parseLook(
      {
        background: "picture",
        backgroundPath: `w1/bg-${HEX}.webp")}body{background:url(//evil/x)`,
        logoPath: `w1/logo-${HEX}.png"); url(javascript:alert(1)`,
        colors: {
          main: "red;background:url(x)",
          highlight: "#fff;}</style><script>",
          sidebar: "url(x)",
        },
      },
      "w1",
    );
    applyTeamLook({
      look: hostile,
      backgroundUrl: 'https://evil.example/x.webp"); background:url(x',
      logoUrl: "javascript:alert(1)",
    });
    expect(style()).toBeUndefined();
    expect(getTeamLogoUrl()).toBeNull();
    expect([...env.vars.values()].join(" ")).not.toMatch(/evil|javascript|url\(x/);
    // Even a hostile URL handed in next to a valid-looking look is dropped.
    applyTeamLook({
      look: { ...defaultLook(), background: "picture", backgroundPath: `w1/bg-${HEX}.webp` },
      backgroundUrl: 'https://evil.example/x.webp")',
      logoUrl: null,
    });
    expect([...env.vars.values()].join(" ")).not.toContain("evil");
    expect(getAppearance().teamPicture).toBe(false);
  });
});
