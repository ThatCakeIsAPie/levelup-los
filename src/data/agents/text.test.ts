import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ACCESS_LINE, connectorUrl, pairingText } from "./text";

/** The block the plan file gives as the final wording of the text the button shows. */
function planBlock(): string {
  const plan = readFileSync("docs/plans/agent-connector-2026-11-14.md", "utf8");
  const m = /```text\n([\s\S]*?)\n```/.exec(plan);
  if (!m) throw new Error("the plan file has no text block");
  return m[1];
}

describe("the text for the agent", () => {
  const connector = "https://abcdefghijklmnop.supabase.co/functions/v1/agent";
  const code = "ABCD-EFGH-JKLM-NPQR";

  it("equals the plan's block with the connector, code, access and minutes filled in", () => {
    for (const access of ["write", "read"] as const) {
      const expected = planBlock()
        .replaceAll("{CONNECTOR}", connector)
        .replaceAll("{CODE}", code)
        .replaceAll("{ACCESS}", ACCESS_LINE[access])
        .replaceAll("{MINUTES}", "10");
      expect(pairingText({ connector, code, access, minutes: 10 })).toBe(expected);
    }
  });

  it("leaves no placeholder behind and says the access in the plan's words", () => {
    const write = pairingText({ connector, code, access: "write" });
    expect(write).not.toMatch(/\{(CONNECTOR|CODE|ACCESS|MINUTES)\}/);
    expect(write).toContain("Access: read and change my CRM data");
    expect(pairingText({ connector, code, access: "read" })).toContain(
      "Access: only read my CRM data",
    );
    expect(write).toContain("expires in 10 minutes");
    expect(write).toContain(`Connector: ${connector}\nPairing code: ${code}\n`);
  });

  it("takes the minutes it is given", () => {
    expect(pairingText({ connector, code, access: "write", minutes: 3 })).toContain(
      "expires in 3 minutes",
    );
  });

  it("builds the connector URL from the project URL", () => {
    expect(connectorUrl("https://abc.supabase.co")).toBe(
      "https://abc.supabase.co/functions/v1/agent",
    );
    expect(connectorUrl(" https://abc.supabase.co/ ")).toBe(
      "https://abc.supabase.co/functions/v1/agent",
    );
  });
});
