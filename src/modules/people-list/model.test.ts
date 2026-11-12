import { describe, expect, it } from "vitest";
import type { BizClass, CrmPerson } from "@/data";
import { listParam, parseListParam, toggleInList } from "@/lib/searchList";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  attentionCounts,
  baseFilter,
  cleanTag,
  deletePlan,
  filterRows,
  filtersFromSearch,
  searchFromFilters,
  selectedShown,
  shownSelection,
  skippedNote,
  sponsorChangePlan,
  sponsorChoices,
  stageChangePlan,
  stageCounts,
  stagePatch,
  tagPlan,
  tagsInUse,
  toggleAllShown,
  toggleAttention,
  toggleSelected,
  uplineIdsOf,
  validatePeopleSearch,
  type AttentionReason,
  type Filters,
  type PersonRow,
} from "./model";

// A small team: Maria (viewer, leader) > Anita (IBO) > Jamal (apprentice) > Carlos (prospect)
// Maria > Lena (apprentice), Maria > Pat (prospect), Maria owns customer Cy.
const P = (id: string, bizClass: BizClass, up: string | null, extra: Partial<CrmPerson> = {}) =>
  ({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    bizClass,
    ...(bizClass === "customer" ? { ownerId: up } : { sponsorId: up }),
    ...extra,
  }) as CrmPerson;

const people: CrmPerson[] = [
  P("maria", "ibo", null, { location: "Austin, TX" }),
  P("anita", "ibo", "maria", { location: "Austin, TX", tags: ["Leader"] }),
  P("jamal", "apprentice", "anita", { location: "Dallas, TX", businessStartDate: "2026-05-01" }),
  P("carlos", "prospect", "jamal", { tags: ["leader", "Fall weekend"] }),
  P("lena", "apprentice", "maria", { location: "Dallas, TX" }),
  P("pat", "prospect", "maria"),
  P("cy", "customer", "maria"),
];

const row = (p: CrmPerson, attention: AttentionReason[] = []): PersonRow =>
  ({
    person: p,
    stage: p.bizClass,
    isSelf: p.id === "maria",
    attention: new Set(attention),
    contact: { days: null, tone: "bad", overdue: true, limit: 14 },
    showRate: { attended: 0, eligible: 0, pct: 0 },
    followUpOverdue: false,
    alert: null,
    missing: [],
  }) as unknown as PersonRow;

const ATTN: Record<string, AttentionReason[]> = {
  jamal: ["contact"],
  carlos: ["missing"],
  lena: ["contact", "followup"],
};
const rows = people.map((p) => row(p, ATTN[p.id]));
const byId = (id: string) => rows.find((r) => r.person.id === id)!;
const ids = (rs: PersonRow[]) => rs.map((r) => r.person.id).sort();
const f = (patch: Partial<Filters>): Filters => ({ ...DEFAULT_FILTERS, ...patch });

