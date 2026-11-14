import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GROWTH_MILESTONES, growthPath, visibleMilestones, type GrowthPath } from "@/data";
import { localDate } from "@/lib/dates";
import { seedMilestoneMarks, seedPeople, seedPvOverrides, seedSales } from "@/data/seed";
import { PathRow } from "./GrowthPath";
import { homeStrip, pathKeyTarget, pathRowView } from "./pathView";

const input = {
  people: seedPeople(),
  sales: seedSales(),
  overrides: seedPvOverrides(),
  marks: seedMilestoneMarks(),
};
const path = (id: string): GrowthPath => growthPath(input, id, localDate());
const TASHA = "700"; // next: Core 150
const JAMAL = "4"; // next: Bronze foundation
const MARIA = "1"; // next 6/50, Platinum and Ruby held beyond it

const labelsOf = (list: { label: string }[]) => list.map((m) => m.label);
const hiddenLabels = (p: GrowthPath) => {
  const shown = new Set(visibleMilestones(p, { own: true }).map((m) => m.code));
  return GROWTH_MILESTONES.filter((m) => !shown.has(m.code)).map((m) => m.label);
};

describe("the profile row takes its milestones from visibleMilestones", () => {
  it("draws exactly the visible list on your own path, in a rendered row", () => {
    for (const id of [TASHA, JAMAL, MARIA]) {
      const p = path(id);
      const html = renderToStaticMarkup(
        createElement(PathRow, {
          path: p,
          selected: p.nextIndex,
          onSelect: () => {},
          own: true,
          panelId: "x",
        }),
      );
      const tabs = html.match(/role="tab"/g)?.length ?? 0;
      expect(tabs).toBe(visibleMilestones(p, { own: true }).length);
      for (const label of labelsOf(visibleMilestones(p, { own: true })))
        expect(html).toContain(label);
      for (const label of hiddenLabels(p)) expect(html).not.toContain(label);
    }
  });

  it("Tasha's own row names Core 150 as the last one and nothing later", () => {
    const p = path(TASHA);
    const html = renderToStaticMarkup(
      createElement(PathRow, {
        path: p,
        selected: p.nextIndex,
        onSelect: () => {},
        own: true,
        panelId: "x",
      }),
    );
    expect(html).toContain("Core 150");
    for (const later of [
      "Core 300",
      "First sponsor",
      "Bronze",
      "3/10",
      "Platinum",
      "Ruby",
      "12/100",
    ])
      expect(html).not.toContain(later);
  });

  it("draws the whole path for someone else's (the upline's view)", () => {
    const p = path(TASHA);
    const html = renderToStaticMarkup(
      createElement(PathRow, {
        path: p,
        selected: p.nextIndex,
        onSelect: () => {},
        own: false,
        panelId: "x",
      }),
    );
    expect(html.match(/role="tab"/g)?.length).toBe(GROWTH_MILESTONES.length);
    for (const m of GROWTH_MILESTONES) expect(html).toContain(m.label);
  });

  it("the progress line ends at the next milestone and the track at the last visible one", () => {
    const tasha = pathRowView(path(TASHA), { own: true, selected: 2 });
    expect(tasha.list).toHaveLength(3);
    expect(tasha.fillAt).toBe(2);
    const maria = path(MARIA);
    const v = pathRowView(maria, { own: true, selected: maria.nextIndex });
    expect(v.fillAt).toBe(v.list.findIndex((m) => m.index === maria.nextIndex));
    expect(v.fillAt).toBeLessThan(v.list.length - 1); // Platinum and Ruby are drawn after it
    expect(pathRowView(path(TASHA), { own: false, selected: 2 }).list).toHaveLength(13);
  });

  it("a selection that is not drawn falls back to the next milestone", () => {
    const p = path(TASHA);
    const hidden = GROWTH_MILESTONES.length - 1;
    expect(pathRowView(p, { own: true, selected: hidden }).status?.index).toBe(p.nextIndex);
    expect(pathRowView(p, { own: false, selected: hidden }).status?.index).toBe(hidden);
  });
});

describe("keys move over the visible milestones only", () => {
  it("never land on a hidden one, on any seed path", () => {
    for (const id of [TASHA, JAMAL, MARIA]) {
      const p = path(id);
      const list = visibleMilestones(p, { own: true });
      const ok = new Set(list.map((m) => m.index));
      for (const m of list) {
        for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
          expect(ok.has(pathKeyTarget(list, m.index, key)!)).toBe(true);
        }
      }
      expect(pathKeyTarget(list, list[0].index, "End")).toBe(list[list.length - 1].index);
      expect(pathKeyTarget(list, list[list.length - 1].index, "ArrowRight")).toBe(
        list[list.length - 1].index,
      );
      expect(pathKeyTarget(list, list[0].index, "Home")).toBe(list[0].index);
    }
  });

  it("steps over a gap in the visible list, and ignores other keys", () => {
    const p = path(MARIA);
    const list = visibleMilestones(p, { own: true });
    expect(list.length).toBeLessThan(GROWTH_MILESTONES.length);
    expect(pathKeyTarget(list, list[0].index, "ArrowRight")).toBe(list[1].index);
    expect(pathKeyTarget(list, list[0].index, "Tab")).toBeNull();
    expect(pathKeyTarget([], 0, "End")).toBeNull();
  });

  it("an upline's keys reach all thirteen", () => {
    const list = visibleMilestones(path(TASHA), { own: false });
    expect(pathKeyTarget(list, 0, "End")).toBe(12);
  });
});

describe("Home's strip takes its milestones from visibleMilestones", () => {
  it("only holds visible milestones: nothing hidden, ahead of the next only what is held", () => {
    for (const id of [TASHA, JAMAL, MARIA]) {
      const p = path(id);
      const strip = homeStrip(p);
      const visible = new Set(visibleMilestones(p, { own: true }).map((m) => m.code));
      for (const m of strip) expect(visible.has(m.code)).toBe(true);
      expect(strip.map((m) => m.index)).toContain(p.nextIndex);
      for (const m of strip.filter((x) => x.index > p.nextIndex))
        expect(m.held || m.state === "lost").toBe(true);
    }
  });

  it("Tasha: two behind, the next, none ahead; Jamal's next is not followed by a milestone", () => {
    expect(labelsOf(homeStrip(path(TASHA)))).toEqual(["New apprentice", "First sale", "Core 150"]);
    const jamal = homeStrip(path(JAMAL));
    expect(jamal[jamal.length - 1].index).toBe(path(JAMAL).nextIndex);
  });
});

describe("no renderer reads the full milestone list by itself", () => {
  const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
  it.each(["./GrowthPath.tsx", "./HomeCards.tsx", "./pathView.ts"])(
    "%s has no direct .milestones access",
    (f) => {
      expect(read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/\.milestones\b/);
    },
  );
  it("the profile card and Home call the one function", () => {
    expect(read("./GrowthPath.tsx")).toContain("visibleMilestones(");
    expect(read("./pathView.ts")).toContain("visibleMilestones(");
    expect(read("./HomeCards.tsx")).toContain("homeStrip(");
  });
});
