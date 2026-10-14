import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { IS_SUPABASE, storageKey, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// TODO: type the client with the generated schema once the database agent
// writes src/data/remote/database.types.ts:
//   import type { Database } from "@/data/remote/database.types";
//   createClient<Database>(...)  and  SupabaseClient<Database>
// Until then queries are untyped; src/modules/login/auth.ts declares the few
// row shapes it reads.

/**
 * The one Supabase client, or null in "local" mode (the GitHub Pages demo
 * never talks to a database). Sessions persist in localStorage and refresh
 * automatically; sign-in links use the PKCE flow. The code in a sign-in link
 * is exchanged explicitly by /auth/callback (detectSessionInUrl is off so no
 * other page can consume it first).
 */
export const supabase: SupabaseClient | null = IS_SUPABASE
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: storageKey("auth"),
      },
    })
  : null;

/** The client, for code that only runs in "supabase" mode. */
export function getSupabase(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured (DATA_SOURCE is local)");
  return supabase;
}
