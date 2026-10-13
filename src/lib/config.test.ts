import { describe, expect, it } from "vitest";
import { absoluteAppUrl, resolveDataSource } from "./config";

const URL_ = "http://127.0.0.1:54321";
const KEY = "anon-key";

describe("resolveDataSource", () => {
  it("defaults to supabase when both connection values are set", () => {
    expect(resolveDataSource({ VITE_SUPABASE_URL: URL_, VITE_SUPABASE_ANON_KEY: KEY })).toEqual({
      source: "supabase",
    });
  });
  it("defaults to local without them", () => {
    expect(resolveDataSource({}).source).toBe("local");
    expect(resolveDataSource({ VITE_SUPABASE_URL: URL_ }).source).toBe("local");
    expect(resolveDataSource({ VITE_SUPABASE_URL: " ", VITE_SUPABASE_ANON_KEY: KEY }).source).toBe(
      "local",
    );
  });
  it("honours an explicit local even when configured (the Pages build)", () => {
    expect(
      resolveDataSource({
        VITE_DATA_SOURCE: "local",
        VITE_SUPABASE_URL: URL_,
        VITE_SUPABASE_ANON_KEY: KEY,
      }),
    ).toEqual({ source: "local" });
  });
  it("honours an explicit supabase only when configured", () => {
    expect(
      resolveDataSource({
        VITE_DATA_SOURCE: "Supabase",
        VITE_SUPABASE_URL: URL_,
        VITE_SUPABASE_ANON_KEY: KEY,
      }).source,
    ).toBe("supabase");
    const missing = resolveDataSource({ VITE_DATA_SOURCE: "supabase" });
    expect(missing.source).toBe("local");
    expect(missing.warning).toMatch(/missing/);
  });
  it("warns about unknown values and falls back to the default", () => {
    const r = resolveDataSource({
      VITE_DATA_SOURCE: "firebase",
      VITE_SUPABASE_URL: URL_,
      VITE_SUPABASE_ANON_KEY: KEY,
    });
    expect(r.source).toBe("supabase");
    expect(r.warning).toMatch(/Unknown/);
  });
});

describe("absoluteAppUrl", () => {
  it("joins origin, base and path", () => {
    expect(absoluteAppUrl("http://localhost:5176", "/", "/auth/callback")).toBe(
      "http://localhost:5176/auth/callback",
    );
    expect(absoluteAppUrl("https://thatcakeisapie.github.io", "/levelup-los/", "invite/abc")).toBe(
      "https://thatcakeisapie.github.io/levelup-los/invite/abc",
    );
    expect(absoluteAppUrl("https://x.dev", "/app", "auth/callback?invite=t")).toBe(
      "https://x.dev/app/auth/callback?invite=t",
    );
  });
});
