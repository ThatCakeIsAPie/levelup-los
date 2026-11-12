import { describe, expect, it } from "vitest";
import {
  MAX_SPONSOR_DEPTH,
  MAX_STAGE_NAME,
  STAGE_KEYS,
  defaultStageName,
  inheritedStageNames,
  reservedStageNames,
  resolveStageNames,
  sponsorLine,
  stageNameErrors,
  stageSourceHint,
  type StageNameEntry,
  type StagePipeline,
} from "./rules";
import { CUSTOMER_BOARD } from "../customerPipeline/types";
import { RECRUITING_BOARD } from "../pipeline/types";
import { makeStageNames } from "./names";

const e = (
  personId: string,
  pipeline: StagePipeline,
  stage: string,
  name: string,
): StageNameEntry => ({ personId, pipeline, stage, name });

/** maria (top) -> anita -> jamal -> tasha */
const SPONSOR: Record<string, string | null> = {
  maria: null,
  anita: "maria",
  jamal: "anita",
  tasha: "jamal",
};
const line = (id: string) => sponsorLine((p) => SPONSOR[p], id);
const NAMES: Record<string, string> = {
  maria: "Maria Reyes",
  anita: "Anita Patel",
  jamal: "Jamal Brown",
};
const nameOf = (id: string) => NAMES[id];

