import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, findTool, inputSchema, toolList, validateArgs } from "./tools.ts";

const migrations = join(__dirname, "../../migrations");
const allSql = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrations, f), "utf8"))
  .join("\n");

describe("the registry and the migrations agree", () => {
  it("has one entry for each public.agent_<name> function and no other", () => {
    const inSql = [...allSql.matchAll(/create (?:or replace )?function public\.agent_([a-z_]+)\(/g)]
      .map((m) => m[1])
      .sort();
    expect(TOOLS.map((t) => t.name).sort()).toEqual(inSql);
  });

  it("calls exactly its own function, with numbered parameters and explicit casts", () => {
    for (const t of TOOLS) {
      expect(t.sql, t.name).toMatch(
        new RegExp(`^select public\\.agent_${t.name}\\((\\$\\d+::[a-z:]+(, )?)*\\) as r$`),
      );
      const used = new Set([...t.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      const args = Object.fromEntries(
        Object.entries(t.properties).map(([k, f]) => [
          k,
          f.enum ? f.enum[0] : f.type === "integer" ? 1 : "x",
        ]),
      );
      expect(t.params(args as never).length, t.name).toBe(used.size);
    }
  });

  it("marks as writing exactly the tools whose SQL function asks for write access", () => {
    for (const t of TOOLS) {
      const m = new RegExp(
        `function public\\.agent_${t.name}\\([\\s\\S]*?agent_private\\.ctx\\((true|false)\\)`,
      ).exec(allSql);
      expect(m, t.name).not.toBeNull();
      expect(m![1] === "true", t.name).toBe(t.write);
    }
  });

  it("has no tool that could delete, or take stage, sponsor, IBO#, LTD# or the business start date as input", () => {
    for (const t of TOOLS) {
      expect(t.name, t.name).not.toMatch(/delete|remove|destroy|drop|stage|sponsor|move/);
      expect(t.sql, t.name).not.toContain(";");
      for (const k of Object.keys(t.properties)) {
        expect(k, `${t.name}.${k}`).not.toMatch(
          /sponsor|business_start|ibo_number|ltd_number|stage|biz_class|owner|delete|remove/,
        );
      }
    }
  });
});

describe("validateArgs", () => {
  const t = (name: string) => findTool(name)!;

  it("takes nothing for whoami and list_upcoming_events, and refuses stray fields", () => {
    expect(validateArgs(t("whoami"), {})).toEqual({ ok: true, args: {} });
    expect(validateArgs(t("whoami"), undefined)).toEqual({ ok: true, args: {} });
    expect(validateArgs(t("whoami"), null)).toEqual({ ok: true, args: {} });
    const bad = validateArgs(t("list_upcoming_events"), { x: 1 });
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { error: string }).error).toContain("it takes no arguments");
    expect(validateArgs(t("whoami"), [])).toMatchObject({ ok: false });
    expect(validateArgs(t("whoami"), "x")).toMatchObject({ ok: false });
  });

  it("defaults and bounds the limit of list_prospects", () => {
    expect(validateArgs(t("list_prospects"), {})).toEqual({ ok: true, args: { limit: 50 } });
    expect(validateArgs(t("list_prospects"), { limit: 200 })).toEqual({
      ok: true,
      args: { limit: 200 },
    });
    for (const limit of [0, 201, 1.5, "5", null, NaN]) {
      expect(validateArgs(t("list_prospects"), { limit }), String(limit)).toMatchObject({
        ok: false,
      });
    }
  });

  it("checks add_prospect", () => {
    expect(validateArgs(t("add_prospect"), { name: "Pat" })).toEqual({
      ok: true,
      args: { name: "Pat" },
    });
    expect(validateArgs(t("add_prospect"), { name: "Pat", phone: "555" })).toEqual({
      ok: true,
      args: { name: "Pat", phone: "555" },
    });
    for (const a of [
      {},
      { name: "" },
      { name: "   " },
      { name: 5 },
      { name: "x".repeat(121) },
      { name: "a", phone: "1".repeat(41) },
      { name: "a", phone: 5 },
      { name: "a", extra: 1 },
      { name: null },
    ]) {
      expect(validateArgs(t("add_prospect"), a), JSON.stringify(a).slice(0, 40)).toMatchObject({
        ok: false,
      });
    }
  });

  it("limits update_prospect to the whitelist and says so", () => {
    const ok = validateArgs(t("update_prospect"), { id: "p1", phone: null, notes: "hello" });
    expect(ok).toEqual({ ok: true, args: { id: "p1", phone: null, notes: "hello" } });
    for (const field of [
      "biz_class",
      "sponsor_id",
      "pipeline_stage",
      "business_start_date",
      "ibo_number",
      "ltd_number",
      "stage_history",
      "owner_id",
      "workspace_id",
      "tags",
    ]) {
      const r = validateArgs(t("update_prospect"), { id: "p1", [field]: "x" });
      expect(r, field).toMatchObject({ ok: false });
      expect((r as { error: string }).error, field).toContain(
        `${field}: not a field of update_prospect (allowed: id, name, phone, email, location, notes)`,
      );
    }
    expect(validateArgs(t("update_prospect"), { id: "p1" })).toMatchObject({ ok: false });
    expect(validateArgs(t("update_prospect"), { id: "p1", name: null })).toMatchObject({
      ok: false,
    });
    expect(validateArgs(t("update_prospect"), { id: "p1", name: " " })).toMatchObject({
      ok: false,
    });
    expect(validateArgs(t("update_prospect"), { name: "x" })).toMatchObject({ ok: false });
    expect(validateArgs(t("update_prospect"), { id: "p1", notes: "n".repeat(4001) })).toMatchObject(
      { ok: false },
    );
    expect(validateArgs(t("update_prospect"), { id: "p1", email: 5 })).toMatchObject({ ok: false });
    // a field present as `undefined` is the same as absent
    expect(validateArgs(t("update_prospect"), { id: "p1", name: "N", phone: undefined })).toEqual({
      ok: true,
      args: { id: "p1", name: "N" },
    });
  });

  it("sends only the patch fields, as JSON text cast to jsonb", () => {
    const tool = t("update_prospect");
    expect(tool.sql).toContain("$2::text::jsonb");
    expect(tool.params({ id: "p1", phone: null, notes: "x" })).toEqual([
      "p1",
      '{"phone":null,"notes":"x"}',
    ]);
    expect(tool.params({ id: "p1", name: "N" })).toEqual(["p1", '{"name":"N"}']);
  });

  it("checks set_event_answer", () => {
    expect(validateArgs(t("set_event_answer"), { event_id: "e1", answer: "maybe" })).toEqual({
      ok: true,
      args: { event_id: "e1", answer: "maybe" },
    });
    for (const a of [
      {},
      { event_id: "e1" },
      { answer: "yes" },
      { event_id: "e1", answer: "attending" },
      { event_id: "e1", answer: "YES" },
      { event_id: "e1", answer: "yes", person_id: "p2" },
    ]) {
      expect(validateArgs(t("set_event_answer"), a), JSON.stringify(a)).toMatchObject({
        ok: false,
      });
    }
  });

  it("does not look names up on the prototype chain", () => {
    for (const n of ["constructor", "__proto__", "toString", "hasOwnProperty"])
      expect(findTool(n)).toBeUndefined();
    expect(validateArgs(t("whoami"), JSON.parse('{"__proto__": 1}'))).toMatchObject({ ok: false });
  });
});

describe("inputSchema", () => {
  it("is a closed JSON Schema object with the required fields and limits", () => {
    const s = inputSchema(findTool("update_prospect")!);
    expect(s).toMatchObject({ type: "object", additionalProperties: false, required: ["id"] });
    expect(s.properties.phone).toMatchObject({ type: ["string", "null"], maxLength: 40 });
    expect(s.properties.id).toMatchObject({ type: "string", minLength: 1 });
    expect(inputSchema(findTool("set_event_answer")!).properties.answer).toMatchObject({
      enum: ["yes", "no", "maybe"],
    });
    expect(inputSchema(findTool("list_prospects")!).properties.limit).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 200,
      default: 50,
    });
    expect(inputSchema(findTool("whoami")!)).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });
});
