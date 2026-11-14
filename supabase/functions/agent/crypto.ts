/** Hashing, key and code handling (web-standard crypto only: the same in Deno and Node). */

const enc = new TextEncoder();

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `crmak_` plus 43 URL-safe characters (256 random bits). Only its SHA-256 is ever stored. */
export const KEY_PREFIX = "crmak_";
const KEY_RE = /^bearer (crmak_[A-Za-z0-9_-]{43})$/i;

export function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return KEY_PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The key in an Authorization header, or null when the shape is wrong (no database call then). */
export function bearerKey(header: string | null): string | null {
  const m = KEY_RE.exec(header ?? "");
  return m ? m[1] : null;
}

const CODE_ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{16}$/;

/** A pairing code as typed (case, dashes and spaces ignored), or null when it cannot be one. */
export function normaliseCode(raw: string): string | null {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return CODE_ALPHABET.test(c) ? c : null;
}

/** The address a request came from, hashed so no address is ever stored. */
export function clientAddress(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ?? (headers.get("x-forwarded-for") ?? "").split(",")[0].trim()
  );
}
export async function addressHash(headers: Headers): Promise<string> {
  return (await sha256Hex("pair|" + clientAddress(headers))).slice(0, 32);
}

/** A label for a connection: control characters out, trimmed, at most 80 characters. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\p{Cc}/gu, "")
    .trim()
    .slice(0, 80);
}
