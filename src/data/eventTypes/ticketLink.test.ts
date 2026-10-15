import { describe, expect, it } from "vitest";
import { cleanTicketUrl, ticketHost } from "./ticketLink";

describe("cleanTicketUrl", () => {
  it("keeps http(s) links", () => {
    expect(cleanTicketUrl("https://tickets.example.com/fall")).toBe(
      "https://tickets.example.com/fall",
    );
    expect(cleanTicketUrl("  http://example.com  ")).toBe("http://example.com/");
  });

  it("adds https:// to a bare link", () => {
    expect(cleanTicketUrl("venmo.com/u/levelup")).toBe("https://venmo.com/u/levelup");
  });

  it("rejects other schemes, spaces and non-links", () => {
    expect(cleanTicketUrl("javascript:alert(1)")).toBeNull();
    expect(cleanTicketUrl("mailto:a@b.com")).toBeNull();
    expect(cleanTicketUrl("pay me on venmo")).toBeNull();
    expect(cleanTicketUrl("localhost")).toBeNull();
    expect(cleanTicketUrl("")).toBeNull();
    expect(cleanTicketUrl(undefined)).toBeNull();
    expect(cleanTicketUrl(`https://example.com/${"a".repeat(2000)}`)).toBeNull();
  });
});

describe("ticketHost", () => {
  it("shows the site without www", () => {
    expect(ticketHost("https://www.venmo.com/u/x")).toBe("venmo.com");
    expect(ticketHost("nope")).toBe("");
  });
});