describe("list search params", () => {
  it("reads and writes comma lists, keeping only known values in order", () => {
    expect(parseListParam("ibo,apprentice,nope", ["prospect", "apprentice", "ibo"])).toEqual([
      "apprentice",
      "ibo",
    ]);
    expect(parseListParam(["ibo", "ibo"], ["apprentice", "ibo"])).toEqual(["ibo"]);
    expect(parseListParam("", ["ibo"])).toBeUndefined();
    expect(parseListParam(undefined, ["ibo"])).toBeUndefined();
    expect(listParam([])).toBeUndefined();
    expect(listParam(["apprentice", "ibo"])).toBe("apprentice,ibo");
    expect(toggleInList(["ibo"], "apprentice", ["prospect", "apprentice", "ibo"])).toEqual([
      "apprentice",
      "ibo",
    ]);
    expect(toggleInList(["apprentice", "ibo"], "ibo", ["apprentice", "ibo"])).toEqual([
      "apprentice",
    ]);
  });

  it("validates /people search and round-trips filters", () => {
    const s = validatePeopleSearch({
      stage: "ibo,apprentice,customer",
      attn: "followup,contact",
      loc: ["Austin, TX", "Austin, TX"],
      sort: "bogus",
      seg: "weird",
    });
    expect(s).toEqual({
      seg: undefined,
      q: undefined,
      stage: "apprentice,ibo",
      attn: "contact,followup",
      loc: ["Austin, TX"],
      sort: undefined,
    });
    const { segment, filters } = filtersFromSearch(s);
    expect(segment).toBe("business");
    expect(filters).toEqual({
      q: "",
      stages: ["apprentice", "ibo"],
      attention: ["contact", "followup"],
      locations: ["Austin, TX"],
      sort: "name",
    });
    expect(searchFromFilters(segment, filters)).toEqual({
      seg: undefined,
      q: undefined,
      stage: "apprentice,ibo",
      attn: "contact,followup",
      loc: ["Austin, TX"],
      sort: undefined,
    });
    // A plain list stays a plain URL.
    expect(Object.values(searchFromFilters("business", DEFAULT_FILTERS)).filter(Boolean)).toEqual(
      [],
    );
  });

  it("drops stages on customers and a sort the segment doesn't have", () => {
    const { segment, filters } = filtersFromSearch({
      seg: "customers",
      stage: "ibo",
      sort: "showRate",
    });
    expect(segment).toBe("customers");
    expect(filters.stages).toEqual([]);
    expect(filters.sort).toBe("name");
  });

  it("'any reason' wins over specific reasons", () => {
    expect(filtersFromSearch({ attn: "any,contact" }).filters.attention).toEqual(["any"]);
  });
});

describe("filters", () => {
  it("shows several stages together; none = everyone", () => {
    expect(ids(filterRows(rows, "business", f({ stages: ["apprentice", "ibo"] })))).toEqual([
      "anita",
      "jamal",
      "lena",
      "maria",
    ]);
    expect(filterRows(rows, "business", f({}))).toHaveLength(6);
    expect(ids(filterRows(rows, "customers", f({ stages: ["ibo"] })))).toEqual(["cy"]);
  });

  it("matches any of several attention reasons, or any reason", () => {
    expect(ids(filterRows(rows, "business", f({ attention: ["missing", "followup"] })))).toEqual([
      "carlos",
      "lena",
    ]);
    expect(ids(filterRows(rows, "business", f({ attention: ["any"] })))).toEqual([
      "carlos",
      "jamal",
      "lena",
    ]);
  });

  it("shows several locations together", () => {
    expect(
      ids(filterRows(rows, "business", f({ locations: ["Dallas, TX", "Austin, TX"] }))),
    ).toEqual(["anita", "jamal", "lena", "maria"]);
  });

  it("combines filters (stage AND attention AND location)", () => {
    expect(
      ids(
        filterRows(
          rows,
          "business",
          f({ stages: ["apprentice"], attention: ["contact"], locations: ["Dallas, TX"] }),
        ),
      ),
    ).toEqual(["jamal", "lena"]);
  });

  it("counts chips from every other filter", () => {
    const base = baseFilter(rows, "business", f({ attention: ["contact"] }));
    expect(stageCounts(base)).toEqual({ all: 2, prospect: 0, apprentice: 2, ibo: 0 });
    const c = attentionCounts(rows, "business", f({ stages: ["prospect", "apprentice"] }));
    expect(c.any).toBe(3);
    expect(c.contact).toBe(2);
    expect(c.missing).toBe(1);
  });

  it("toggles attention reasons", () => {
    expect(toggleAttention([], "any")).toEqual(["any"]);
    expect(toggleAttention(["any"], "any")).toEqual([]);
    expect(toggleAttention(["any"], "missing")).toEqual(["missing"]);
    expect(toggleAttention(["missing"], "contact")).toEqual(["contact", "missing"]);
    expect(toggleAttention(["contact", "missing"], "contact")).toEqual(["missing"]);
  });

  it("counts active filters once per group", () => {
    expect(
      activeFilterCount(
        f({ stages: ["ibo", "apprentice"], attention: ["contact"], locations: ["A", "B"] }),
        "business",
      ),
    ).toBe(3);
    expect(activeFilterCount(f({ stages: ["ibo"] }), "customers")).toBe(0);
  });
});

