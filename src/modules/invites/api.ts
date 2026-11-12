/** Invite calls against Supabase ("supabase" mode only). */
import { appUrl } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/modules/login/authErrors";
import { acceptFailure, type AcceptFailure, type InvitePreview } from "./rules";

/** Shareable absolute link for an invite token (respects the deploy base path). */
export function inviteLink(token: string): string {
  return appUrl(`invite/${encodeURIComponent(token)}`);
}

/** Preview an invite (who invited you, which team). Null when the token is unknown. */
export async function fetchInvite(
  token: string,
): Promise<{ preview: InvitePreview | null; error: string | null }> {
  const { data, error } = await getSupabase().rpc("get_invite", { p_token: token });
  if (error) return { preview: null, error: friendlyAuthError(error) };
  const rows = (data ?? []) as InvitePreview[];
  return { preview: rows[0] ?? null, error: null };
}

/** Join the team as the signed-in user. Returns the person id (new, or the existing one for a person invite). */
export async function acceptInvite(
  token: string,
): Promise<{ personId: string | null; failure: AcceptFailure | null; error: string | null }> {
  const { data, error } = await getSupabase().rpc("accept_invite", { p_token: token });
  if (error)
    return { personId: null, failure: acceptFailure(error), error: friendlyAuthError(error) };
  return { personId: (data as string | null) ?? null, failure: null, error: null };
}
