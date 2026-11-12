import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SENSITIVE_KINDS, sensitive, sensitiveIf } from "./sensitive";

describe("registry", () => {
  it("lists the kinds the owner decided on", () => {
    expect([...SENSITIVE_KINDS]).toEqual([
      "name",
      "phone",
      "email",
      "address",
      "id-number",
      "note",
      "message",
      "photo",
    ]);
  });
  it("sensitive() is one data attribute and nothing else", () => {
    expect(sensitive("phone")).toEqual({ "data-sensitive": "phone" });
  });
  it("sensitiveIf() marks only when asked to", () => {
    expect(sensitiveIf(true, "name")).toEqual({ "data-sensitive": "name" });
    expect(sensitiveIf(false, "name")).toEqual({});
  });
});

/**
 * A cheap guard, not a proof: a line of UI that prints a person's phone, email,
 * IBO# or LTD# must sit next to a marker (`<Sensitive>`, `sensitive(...)`), so
 * the feedback snapshot blacks it out. Names and notes are too varied to find
 * by pattern; the value safety net and the rule in AGENTS.md cover those.
 */
const FIELD = /\{[^{}]*\.(phone|email|iboNumber|ltdNumber)\b[^{}]*\}/;
/** Lines where the field is used, not shown: links, props, handlers, state. */
const NOT_SHOWN =
  /(href|value|defaultValue|aria-[a-z]+|title|key|onClick|onChange|onSelect|disabled|to|params|search|placeholder|label|id|name)=\{|\?\.(trim|toLowerCase|includes)|\.(filter|map|sort)\(|\|\||&&|===|!==|if \(|return \[|=>/;
const MARKED = /Sensitive|sensitive\(|sensitiveIf\(|phoneHref|mailto:|tel:/;

function* tsxFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "ui" && name !== "remote") yield* tsxFiles(p);
    } else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) yield p;
  }
}

describe("people's contact details are marked where they are shown", () => {
  it("has no unmarked phone, email, IBO# or LTD# in JSX text", () => {
    const root = path.resolve(__dirname, "..");
    const loose: string[] = [];
    for (const file of tsxFiles(root)) {
      if (file.includes("styleguide")) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (!FIELD.test(line) || NOT_SHOWN.test(line)) return;
        // Shown as text: the line starts like JSX content, not like code.
        if (!/^\s*(\{|<[^>]*>\{|[A-Za-z]+ \{)/.test(line)) return;
        const near = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
        if (!MARKED.test(near)) loose.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(loose).toEqual([]);
  });
});