describe("selection", () => {
  const shown = filterRows(rows, "business", f({ stages: ["apprentice", "ibo"] }));

  it("never selects yourself with select all, and only touches what's shown", () => {
    const sel = toggleAllShown(new Set(["pat"]), shown);
    expect([...sel].sort()).toEqual(["anita", "jamal", "lena", "pat"]);
    expect(shownSelection(sel, shown)).toBe("all");
    expect(ids(selectedShown(sel, shown))).toEqual(["anita", "jamal", "lena"]);
    // Again clears the shown ones, keeps the hidden one.
    expect([...toggleAllShown(sel, shown)]).toEqual(["pat"]);
  });

  it("reports some / none", () => {
    expect(shownSelection(new Set(), shown)).toBe("none");
    expect(shownSelection(toggleSelected(new Set(), "jamal"), shown)).toBe("some");
    expect(toggleSelected(new Set(["jamal"]), "jamal").size).toBe(0);
  });
});

describe("bulk actions", () => {
  it("change stage skips yourself, customers, the same stage and prospects-to-be with a team", () => {
    const p = stageChangePlan(
      ["maria", "anita", "jamal", "carlos", "lena", "cy"].map(byId),
      "prospect",
      people,
    );
    expect(ids(p.apply)).toEqual(["lena"]);
    const reasons = Object.fromEntries(p.skipped.map((s) => [s.row.person.id, s.reason]));
    expect(reasons).toEqual({
      maria: "that's you",
      anita: "has people under them",
      jamal: "has people under them",
      carlos: "already a prospect",
      cy: "a customer",
    });
    expect(skippedNote(p)).toBe(
      "5 skipped (that's you, has people under them, already a prospect, a customer)",
    );
    expect(ids(stageChangePlan([byId("lena"), byId("anita")], "ibo", people).apply)).toEqual([
      "lena",
    ]);
  });

  it("a new apprentice starts today unless a start date is set", () => {
    expect(stagePatch(byId("carlos").person, "apprentice", "2026-10-16")).toEqual({
      bizClass: "apprentice",
      pipelineStage: "apprentice",
      businessStartDate: "2026-10-16",
    });
    expect(stagePatch(byId("jamal").person, "ibo", "2026-10-16")).toEqual({
      bizClass: "ibo",
      pipelineStage: "ibo",
    });
  });

  it("sponsor choices leave out the selected people and their downlines", () => {
    // Anita's downline is Jamal and Carlos; prospects and customers never sponsor.
    expect(sponsorChoices(people, ["anita"]).map((p) => p.id)).toEqual(["lena", "maria"]);
    expect(sponsorChoices(people, ["jamal", "lena"]).map((p) => p.id)).toEqual(["anita", "maria"]);
  });

  it("change sponsor never moves someone under their own downline", () => {
    const p = sponsorChangePlan([byId("anita"), byId("lena"), byId("pat")], "jamal", people);
    expect(ids(p.apply)).toEqual(["lena", "pat"]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["would be under their own team"]);
    expect(sponsorChangePlan([byId("lena")], "maria", people).skipped[0].reason).toBe(
      "already under them",
    );
  });

  it("tags skip people who already have them, any capitalisation", () => {
    expect(cleanTag("  Fall   weekend ")).toBe("Fall weekend");
    const p = tagPlan([byId("anita"), byId("carlos"), byId("lena")], "LEADER");
    expect(ids(p.apply)).toEqual(["lena"]);
    expect(tagsInUse(people)).toEqual(["Leader", "Fall weekend"]);
  });

  it("delete never touches yourself or anyone above you", () => {
    // Jamal's view: Anita and Maria are above him.
    const up = uplineIdsOf(people, "jamal");
    expect([...up].sort()).toEqual(["anita", "maria"]);
    const p = deletePlan([byId("anita"), byId("carlos"), byId("cy")], up);
    expect(ids(p.apply)).toEqual(["carlos", "cy"]);
    expect(p.skipped[0].reason).toBe("above you");
  });
});
