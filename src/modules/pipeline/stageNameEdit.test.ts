import { describe, expect, it } from "vitest";
import { defaultStageName, MAX_STAGE_NAME, type ResolvedStage, type StageNameRow } from "@/data";
import { draftWith, nextOwnName, stageEditError } from "./stageNameEdit";

const stage = (
  key: string,
  name: string,
  source: ResolvedStage["source"] = "default",
  fromName: string | null = null,
): ResolvedStage => ({
  pipeline: "recruiting",
  key,
  name,
  column: name,
  plural: name,
  short: name,
  alias: null,
  defaultName: defaultStageName("recruiting", key).name,
  source,
  fromId: fromName ? "up" : null,
  fromName,
});

/** Four recruiting rows: `own` per key, `inherited` per key (default unless given). */
function rows(
  own: Record<string, string> = {},
  inherited: Record<string, string> = {},
): StageNameRow[] {
  return ["contact", "first_meeting", "first_plan", "registered"].map((key) => {
    const inh = inherited[key]
      ? stage(key, inherited[key], "upline", "Maria Reyes")
      : stage(key, defaultStageName("recruiting", key).name);
    return {
      key,
      own: own[key] ?? "",
      inherited: inh,
      effective: own[key] ? stage(key, own[key], "own") : inh,
    };
  });
}

describe("draftWith", () => {
  it("keeps the saved names and replaces one", () => {
    expect(draftWith(rows({ contact: "Reached out" }), "first_plan", "Plan")).toEqual({
      contact: "Reached out",
      first_meeting: "",
      first_plan: "Plan",
      registered: "",
    });
  });
});

describe("nextOwnName", () => {
  const r = rows({ first_plan: "Plan session" }, { contact: "Top contact" });
  const row = (key: string) => r.find((x) => x.key === key)!;

  it("sets a new name, trimmed", () => {
    expect(nextOwnName(row("first_meeting"), "  Intro call ")).toBe("Intro call");
  });
  it("changes nothing when the shown name isn't yours and is left as it is", () => {
    expect(nextOwnName(row("first_meeting"), "First meeting")).toBeNull();
    expect(nextOwnName(row("contact"), "Top contact")).toBeNull();
  });
  it("changes nothing for an empty field when you have no name of your own", () => {
    expect(nextOwnName(row("contact"), "   ")).toBeNull();
  });
  it("clears your own name when the field is emptied", () => {
    expect(nextOwnName(row("first_plan"), "")).toBe("");
  });
  it("changes nothing when your own name is left as it is", () => {
    expect(nextOwnName(row("first_plan"), "Plan session ")).toBeNull();
  });
  it("replaces your own name", () => {
    expect(nextOwnName(row("first_plan"), "Plan day")).toBe("Plan day");
  });
});

describe("stageEditError", () => {
  const reserved = ["Start", "Not now"];
  const check = (rs: StageNameRow[], key: string, typed: string) =>
    stageEditError("recruiting", rs, reserved, key, typed);

  it("accepts a fresh name and an emptied field", () => {
    expect(check(rows(), "contact", "Reached out")).toBeNull();
    expect(check(rows({ contact: "Reached out" }), "contact", "")).toBeNull();
  });
  it("refuses a name longer than the limit", () => {
    expect(check(rows(), "contact", "x".repeat(MAX_STAGE_NAME + 1))).toBe(
      `Keep it to ${MAX_STAGE_NAME} characters.`,
    );
    expect(check(rows(), "contact", "x".repeat(MAX_STAGE_NAME))).toBeNull();
  });
  it("refuses another stage's name, with or without case and extra spaces", () => {
    expect(check(rows(), "contact", "first  MEETING")).toBe("Another stage already has that name.");
    expect(check(rows({ first_plan: "Plan" }), "contact", "plan")).toBe(
      "Another stage already has that name.",
    );
  });
  it("refuses the name of a column", () => {
    expect(check(rows(), "contact", "not now")).toBe("That's already the name of a column.");
  });
  it("shows a clash caused by clearing on the stage being edited", () => {
    // Clearing contact brings back "Top" (inherited), which first_plan already uses as its own name.
    const rs = rows({ contact: "Mine", first_plan: "Top" }, { contact: "Top" });
    expect(check(rs, "contact", "")).toBe("Another stage already has that name.");
  });
});
