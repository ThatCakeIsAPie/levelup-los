import { describe, expect, it } from "vitest";
import { NAV_SECTIONS, activeCategory, appPath, itemActive, type NavItem } from "./nav";

const item = (label: string): NavItem => {
  const found = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.label === label);
  if (!found) throw new Error(label);
  return found;
};
const at = (pathname: string, tab?: string) => ({ pathname, tab, me: "1" });

describe("itemActive", () => {
  it("your own profile is My path, everyone else's is People", () => {
    expect(itemActive(item("My path"), at("/people/1"))).toBe(true);
    expect(itemActive(item("People"), at("/people/1"))).toBe(false);
    expect(itemActive(item("People"), at("/people/4"))).toBe(true);
    expect(itemActive(item("People"), at("/people"))).toBe(true);
    expect(itemActive(item("My path"), at("/people/12"))).toBe(false);
  });

  it("the Customers items follow the page's tab", () => {
    expect(itemActive(item("Customer pipeline"), at("/customers"))).toBe(true);
    expect(itemActive(item("Customer pipeline"), at("/customers", "list"))).toBe(false);
    expect(itemActive(item("Your list"), at("/customers", "list"))).toBe(true);
    expect(itemActive(item("Customers"), at("/customers", "customers"))).toBe(true);
    // An unknown tab is the pipeline, as on the page.
    expect(itemActive(item("Customer pipeline"), at("/customers", "nope"))).toBe(true);
  });

  it("Home is exact; other items cover their sub-pages", () => {
    expect(itemActive(item("Home"), at("/"))).toBe(true);
    expect(itemActive(item("Home"), at("/events"))).toBe(false);
    expect(itemActive(item("Events"), at("/events/42"))).toBe(true);
    expect(itemActive(item("Library"), at("/library/item/7"))).toBe(true);
  });
});

describe("activeCategory", () => {
  it("maps pages to the four sides of the business", () => {
    expect(activeCategory(at("/learning"))).toBe("growth");
    expect(activeCategory(at("/people/1"))).toBe("growth");
    expect(activeCategory(at("/customers", "list"))).toBe("customers");
    expect(activeCategory(at("/pipeline"))).toBe("team");
    expect(activeCategory(at("/mindmap"))).toBe("team");
    expect(activeCategory(at("/people/4"))).toBe("team");
    expect(activeCategory(at("/wallet"))).toBe("events");
    expect(activeCategory(at("/events/42"))).toBe("events");
  });

  it("Home, Chats, the Inbox and More's pages are in none", () => {
    for (const p of ["/", "/chats", "/inbox", "/reports", "/settings/team", "/campaigns"])
      expect(activeCategory(at(p))).toBeNull();
  });
});

describe("appPath", () => {
  it("strips the deploy base", () => {
    expect(appPath("/levelup-los/pipeline", "/levelup-los/")).toBe("/pipeline");
    expect(appPath("/pipeline", "/")).toBe("/pipeline");
    expect(appPath("/levelup-los-x/a", "/levelup-los/")).toBe("/levelup-los-x/a");
  });
});
