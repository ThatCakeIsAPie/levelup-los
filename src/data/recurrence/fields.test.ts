import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SERIES_FIELDS } from "./plan";

const dir = resolve(__dirname, "../../../supabase/migrations");
/** The newest migration that defines a function: the definition in force. */
function definition(fn: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse();
  for (const f of files) {
    const sql = readFileSync(resolve(dir, f), "utf8");
    const at = sql.search(new RegExp(`create (or replace )?function public\\.${fn}\\(`));
    if (at >= 0) return sql.slice(at, sql.indexOf("end $$;", at));
  }
  throw new Error(`no migration defines ${fn}`);
}

describe("the fields an occurrence can change on its own: the database and the client agree", () => {
  it("the guard trigger records exactly these fields", () => {
    const guard = definition("events_series_guard");
    const tracked = [...guard.matchAll(/new\.(\w+) is distinct from old\.\1 then '(\w+)' end/g)]
      .filter(([, a, b]) => a === b)
      .map(([, a]) => a);
    expect([...tracked].sort()).toEqual([...SERIES_FIELDS].sort());
  });

  it("the following-update function accepts exactly these fields", () => {
    const fn = definition("update_event_series_following");
    const list = /v_key not in \(([^)]*)\)/.exec(fn)![1];
    const allowed = [...list.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect([...allowed].sort()).toEqual([...SERIES_FIELDS].sort());
  });

  it("includes the start and end time", () => {
    expect(SERIES_FIELDS).toContain("start_time");
    expect(SERIES_FIELDS).toContain("end_time");
  });
});
