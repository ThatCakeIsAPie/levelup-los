/**
 * The sign-in email for an invite that someone else sends.
 *
 * The app's own client uses the PKCE flow: the code in a sign-in link can only
 * be exchanged in the browser that asked for it. That fits the invite page
 * (people ask for their own link) but not an inviter asking for someone else's,
 * so this uses a separate, throwaway client with the implicit flow. It keeps
 * no session and writes nothing to storage, so the inviter's own session is
 * untouched. The emailed link lands on /auth/callback with the tokens in the
 * URL fragment (`sessionFromLinkHash`).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { storageKey } from "@/lib/brand";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { callbackUrl } from "@/modules/login/auth";
import { friendlyAuthError } from "@/modules/login/authErrors";

/** A client that only sends sign-in mail: implicit flow, no session kept. */
export function createMailClient(url: string, key: string, fetchFn?: typeof fetch): SupabaseClient {
  return createClient(url, key, {
    auth: {
      flowType: "implicit",
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: storageKey("invite-mail"),
    },
    ...(fetchFn ? { global: { fetch: fetchFn } } : {}),
  });
}

let mailer: SupabaseClient | null = null;

/** Email the invitee a link that signs them in and opens the invite. Returns an error message or null. */
export async function sendInviteEmail(
  email: string,
  token: string,
  name?: string,
  client: SupabaseClient = (mailer ??= createMailClient(SUPABASE_URL, SUPABASE_ANON_KEY)),
): Promise<string | null> {
  const { error } = await client.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: callbackUrl({ invite: token }),
      shouldCreateUser: true,
      data: name?.trim() ? { name: name.trim() } : undefined,
    },
  });
  return error ? friendlyAuthError(error) : null;
}

export interface LinkTokens {
  accessToken: string;
  refreshToken: string;
}

/** The session tokens in a sign-in link's URL fragment (`#access_token=…&refresh_token=…`), or null. */
export function parseLinkTokens(hash: string): LinkTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

/**
 * Sign in with the tokens of an emailed invite link. Returns null when the URL
 * carries none (nothing to do), "" on success, or an error message.
 */
export async function sessionFromLinkHash(hash: string): Promise<string | null> {
  const tokens = parseLinkTokens(hash);
  if (!tokens) return null;
  const { error } = await getSupabase().auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  return error ? friendlyAuthError(error) : "";
}
