import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrmPerson } from "@/data";
import type { PersonRow } from "./model";

const saved: { name: string; csv: string }[] = [];
vi.mock("@/lib/csvExport", async (orig) => ({
  ...(await orig<typeof import("@/lib/csvExport")>()),
  downloadCsv: (name: string, csv: string) => void saved.push({ name, csv }),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn() }) }));

import { exportRowsCsv } from "./exportCsv";

const row = (
  id: string,
  bizClass: CrmPerson["bizClass"],
  type: PersonRow["type"],
  referralSource: boolean,
  tags?: string[],
): PersonRow =>
  ({
    person: { id, name: id, bizClass, tags },
    stage: bizClass,
    type,
    referralSource,
    contact: {},
    showRate: { attended: 0, eligible: 0, pct: 0 },
    missing: [],
  }) as unknown as PersonRow;

describe("People CSV", () => {
  beforeEach(() => void (saved.length = 0));

  it("the stage column carries the type word, and Tags includes a derived Referral source", () => {
    exportRowsCsv(
      [
        row("c1", "prospect", "contact", false),
        row("p1", "prospect", "prospect", false, ["Gym"]),
        row("f1", "prospect", "filtered", true),
        row("a1", "apprentice", null, false),
        row("i1", "ibo", null, true, ["referral source"]),
        row("u1", "customer", null, true, ["Gym", "Referral source"]),
      ],
      "people",
    );
    const [head, ...lines] = saved[0].csv.trim().split(/\r?\n/);
    const cols = head.split(",");
    const at = (name: string) => cols.indexOf(name);
    const cell = (line: string, name: string) => line.split(",")[at(name)];
    expect(lines.map((l) => cell(l, "BizClass"))).toEqual([
      "Contact",
      "Prospect",
      "Filtered",
      "Apprentice",
      "IBO",
      "Customer",
    ]);
    // The stored stage column is untouched.
    expect(lines.map((l) => cell(l, "PipelineStage"))).toEqual(["", "", "", "", "", ""]);
    // Derived or hand-set, "Referral source" is in Tags once; other tags stay.
    const tagCells = lines.map((l) => cell(l, "Tags").replaceAll('"', ""));
    expect(tagCells).toEqual([
      "",
      "Gym",
      "Referral source",
      "",
      "referral source",
      "Gym; Referral source",
    ]);
  });
});
