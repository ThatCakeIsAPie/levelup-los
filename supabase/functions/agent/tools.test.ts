import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, findTool, inputSchema, toolList, validateArgs } from "./tools.ts";

const migrations = join(__dirname, "../../migrations");
const allSql = readdirSync(migrations)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrations, f), "utf8"))
  .join("\n");

/** The `public.agent_<name>` functions the migrations leave in place: created (or replaced) and not dropped after. */
function toolsInMigrations(): string[] {
  const state = new Map<string, boolean>();
  for (const m of allSql.matchAll(
    /(create (?:or replace )?|drop )function public\.agent_([a-z_]+)\(/g,
  ))
    state.set(m[2], m[1].startsWith("create"));
  return [...state]
    .filter(([, live]) => live)
    .map(([name]) => name)
    .sort();
}

describe("the registry and the migrations agree", () => {
  it("has one entry for each public.agent_<name> function and no other", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(toolsInMigrations());
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
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
          f.enum
            ? f.enum[0]
            : f.type === "integer"
              ? 1
              : f.type === "date"
                ? "2026-11-14"
                : f.type === "time"
                  ? "09:00"
                  : "x",
        ]),
      );
      expect(t.params(args as never).length, t.name).toBe(used.size);
    }
  });

  it("marks as writing exactly the tools whose SQL function asks for write access", () => {
    for (const t of TOOLS) {
      // the last definition counts (a tool replaced in a later migration)
      const all = [
        ...allSql.matchAll(
          new RegExp(
            `create (?:or replace )?function public\\.agent_${t.name}\\([\\s\\S]*?agent_private\\.ctx\\((true|false)\\)`,
            "g",
          ),
        ),
      ];
      expect(all.length, t.name).toBeGreaterThan(0);
      expect(all[all.length - 1][1] === "true", t.name).toBe(t.write);
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

  it("takes nothing for whoami, and refuses stray fields", () => {
    expect(validateArgs(t("whoami"), {})).toEqual({ ok: true, args: {} });
    expect(validateArgs(t("whoami"), undefined)).toEqual({ ok: true, args: {} });
    expect(validateArgs(t("whoami"), null)).toEqual({ ok: true, args: {} });
    const bad = validateArgs(t("whoami"), { x: 1 });
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { error: string }).error).toContain("it takes no arguments");
    expect(validateArgs(t("whoami"), [])).toMatchObject({ ok: false });
    expect(validateArgs(t("whoami"), "x")).toMatchObject({ ok: false });
  });

  it("checks the window of list_upcoming_events and export_events_ics", () => {
    for (const name of ["list_upcoming_events", "export_events_ics"]) {
      expect(validateArgs(t(name), {}), name).toEqual({ ok: true, args: {} });
      expect(validateArgs(t(name), { from: "2026-11-14", until: "2027-01-02" }), name).toEqual({
        ok: true,
        args: { from: "2026-11-14", until: "2027-01-02" },
      });
      for (const bad of [
        { from: "2026-02-30" },
        { from: "2026-13-01" },
        { from: "14/11/2026" },
        { from: "2026-11-14T00:00:00Z" },
        { until: "" },
        { until: 20261114 },
        { from: null },
        { x: 1 },
      ]) {
        expect(validateArgs(t(name), bad), `${name} ${JSON.stringify(bad)}`).toMatchObject({
          ok: false,
        });
      }
    }
    const stray = validateArgs(t("export_events_ics"), { changed_since: "2026-11-14T00:00:00Z" });
    expect((stray as { error: string }).error).toContain(
      "not a field of export_events_ics (allowed: from, until)",
    );
  });

  it("takes changed_since as an ISO 8601 time that names its offset", () => {
    const ok = (v: string) => validateArgs(t("list_upcoming_events"), { changed_since: v });
    for (const good of [
      "2026-11-14T18:00:00Z",
      "2026-11-14T18:00Z",
      "2026-11-14T12:00:00-06:00",
      "2026-11-14T18:00:00.123456+00:00",
    ])
      expect(ok(good), good).toEqual({ ok: true, args: { changed_since: good } });
    for (const bad of [
      "2026-11-14",
      "2026-11-14T18:00:00",
      "2026-11-14 18:00:00Z",
      "2026-11-14T25:00:00Z",
      "2026-02-30T10:00:00Z",
      "yesterday",
      "2026-11-14T18:00:00+0600",
    ])
      expect(ok(bad), bad).toMatchObject({ ok: false });
    expect(validateArgs(t("list_upcoming_events"), { changed_since: 5 })).toMatchObject({
      ok: false,
    });
  });

  it("sends the window as three typed parameters, nulls when absent", () => {
    const list = t("list_upcoming_events");
    expect(list.sql).toBe(
      "select public.agent_list_upcoming_events($1::date, $2::date, $3::timestamptz) as r",
    );
    expect(list.params({})).toEqual([null, null, null]);
    expect(list.params({ from: "2026-11-14", changed_since: "2026-11-14T18:00:00Z" })).toEqual([
      "2026-11-14",
      null,
      "2026-11-14T18:00:00Z",
    ]);
    const ics = t("export_events_ics");
    expect(ics.sql).toBe("select public.agent_export_events_ics($1::date, $2::date) as r");
    expect(ics.params({ until: "2027-01-02" })).toEqual([null, "2027-01-02"]);
    expect(ics.write).toBe(false);
    expect(list.write).toBe(false);
  });

  it("names iCalendar in the descriptions and states what the receiver must do", () => {
    const list = t("list_upcoming_events").description;
    for (const word of [
      "iCalendar",
      "uid",
      "summary",
      "last_modified",
      "end_date_exclusive",
      "start_utc",
      "TZID",
      "recurrence_id",
      "is_exception",
      "series_uid",
      "rrule",
      "exdates",
      "until",
      "partstat",
      "changed_since",
      "capped",
      "no sequence",
      "no end",
      "point in time",
    ])
      expect(list, word).toContain(word);
    const ics = t("export_events_ics").description;
    for (const word of [
      "VCALENDAR",
      "RRULE",
      "EXDATE",
      "RECURRENCE-ID",
      "VTIMEZONE",
      "separate UTC events",
      "CRLF",
      "75 octets",
    ])
      expect(ics, word).toContain(word);
  });

  it("formats only the export, as text", () => {
    expect(t("export_events_ics").format).toBeTypeOf("function");
    for (const tool of TOOLS)
      if (tool.name !== "export_events_ics") expect(tool.format, tool.name).toBeUndefined();
    const text = t("export_events_ics").format!(
      { timezone: "UTC", events: [], series: [], timezone_definition: null },
      new Date("2026-11-14T12:00:00Z"),
    );
    expect(text).toBeTypeOf("string");
    expect(text as string).toMatch(/^BEGIN:VCALENDAR\r\n/);
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

  describe("the people tools", () => {
    it("pages list_team, list_prospects and list_customers the same way", () => {
      for (const name of ["list_team", "list_prospects", "list_customers"]) {
        expect(validateArgs(t(name), {}), name).toMatchObject({ ok: true });
        expect(
          validateArgs(t(name), { search: "al", limit: 200, offset: 400 }),
          name,
        ).toMatchObject({ ok: true });
        for (const bad of [
          { limit: 0 },
          { limit: 201 },
          { offset: -1 },
          { offset: 1.5 },
          { offset: "1" },
          { search: 5 },
          { search: "x".repeat(101) },
          { search: null },
          { extra: 1 },
        ])
          expect(validateArgs(t(name), bad), `${name} ${JSON.stringify(bad)}`).toMatchObject({
            ok: false,
          });
        expect(t(name).write, name).toBe(false);
      }
      expect(validateArgs(t("list_team"), {})).toEqual({ ok: true, args: { limit: 50 } });
      expect(t("list_team").sql).toBe(
        "select public.agent_list_team($1::text, $2::int, $3::int) as r",
      );
      expect(t("list_team").params({ search: "al", limit: 5, offset: 10 })).toEqual(["al", 5, 10]);
      expect(t("list_team").params({})).toEqual([null, 50, 0]);
      expect(t("list_prospects").params({ limit: 20, search: "pat", offset: 40 })).toEqual([
        20,
        "pat",
        40,
      ]);
      expect(t("list_prospects").params({})).toEqual([50, null, 0]);
    });

    it("keeps every argument list_prospects had", () => {
      expect(validateArgs(t("list_prospects"), { limit: 5 })).toEqual({
        ok: true,
        args: { limit: 5 },
      });
      expect(Object.keys(t("list_prospects").properties)).toEqual(["search", "limit", "offset"]);
    });

    it("takes mine_only as a boolean that defaults to true", () => {
      expect(validateArgs(t("list_customers"), {})).toEqual({
        ok: true,
        args: { mine_only: true, limit: 50 },
      });
      expect(validateArgs(t("list_customers"), { mine_only: false })).toMatchObject({
        ok: true,
        args: { mine_only: false },
      });
      for (const bad of ["false", 0, null, "yes"])
        expect(validateArgs(t("list_customers"), { mine_only: bad }), String(bad)).toMatchObject({
          ok: false,
        });
      expect(
        t("list_customers").params({ mine_only: false, search: "c", limit: 3, offset: 6 }),
      ).toEqual([false, "c", 3, 6]);
      expect(t("list_customers").params({})).toEqual([true, null, 50, 0]);
      expect(t("list_customers").sql).toBe(
        "select public.agent_list_customers($1::boolean, $2::text, $3::int, $4::int) as r",
      );
      expect(inputSchema(t("list_customers")).properties.mine_only).toMatchObject({
        type: "boolean",
        default: true,
      });
    });

    it("needs an id for get_person", () => {
      expect(validateArgs(t("get_person"), { id: "p1" })).toEqual({ ok: true, args: { id: "p1" } });
      for (const bad of [{}, { id: "" }, { id: 5 }, { id: "x".repeat(101) }, { id: "p1", x: 1 }])
        expect(validateArgs(t("get_person"), bad), JSON.stringify(bad)).toMatchObject({
          ok: false,
        });
      expect(t("get_person").write).toBe(false);
      expect(t("get_person").params({ id: "p1" })).toEqual(["p1"]);
    });
  });

  describe("update_my_profile", () => {
    const tool = () => t("update_my_profile");

    it("takes only full_name, phone, email and location, and says which field is refused", () => {
      expect(tool().write).toBe(true);
      expect(Object.keys(tool().properties)).toEqual(["full_name", "phone", "email", "location"]);
      expect(
        validateArgs(tool(), {
          full_name: "Alexa A",
          phone: null,
          email: "a@b.test",
          location: "Austin, TX",
        }),
      ).toEqual({
        ok: true,
        args: { full_name: "Alexa A", phone: null, email: "a@b.test", location: "Austin, TX" },
      });
      for (const field of [
        "id",
        "name",
        "notes",
        "stage",
        "biz_class",
        "sponsor_id",
        "owner_id",
        "ibo_number",
        "ltd_number",
        "business_start_date",
        "pipeline_stage",
        "stage_history",
        "tags",
        "monthly_volume",
        "workspace_id",
        "person_id",
      ]) {
        const r = validateArgs(tool(), { phone: "1", [field]: "x" });
        expect(r, field).toMatchObject({ ok: false });
        expect((r as { error: string }).error, field).toContain(
          `${field}: not a field of update_my_profile (allowed: full_name, phone, email, location)`,
        );
      }
    });

    it("refuses nothing-to-change and bad values", () => {
      const r = validateArgs(tool(), {});
      expect(r).toMatchObject({ ok: false });
      expect((r as { error: string }).error).toContain(
        "give at least one of full_name, phone, email, location",
      );
      for (const bad of [
        { full_name: "" },
        { full_name: "  " },
        { full_name: null },
        { full_name: 5 },
        { full_name: "x".repeat(121) },
        { phone: "1".repeat(41) },
        { email: "e".repeat(201) },
        { location: "l".repeat(201) },
        { phone: 5 },
      ])
        expect(validateArgs(tool(), bad), JSON.stringify(bad).slice(0, 40)).toMatchObject({
          ok: false,
        });
    });

    it("sends only the patch, as JSON text cast to jsonb", () => {
      expect(tool().sql).toBe("select public.agent_update_my_profile($1::text::jsonb) as r");
      expect(tool().params({ phone: null, full_name: "N" })).toEqual([
        '{"full_name":"N","phone":null}',
      ]);
    });

    it("says the e-mail is contact information and names vCard", () => {
      expect(tool().description).toContain("does not change the address used to sign in");
      for (const w of ["vCard", "RFC 6350", "FN", "TEL", "EMAIL", "ADR"])
        expect(tool().description, w).toContain(w);
    });
  });

  describe("the learning tools", () => {
    it("checks log_learning's arguments", () => {
      const ok = (a: Record<string, unknown>) => validateArgs(t("log_learning"), a);
      expect(
        ok({ kind: "pages", amount: 30, unit: "minutes", title: "A book", date: "2026-11-10" }),
      ).toEqual({
        ok: true,
        args: { kind: "pages", amount: 30, unit: "minutes", title: "A book", date: "2026-11-10" },
      });
      expect(ok({ kind: "workshop" })).toEqual({ ok: true, args: { kind: "workshop" } });
      expect(ok({ kind: "podcast", title: null, amount: 1 })).toMatchObject({ ok: true });
      expect(ok({ kind: "conference", title: "" })).toMatchObject({ ok: true });
      for (const bad of [
        {},
        { kind: "reading" },
        { kind: "Pages" },
        { kind: null },
        { kind: "pages", amount: 0 },
        { kind: "pages", amount: -1 },
        { kind: "pages", amount: 1.5 },
        { kind: "pages", amount: "5" },
        { kind: "pages", amount: 100001 },
        { kind: "pages", unit: "hours" },
        { kind: "pages", unit: null },
        { kind: "pages", date: "2026-02-30" },
        { kind: "pages", date: "11/10/2026" },
        { kind: "pages", date: "2026-11-10T10:00:00Z" },
        { kind: "pages", title: "t".repeat(201) },
        { kind: "pages", person_id: "p2" },
        { kind: "pages", workspace_id: "w1" },
      ])
        expect(ok(bad), JSON.stringify(bad)).toMatchObject({ ok: false });
      expect(t("log_learning").write).toBe(true);
      expect(t("log_learning").sql).toBe(
        "select public.agent_log_learning($1::text, $2::text, $3::int, $4::text, $5::date) as r",
      );
      expect(t("log_learning").params({ kind: "workshop" })).toEqual([
        "workshop",
        null,
        null,
        null,
        null,
      ]);
      expect(
        t("log_learning").params({
          kind: "pages",
          title: "B",
          amount: 3,
          unit: "chapters",
          date: "2026-11-01",
        }),
      ).toEqual(["pages", "B", 3, "chapters", "2026-11-01"]);
    });

    it("offers the kinds and units of the app, and only those", () => {
      const p = t("log_learning").properties;
      expect(p.kind.enum).toEqual(["pages", "podcast", "workshop", "conference"]);
      expect(p.unit.enum).toEqual(["minutes", "pages", "chapters", "episodes"]);
      expect(inputSchema(t("log_learning")).required).toEqual(["kind"]);
    });

    it("tells the agent the rules in the description", () => {
      const d = t("log_learning").description;
      for (const w of [
        "Unnamed",
        "not in the future",
        "2000-01-01",
        "ISO 8601",
        "one entry",
        "two entries",
      ])
        expect(d, w).toContain(w);
    });

    it("lists the caller's own entries in a window", () => {
      expect(t("list_learning").write).toBe(false);
      expect(validateArgs(t("list_learning"), {})).toEqual({ ok: true, args: {} });
      expect(validateArgs(t("list_learning"), { from: "2026-10-01", until: "2026-10-31" })).toEqual(
        {
          ok: true,
          args: { from: "2026-10-01", until: "2026-10-31" },
        },
      );
      for (const bad of [{ from: "yesterday" }, { until: 5 }, { from: null }, { kind: "pages" }])
        expect(validateArgs(t("list_learning"), bad), JSON.stringify(bad)).toMatchObject({
          ok: false,
        });
      expect(t("list_learning").sql).toBe(
        "select public.agent_list_learning($1::date, $2::date) as r",
      );
      expect(t("list_learning").params({ until: "2026-10-31" })).toEqual([null, "2026-10-31"]);
      expect(t("list_learning").description).toContain("OWN");
    });
  });

  it("names the receiving standard in the description of every tool that returns or takes a person", () => {
    for (const name of [
      "list_team",
      "list_prospects",
      "list_customers",
      "get_person",
      "update_my_profile",
    ]) {
      const d = t(name).description;
      for (const w of ["vCard (RFC 6350)", "full_name (FN)", "phone (TEL)", "email (EMAIL)"])
        expect(d, `${name}: ${w}`).toContain(w);
    }
    for (const name of ["list_team", "list_prospects", "list_customers", "get_person"])
      expect(t(name).description, name).toContain("location (ADR locality and region as one text)");
    for (const name of ["list_prospects", "list_customers", "get_person"])
      expect(t(name).description, name).toContain("notes (NOTE)");
  });

  it("sends agents to the right list, and whoami says what it adds", () => {
    expect(t("list_prospects").description).toContain("not registered yet");
    expect(t("list_prospects").description).toContain("list_team");
    expect(t("list_team").description).toContain("downline");
    expect(t("list_team").description).toContain("list_prospects");
    expect(t("whoami").description).toContain("`can`");
    expect(t("whoami").description).toContain("`team_size`");
    expect(t("whoami").description).toContain("`open_tasks`");
  });

  describe("card tasks and notes", () => {
    const CARD = [
      "list_cards",
      "get_card",
      "list_card_tasks",
      "add_card_task",
      "update_card_task",
      "complete_card_task",
      "add_card_note",
    ];

    it("has the seven tools, the first three reading and the rest writing", () => {
      expect(CARD.map((n) => [n, t(n).write])).toEqual([
        ["list_cards", false],
        ["get_card", false],
        ["list_card_tasks", false],
        ["add_card_task", true],
        ["update_card_task", true],
        ["complete_card_task", true],
        ["add_card_note", true],
      ]);
    });

    it("says in every description what a card's tasks are called by others, and what the due date of a card is", () => {
      for (const n of ["list_cards", "get_card", "add_card_task", "add_card_note"])
        expect(t(n).description, n).toContain("follow-ups or to-dos");
      for (const n of ["list_card_tasks", "add_card_task"])
        expect(t(n).description, n).toContain("follow-up");
      for (const n of ["list_cards", "get_card", "add_card_task", "add_card_note"])
        expect(t(n).description, n).toContain("The card's due date is `next_due`");
    });

    it("names iCalendar VTODO for every tool that returns tasks", () => {
      for (const n of [
        "get_card",
        "list_card_tasks",
        "add_card_task",
        "update_card_task",
        "complete_card_task",
      ]) {
        const d = t(n).description;
        for (const w of [
          "iCalendar VTODO (RFC 5545)",
          "NEEDS-ACTION",
          "COMPLETED",
          "uid",
          "summary",
        ])
          expect(d, `${n}: ${w}`).toContain(w);
      }
      for (const n of ["list_card_tasks", "add_card_task", "update_card_task"])
        expect(t(n).description, n).toContain("timezone");
    });

    it("never exposes the booked next step or the card's old note box", () => {
      for (const n of CARD) {
        const text = JSON.stringify(inputSchema(t(n))) + t(n).description + t(n).sql;
        expect(text, n).not.toMatch(/next_column|next_step|booked|booking/i);
        expect(Object.keys(t(n).properties), n).not.toContain("note");
      }
    });

    it("validates list_cards and sends ten typed parameters with the defaults", () => {
      expect(validateArgs(t("list_cards"), {})).toEqual({
        ok: true,
        args: { mine_only: true, limit: 50, offset: 0 },
      });
      expect(t("list_cards").params({ mine_only: true, limit: 50, offset: 0 })).toEqual([
        "all",
        null,
        true,
        null,
        null,
        null,
        false,
        null,
        50,
        0,
      ]);
      expect(validateArgs(t("list_cards"), { board: "both" })).toMatchObject({ ok: false });
      expect(validateArgs(t("list_cards"), { due_from: "2026-02-30" })).toMatchObject({
        ok: false,
      });
      expect(validateArgs(t("list_cards"), { limit: 201 })).toMatchObject({ ok: false });
      expect(validateArgs(t("list_cards"), { stage: "x" })).toMatchObject({ ok: false });
      expect(
        validateArgs(t("list_cards"), { board: "customer", has_open_tasks: false }),
      ).toMatchObject({ ok: true });
    });

    it("validates add_card_task: a title, a real date, a time of day", () => {
      const ok = validateArgs(t("add_card_task"), {
        person_id: "p1",
        title: "Text Nik to confirm",
        due_date: "2026-11-19",
        due_time: "09:00",
      });
      expect(ok).toEqual({
        ok: true,
        args: {
          person_id: "p1",
          title: "Text Nik to confirm",
          due_date: "2026-11-19",
          due_time: "09:00",
        },
      });
      if (ok.ok)
        expect(t("add_card_task").params(ok.args)).toEqual([
          "p1",
          "Text Nik to confirm",
          "recruiting",
          "2026-11-19",
          "09:00",
          null,
        ]);
      for (const bad of [
        { title: "x" },
        { person_id: "p1" },
        { person_id: "p1", title: "   " },
        { person_id: "p1", title: "x".repeat(201) },
        { person_id: "p1", title: "x", due_time: "9:00" },
        { person_id: "p1", title: "x", due_time: "24:00" },
        { person_id: "p1", title: "x", due_time: "09:00:00" },
        { person_id: "p1", title: "x", due_date: "19/11/2026" },
        { person_id: "p1", title: "x", board: "all" },
        { person_id: "p1", title: "x", done: true },
        { person_id: "p1", title: "x", created_by: "someone" },
      ])
        expect(validateArgs(t("add_card_task"), bad), JSON.stringify(bad)).toMatchObject({
          ok: false,
        });
    });

    it("update_card_task takes only title, due_date, due_time and assignee_id, and null clears", () => {
      const u = t("update_card_task");
      expect(validateArgs(u, { task_id: "t1" })).toMatchObject({
        ok: false,
        error: expect.stringContaining(
          "nothing to change: give at least one of title, due_date, due_time, assignee_id",
        ),
      });
      for (const k of [
        "done",
        "done_at",
        "person_id",
        "card_id",
        "position",
        "created_by",
        "status",
      ])
        expect(validateArgs(u, { task_id: "t1", [k]: "x" }), k).toMatchObject({
          ok: false,
          error: expect.stringContaining(`${k}: not a field of update_card_task`),
        });
      const v = validateArgs(u, {
        task_id: "t1",
        due_date: null,
        due_time: null,
        assignee_id: null,
      });
      expect(v).toMatchObject({ ok: true });
      if (v.ok)
        expect(u.params(v.args)).toEqual([
          "t1",
          '{"due_date":null,"due_time":null,"assignee_id":null}',
        ]);
      expect(u.sql).toBe("select public.agent_update_card_task($1::text, $2::text::jsonb) as r");
      expect(validateArgs(u, { task_id: "t1", title: null })).toMatchObject({ ok: false });
      expect(validateArgs(u, { task_id: "t1", due_time: "25:61" })).toMatchObject({ ok: false });
    });

    it("complete_card_task ticks by default, and add_card_note takes a body of 1 to 2000 characters", () => {
      const c = validateArgs(t("complete_card_task"), { task_id: "t1" });
      expect(c).toEqual({ ok: true, args: { task_id: "t1", done: true } });
      if (c.ok) expect(t("complete_card_task").params(c.args)).toEqual(["t1", true]);
      expect(t("complete_card_task").params({ task_id: "t1", done: false })).toEqual(["t1", false]);
      expect(validateArgs(t("complete_card_task"), { task_id: "t1", done: "yes" })).toMatchObject({
        ok: false,
      });
      expect(
        validateArgs(t("add_card_note"), { person_id: "p1", body: "x".repeat(2000) }),
      ).toMatchObject({ ok: true });
      expect(
        validateArgs(t("add_card_note"), { person_id: "p1", body: "x".repeat(2001) }),
      ).toMatchObject({ ok: false });
      expect(validateArgs(t("add_card_note"), { person_id: "p1", body: "" })).toMatchObject({
        ok: false,
      });
    });

    it("lists tasks with status open and assigned me unless told otherwise", () => {
      expect(validateArgs(t("list_card_tasks"), {})).toMatchObject({ ok: true });
      expect(t("list_card_tasks").params({})).toEqual([
        "open",
        null,
        null,
        false,
        "me",
        null,
        null,
        50,
        0,
      ]);
      expect(validateArgs(t("list_card_tasks"), { status: "later" })).toMatchObject({ ok: false });
      expect(validateArgs(t("list_card_tasks"), { assigned: "everyone" })).toMatchObject({
        ok: false,
      });
      expect(
        validateArgs(t("list_card_tasks"), { changed_since: "2026-11-14T18:00:00" }),
      ).toMatchObject({ ok: false });
      expect(
        validateArgs(t("list_card_tasks"), { changed_since: "2026-11-14T18:00:00Z" }),
      ).toMatchObject({ ok: true });
    });

    it("describes a time as an HH:MM pattern in the JSON schema", () => {
      expect(inputSchema(t("add_card_task")).properties.due_time).toMatchObject({
        type: "string",
        pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$",
      });
      expect(inputSchema(t("update_card_task")).properties.due_time).toMatchObject({
        type: ["string", "null"],
      });
    });
  });

  it("never mentions the IBO or LTD number except to say it cannot be changed", () => {
    for (const tool of TOOLS) {
      const text = JSON.stringify(inputSchema(tool)) + tool.description;
      if (tool.name === "update_my_profile") continue;
      expect(text, tool.name).not.toMatch(/ibo[_ ]?(number|#)|ltd[_ ]?(number|#)/i);
    }
    expect(JSON.stringify(inputSchema(t("update_my_profile")))).not.toMatch(/ibo|ltd/i);
  });

  it("changes data in exactly the tools that write", () => {
    expect(TOOLS.filter((x) => x.write).map((x) => x.name)).toEqual([
      "add_prospect",
      "update_prospect",
      "update_my_profile",
      "set_event_answer",
      "log_learning",
      "add_card_task",
      "update_card_task",
      "complete_card_task",
      "add_card_note",
    ]);
    expect(TOOLS.map((x) => x.name)).toHaveLength(20);
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
    expect(inputSchema(findTool("list_upcoming_events")!).properties).toEqual({
      from: expect.objectContaining({ type: "string", format: "date" }),
      until: expect.objectContaining({ type: "string", format: "date" }),
      changed_since: expect.objectContaining({ type: "string", format: "date-time" }),
    });
    expect(inputSchema(findTool("export_events_ics")!).required).toEqual([]);
    expect(Object.keys(inputSchema(findTool("export_events_ics")!).properties)).toEqual([
      "from",
      "until",
    ]);
    expect(inputSchema(findTool("whoami")!)).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });
});