describe("sponsorLine", () => {
  it("lists the person, then each sponsor upward", () => {
    expect(line("tasha")).toEqual(["tasha", "jamal", "anita", "maria"]);
    expect(line("maria")).toEqual(["maria"]);
  });

  it("stops at a cycle", () => {
    const loop: Record<string, string> = { a: "b", b: "c", c: "a" };
    expect(sponsorLine((id) => loop[id], "a")).toEqual(["a", "b", "c"]);
  });

  it("stops at the depth cap", () => {
    const deep = (id: string) => `p${Number(id.slice(1)) + 1}`;
    expect(sponsorLine(deep, "p0")).toHaveLength(MAX_SPONSOR_DEPTH);
    expect(sponsorLine(deep, "p0", 5)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });
});

describe("resolveStageNames", () => {
  it("falls back to the built-in names", () => {
    const r = resolveStageNames(line("jamal"), []);
    expect(r.recruiting.contact).toMatchObject({
      name: "Contact made",
      source: "default",
      fromId: null,
    });
    expect(r.recruiting.first_meeting.column).toBe("First meeting (MG1)");
    expect(r.recruiting.first_meeting.alias).toBe("MG1");
    expect(r.customer.on_ditto).toMatchObject({ name: "On Ditto", column: "On Ditto" });
  });

  it("an own name wins over every upline's", () => {
    const entries = [
      e("maria", "customer", "contact", "Top"),
      e("anita", "customer", "contact", "Middle"),
      e("jamal", "customer", "contact", "Mine"),
    ];
    const r = resolveStageNames(line("jamal"), entries, nameOf).customer.contact;
    expect(r).toMatchObject({ name: "Mine", column: "Mine", source: "own", fromId: "jamal" });
  });

  it("the nearest upline wins over a higher one", () => {
    const entries = [
      e("maria", "recruiting", "first_plan", "Top"),
      e("anita", "recruiting", "first_plan", "Middle"),
    ];
    const r = resolveStageNames(line("tasha"), entries, nameOf).recruiting.first_plan;
    expect(r).toMatchObject({
      name: "Middle",
      source: "upline",
      fromId: "anita",
      fromName: "Anita Patel",
      alias: null,
    });
    // Someone above Anita still sees their own.
    expect(resolveStageNames(line("maria"), entries).recruiting.first_plan.name).toBe("Top");
  });

  it("a downline's own name is not overridden by a later upline change", () => {
    const own = e("jamal", "recruiting", "contact", "Mine");
    const before = [e("maria", "recruiting", "contact", "Old"), own];
    const after = [
      e("maria", "recruiting", "contact", "New"),
      e("anita", "recruiting", "contact", "Newer"),
      own,
    ];
    expect(resolveStageNames(line("jamal"), before).recruiting.contact.name).toBe("Mine");
    expect(resolveStageNames(line("jamal"), after).recruiting.contact.name).toBe("Mine");
    // And the person below Jamal sees Jamal's, not the higher ones.
    expect(resolveStageNames(line("tasha"), after).recruiting.contact.name).toBe("Mine");
  });

  it("each stage and each pipeline resolves on its own", () => {
    const entries = [
      e("maria", "recruiting", "contact", "R-contact"),
      e("anita", "recruiting", "registered", "R-reg"),
      e("jamal", "customer", "contact", "C-contact"),
    ];
    const r = resolveStageNames(line("jamal"), entries);
    expect(r.recruiting.contact.name).toBe("R-contact");
    expect(r.recruiting.first_meeting.name).toBe("First meeting");
    expect(r.recruiting.registered.name).toBe("R-reg");
    expect(r.customer.contact.name).toBe("C-contact");
    expect(r.customer.first_sale.name).toBe("First sale");
    // Renaming one pipeline's "contact" leaves the other pipeline's alone.
    const only = resolveStageNames(line("jamal"), [e("maria", "recruiting", "contact", "X")]);
    expect(only.customer.contact.name).toBe("Contact");
  });

  it("ignores unknown stage keys, blank names and people outside the line", () => {
    const entries = [
      e("maria", "recruiting", "first_sale", "Nope"),
      e("anita", "recruiting", "contact", "   "),
      e("stranger", "recruiting", "contact", "Not mine"),
    ];
    const r = resolveStageNames(line("jamal"), entries);
    expect(r.recruiting.contact.name).toBe("Contact made");
    expect(r.recruiting.first_sale).toBeUndefined();
  });

  it("trims a stored name", () => {
    const r = resolveStageNames(["a"], [e("a", "customer", "first_sale", "  Sold ")]);
    expect(r.customer.first_sale.name).toBe("Sold");
  });

  it("terminates on a sponsor cycle", () => {
    const loop: Record<string, string> = { a: "b", b: "c", c: "a" };
    const l = sponsorLine((id) => loop[id], "a");
    const r = resolveStageNames(l, [e("c", "customer", "contact", "From c")]);
    expect(r.customer.contact).toMatchObject({ name: "From c", source: "upline" });
  });

  it("inheritedStageNames leaves the viewer's own names out", () => {
    const entries = [
      e("anita", "customer", "contact", "Anita's"),
      e("jamal", "customer", "contact", "Mine"),
    ];
    const inh = inheritedStageNames(line("jamal"), entries, nameOf);
    expect(inh.customer.contact).toMatchObject({ name: "Anita's", fromName: "Anita Patel" });
    expect(inheritedStageNames(line("jamal"), [], nameOf).customer.contact.source).toBe("default");
  });
});

describe("makeStageNames", () => {
  const stages = resolveStageNames(line("jamal"), [
    e("anita", "recruiting", "first_meeting", "Intro call"),
  ]);
  const names = makeStageNames("recruiting", stages.recruiting);

  it("gives each form of a name", () => {
    expect(names.name("first_meeting")).toBe("Intro call");
    expect(names.column("first_meeting")).toBe("Intro call");
    expect(names.plural("first_meeting")).toBe("Intro call");
    expect(names.short("first_meeting")).toBe("Intro call");
    expect(names.alias("first_meeting")).toBeNull();
    expect(names.count("first_meeting", 1)).toBe("Intro call");
    expect(names.name("first_plan")).toBe("First plan");
    expect(names.plural("first_plan")).toBe("First plans");
    expect(names.short("first_plan")).toBe("Plans");
    expect(names.count("first_plan", 3)).toBe("First plans");
    expect(names.count("first_plan", 1)).toBe("First plan");
  });

  it("names the bands, with the fixed ones as they are", () => {
    expect(names.band("first_meeting")).toBe("Intro call");
    expect(names.band("start")).toBe("Start");
    expect(names.band("out")).toBe("Not now");
  });

  it("swaps the names into a board layout and reserves them for steps", () => {
    const board = names.board(RECRUITING_BOARD);
    expect(board.bands.find((b) => b.id === "first_meeting")?.label).toBe("Intro call");
    expect(board.milestoneColumnLabel.first_meeting).toBe("Intro call");
    expect(board.milestoneColumnLabel.first_plan).toBe("First plan (Info 1)");
    expect(board.reserved).toContain("Intro call");
    expect(board.reserved).toContain("First meeting");
    // The same layout gives the same object.
    expect(names.board(RECRUITING_BOARD)).toBe(board);
    // The original is untouched.
    expect(RECRUITING_BOARD.bands.find((b) => b.id === "first_meeting")?.label).toBe(
      "First meeting",
    );
  });
});

describe("stageNameErrors", () => {
  const inherited = (p: StagePipeline) =>
    resolveStageNames(line("jamal"), [e("anita", p, "contact", "Intro")])[p];
  const reserved = reservedStageNames(CUSTOMER_BOARD);

  it("accepts empty fields and names up to the limit", () => {
    expect(stageNameErrors("customer", {}, inherited("customer"), reserved)).toEqual({});
    expect(
      stageNameErrors(
        "customer",
        { contact: "x".repeat(MAX_STAGE_NAME) },
        inherited("customer"),
        reserved,
      ),
    ).toEqual({});
  });

  it("refuses a name that is too long after trimming", () => {
    const errors = stageNameErrors(
      "customer",
      { contact: "x".repeat(MAX_STAGE_NAME + 1), first_sale: "  ok  " },
      inherited("customer"),
      reserved,
    );
    expect(Object.keys(errors)).toEqual(["contact"]);
    expect(
      stageNameErrors(
        "customer",
        { contact: ` ${"x".repeat(MAX_STAGE_NAME)} ` },
        inherited("customer"),
      ),
    ).toEqual({});
  });

  it("refuses two stages with the same name, ignoring case and spacing", () => {
    const errors = stageNameErrors(
      "customer",
      { contact: "Intro  Call", first_meeting: "intro call" },
      inherited("customer"),
    );
    expect(errors).toHaveProperty("first_meeting");
    expect(errors).not.toHaveProperty("contact");
  });

  it("counts inherited names too: a typed name can't equal an inherited one", () => {
    // contact is inherited as "Intro"; typing "intro" for another stage clashes.
    const errors = stageNameErrors("customer", { first_meeting: "intro" }, inherited("customer"));
    expect(errors).toHaveProperty("first_meeting");
    // Putting a stage's built-in name on another stage is also a clash.
    expect(
      stageNameErrors("customer", { contact: "First sale" }, inherited("customer")),
    ).toHaveProperty("contact");
  });

  it("allows swapping two built-in names", () => {
    const errors = stageNameErrors(
      "recruiting",
      { first_meeting: "First plan", first_plan: "First meeting" },
      resolveStageNames(["x"], []).recruiting,
    );
    expect(errors).toEqual({});
  });

  it("does not blame the person for inherited names that already clash", () => {
    const stages = resolveStageNames(line("jamal"), [
      e("anita", "customer", "contact", "Same"),
      e("maria", "customer", "first_meeting", "Same"),
    ]).customer;
    // Anita's "Same" is nearer for contact; maria's for first_meeting: both visible, both "Same".
    expect(stageNameErrors("customer", {}, stages)).toEqual({});
    // Typing a clashing name is on them.
    expect(stageNameErrors("customer", { first_sale: "same" }, stages)).toHaveProperty(
      "first_sale",
    );
  });

  it("refuses the name of a start or outcome column", () => {
    const errors = stageNameErrors(
      "customer",
      { contact: "Not interested" },
      inherited("customer"),
      reserved,
    );
    expect(errors.contact).toMatch(/column/);
    expect(reserved).toContain("Do not contact");
  });
});

describe("defaults and hints", () => {
  it("covers every key of both pipelines", () => {
    for (const p of ["recruiting", "customer"] as const)
      for (const k of STAGE_KEYS[p]) expect(defaultStageName(p, k).name).not.toBe(k);
  });

  it("says where an inherited name comes from", () => {
    const r = resolveStageNames(
      line("jamal"),
      [e("anita", "customer", "contact", "Intro")],
      nameOf,
    );
    expect(stageSourceHint(r.customer.contact)).toBe("From Anita Patel");
    expect(stageSourceHint(r.customer.first_sale)).toBe("Default");
    expect(stageSourceHint({ ...r.customer.contact, fromName: null })).toBe("From your upline");
  });
});
