import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmPerson } from "@/data";
import type { Filters } from "./model";

const saved: { name: string; csv: string }[] = [];
vi.mock("@/lib/csvExport", async (orig) => ({
  ...(await orig<typeof import("@/lib/csvExport")>()),
  downloadCsv: (name: string, csv: string) => void saved.push({ name, csv }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

import { exportRowsCsv } from "./exportCsv";
import {
  DEFAULT_FILTERS,
  filterRows,
  tagPlan,
  tagsInUse,
  tagSuggestions,
  tagsOf,
  type PersonRow,
} from "./model";

// Maria (the viewer) carries two tags the viewer must never see on herself; Anita carries one of the same.
const P = (id: string, extra: Partial<CrmPerson> = {}) =>
  ({ id, name: id, bizClass: "ibo", ...extra }) as CrmPerson;
const row = (p: CrmPerson, extra: Partial<PersonRow> = {}): PersonRow =>
  ({
    person: p,
    stage: p.bizClass,
    type: null,
    referralSource: false,
    isSelf: false,
    attention: new Set(),
    contact: {},
    showRate: { attended: 0, eligible: 0, pct: 0 },
    missing: [],
    ...extra,
  }) as unknown as PersonRow;

const maria = P("maria", { tags: ["Needs encouragement", "Referral source"], location: "Austin" });
const anita = P("anita", { tags: ["Needs encouragement"] });
const mine = row(maria, { isSelf: true, referralSource: true }); // even if a row said so
const hers = row(anita);
const rows = [mine, hers];
const f = (q: string): Filters => ({ ...DEFAULT_FILTERS, q });

describe("People list: nobody sees their own tags", () => {
  it("your own row has no tags and no derived Referral source", () => {
    expect(tagsOf(mine)).toEqual([]);
    expect(tagsOf(hers)).toEqual(["Needs encouragement"]);
    expect(tagsOf(row(P("x"), { isSelf: true, referralSource: true }))).toEqual([]);
    expect(tagsOf(row(P("y"), { referralSource: true }))).toEqual(["Referral source"]);
  });

  it("search by a tag never matches your own row, and still matches others", () => {
    const found = (q: string) => filterRows(rows, "business", f(q)).map((r) => r.person.id);
    expect(found("needs")).toEqual(["anita"]);
    expect(found("referral source")).toEqual([]);
    expect(found("austin")).toEqual(["maria"]); // your own location is not a tag
  });

  it("bulk tagging skips you, in the existing skipped-rows wording", () => {
    const plan = tagPlan(rows, "Gym");
    expect(plan.apply.map((r) => r.person.id)).toEqual(["anita"]);
    expect(plan.skipped.map((s) => [s.row.person.id, s.reason])).toEqual([["maria", "that's you"]]);
  });

  it("the bulk tag suggestions never offer a tag only you carry", () => {
    const team = [P("maria", { tags: ["Mentor"] }), P("anita", { tags: ["Fall weekend"] })];
    expect(tagsInUse(team, "maria")).toEqual(["Fall weekend"]);
    expect(tagsInUse(team, "anita")).toEqual(["Mentor"]);
    expect(tagSuggestions(team, "maria")).toEqual(["Referral source", "Fall weekend"]);
  });

  it("the CSV leaves your own Tags cell empty and writes no derived Referral source", () => {
    saved.length = 0;
    exportRowsCsv(rows, "people");
    const [head, ...lines] = saved[0].csv.trim().split(/\r?\n/);
    const col = head.split(",").indexOf("Tags");
    expect(lines.map((l) => l.split(",")[col].replaceAll('"', ""))).toEqual([
      "",
      "Needs encouragement",
    ]);
  });
});

beforeEach(() => void (saved.length = 0));
