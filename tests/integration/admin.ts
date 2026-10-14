/**
 * A service-role client for the integration tests' cleanup only: some rows a
 * test causes can't be removed by the people who caused them (activity
 * entries, answered stat requests, notifications for others), but the seed
 * must stay exactly as `npm run db:test` expects it.
 *
 * The key is the local stack's (`npx supabase status -o env`), or
 * SUPABASE_SERVICE_ROLE_KEY when set. Never used by the app.
 */
import { execSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

function serviceRoleKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  const out = execSync("npx supabase status -o env", { encoding: "utf8", stdio: "pipe" });
  const m = /^SERVICE_ROLE_KEY="?([^"\r\n]+)"?/m.exec(out);
  if (!m) throw new Error("No SERVICE_ROLE_KEY in `supabase status` (is the local stack running?)");
  return m[1];
}

export function adminClient(): SupabaseClient {
  admin ??= createClient(import.meta.env.VITE_SUPABASE_URL as string, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return admin;
}

/** Fail loudly if a cleanup step didn't work (a silent leftover breaks db:test later). */
export async function must(
  q: PromiseLike<{ error: { message: string } | null }>,
  what: string,
): Promise<void> {
  const { error } = await q;
  if (error) throw new Error(`cleanup (${what}): ${error.message}`);
}
