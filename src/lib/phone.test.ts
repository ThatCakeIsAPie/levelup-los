import { describe, expect, it } from "vitest";
import {
  caretAfter,
  digitsBefore,
  displayPhone,
  formatPhone,
  normalizePhone,
  phoneHref,
} from "./phone";

describe("formatPhone (as you type)", () => {
  it("builds a US number step by step", () => {
    const steps = ["5", "51", "512", "5125", "51255", "512555", "5125550", "5125550102"];
    expect(steps.map(formatPhone)).toEqual([
      "5",
      "51",
      "512",
      "(512) 5",
      "(512) 55",
      "(512) 555",
      "(512) 555-0",
      "(512) 555-0102",
    ]);
  });

  it("reformats pasted or re-typed numbers", () => {
    expect(formatPhone("512-555-0102")).toBe("(512) 555-0102");
    expect(formatPhone("512.555.0102")).toBe("(512) 555-0102");
    expect(formatPhone("(512)5550102")).toBe("(512) 555-0102");
    expect(formatPhone("  512 555 0102")).toBe("(512) 555-0102");
  });

  it("keeps a leading 1 or +1 in front", () => {
    expect(formatPhone("1")).toBe("1");
    expect(formatPhone("15125550102")).toBe("1 (512) 555-0102");
    expect(formatPhone("+")).toBe("+");
    expect(formatPhone("+1")).toBe("+1");
    expect(formatPhone("+15")).toBe("+1 5");
    expect(formatPhone("+1 512555")).toBe("+1 (512) 555");
    expect(formatPhone("+1 (512) 555-0102")).toBe("+1 (512) 555-0102");
  });

  it("leaves international numbers as the person groups them", () => {
    expect(formatPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
    expect(formatPhone("+33 (0)1-23.45")).toBe("+33 (0)1-23.45");
    expect(formatPhone("+49  30   1234")).toBe("+49 30 1234");
    expect(formatPhone("+44 20 abc 79")).toBe("+44 20 79");
  });

  it("drops letters and stray characters", () => {
    expect(formatPhone("abc")).toBe("");
    expect(formatPhone("512a555")).toBe("(512) 555");
    expect(formatPhone("")).toBe("");
  });

  it("falls back to plain digits past 10 US digits", () => {
    expect(formatPhone("51255501021")).toBe("51255501021");
    expect(formatPhone("+1 512 555 0102 9")).toBe("+151255501029");
  });
});

describe("normalizePhone (stored form)", () => {
  it("stores full US numbers one way", () => {
    for (const s of [
      "5125550102",
      "512-555-0102",
      "(512) 555-0102",
      "1 512 555 0102",
      "+1 (512) 555-0102",
      "+15125550102",
    ])
      expect(normalizePhone(s)).toBe("(512) 555-0102");
  });

  it("keeps 7-digit local numbers readable", () => {
    expect(normalizePhone("5550110")).toBe("555-0110");
    expect(normalizePhone("555-0110")).toBe("555-0110");
  });

  it("keeps international numbers, trimming trailing separators", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(normalizePhone("+44 20 7946 0958 -")).toBe("+44 20 7946 0958");
  });

  it("keeps anything else as digits and empty as empty", () => {
    expect(normalizePhone("555")).toBe("555");
    expect(normalizePhone("")).toBe("");
    expect(normalizePhone("   ")).toBe("");
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("abc")).toBe("");
    expect(normalizePhone("+")).toBe("");
  });
});

describe("displayPhone", () => {
  it("shows older stored numbers in the new form", () => {
    expect(displayPhone("206-555-0107")).toBe("(206) 555-0107");
    expect(displayPhone("555-0110")).toBe("555-0110");
    expect(displayPhone("555")).toBe("555");
    expect(displayPhone(undefined)).toBe("");
    expect(displayPhone("call me")).toBe("call me");
  });
});

describe("caret helpers", () => {
  it("puts the caret after the same digits", () => {
    expect(digitsBefore("5125", 4)).toBe(4);
    expect(caretAfter("(512) 5", 4)).toBe(7);
    expect(digitsBefore("(512) 555-0102", 6)).toBe(3);
    expect(caretAfter("(512) 555-0102", 3)).toBe(4);
    expect(caretAfter("(512) 555-0102", 0)).toBe(0);
    expect(caretAfter("+1 (5", 2)).toBe(2);
  });

  it("builds tel links", () => {
    expect(phoneHref("+1 (512) 555-0102")).toBe("+15125550102");
  });
});
