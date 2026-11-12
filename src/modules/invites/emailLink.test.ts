import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMailClient, parseLinkTokens, sendInviteEmail } from "./emailLink";

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "user-1", exp: 4_102_444_800 })}.sig`;
const user = {
  id: "user-1",
  aud: "authenticated",
  email: "inviter@example.com",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};

interface Call {
  url: string;
  body: Record<string, unknown>;
}

describe("parseLinkTokens", () => {
  it("reads the session tokens of an implicit-flow link", () => {
    expect(
      parseLinkTokens(
        "#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink",
      ),
    ).toEqual({ accessToken: "a.b.c", refreshToken: "r1" });
  });
  it("is null without both tokens", () => {
    expect(parseLinkTokens("")).toBeNull();
    expect(parseLinkTokens("#access_token=a")).toBeNull();
    expect(parseLinkTokens("#error=access_denied&error_code=otp_expired")).toBeNull();
  });
});

describe("sending an invite email while signed in", () => {
  const calls: Call[] = [];
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {} });
    const json = url.includes("/token")
      ? {
          access_token: jwt,
          refresh_token: "refresh-1",
          expires_in: 3600,
          token_type: "bearer",
          user,
        }
      : {};
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  beforeEach(() => {
    calls.length = 0;
    vi.stubGlobal("window", { location: { origin: "https://app.test" } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for an implicit-flow link for the invitee and leaves the inviter's session alone", async () => {
    // The app's own client: PKCE, session kept in storage, signed in as the inviter.
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    const app = createClient("https://x.supabase.test", "anon", {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: false,
        storage,
        storageKey: "app-auth",
      },
      global: { fetch: fakeFetch },
    });
    await app.auth.signInWithPassword({ email: "inviter@example.com", password: "pw" });
    const before = JSON.stringify([...store.entries()]);
    expect((await app.auth.getSession()).data.session?.user.id).toBe("user-1");
    calls.length = 0;

    const mailer = createMailClient("https://x.supabase.test", "anon", fakeFetch);
    const error = await sendInviteEmail("sam@example.com", "tok123", "Sam Lee", mailer);

    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/auth/v1/otp");
    expect(calls[0].url).toContain(
      `redirect_to=${encodeURIComponent("https://app.test/auth/callback?invite=tok123")}`,
    );
    expect(calls[0].body).toMatchObject({
      email: "sam@example.com",
      create_user: true,
      data: { name: "Sam Lee" },
    });
    // Implicit flow: no PKCE challenge, so the link works in the invitee's own browser.
    expect(calls[0].body.code_challenge ?? null).toBeNull();

    // The inviter is still signed in, and nothing in their storage changed.
    expect((await app.auth.getSession()).data.session?.user.id).toBe("user-1");
    expect(JSON.stringify([...store.entries()])).toBe(before);
    expect([...store.keys()].some((k) => k.endsWith("code-verifier"))).toBe(false);
  });

  it("returns a plain message when the mail service refuses", async () => {
    const refusing = (async () =>
      new Response(JSON.stringify({ code: "over_email_send_rate_limit", msg: "rate limit" }), {
        status: 429,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const mailer = createMailClient("https://x.supabase.test", "anon", refusing);
    expect(await sendInviteEmail("sam@example.com", "tok", undefined, mailer)).toMatch(
      /Too many emails/,
    );
  });
});
