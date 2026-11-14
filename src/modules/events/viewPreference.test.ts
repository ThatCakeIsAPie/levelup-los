import { describe, expect, it } from "vitest";
import { brand } from "@/brand/brand";
import {
  parseView,
  readStoredView,
  resolveView,
  storeView,
  type ViewStorage,
} from "./viewPreference";

const memory = (): ViewStorage & { data: Record<string, string> } => {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => void (data[k] = v),
  };
};

describe("the events page's view", () => {
  it("only accepts the two views from a link or from storage", () => {
    expect(parseView("calendar")).toBe("calendar");
    expect(parseView("list")).toBe("list");
    for (const bad of ["", "Calendar", "week", "month", null, undefined, 3, {}])
      expect(parseView(bad)).toBeUndefined();
  });

  it("starts on the calendar at desktop width and the list below it", () => {
    expect(resolveView({ url: undefined, stored: undefined, desktop: true })).toBe("calendar");
    expect(resolveView({ url: undefined, stored: undefined, desktop: false })).toBe("list");
  });

  it("remembers the last choice, under the brand's storage prefix", () => {
    const s = memory();
    expect(readStoredView(s)).toBeUndefined();
    storeView("list", s);
    expect(Object.keys(s.data)).toEqual([`${brand.storagePrefix}.events-view`]);
    expect(readStoredView(s)).toBe("list");
    expect(resolveView({ url: undefined, stored: readStoredView(s), desktop: true })).toBe("list");
    storeView("calendar", s);
    expect(resolveView({ url: undefined, stored: readStoredView(s), desktop: false })).toBe(
      "calendar",
    );
  });

  it("lets the link override the remembered choice, and ignores a junk stored value", () => {
    expect(resolveView({ url: "list", stored: "calendar", desktop: true })).toBe("list");
    expect(resolveView({ url: "calendar", stored: "list", desktop: false })).toBe("calendar");
    const s = memory();
    s.data[`${brand.storagePrefix}.events-view`] = "weekly";
    expect(readStoredView(s)).toBeUndefined();
  });

  it("survives a storage that refuses", () => {
    const refuses: ViewStorage = {
      getItem: () => {
        throw new Error("no");
      },
      setItem: () => {
        throw new Error("no");
      },
    };
    expect(readStoredView(refuses)).toBeUndefined();
    expect(() => storeView("list", refuses)).not.toThrow();
    expect(readStoredView(undefined)).toBeUndefined();
  });
});
