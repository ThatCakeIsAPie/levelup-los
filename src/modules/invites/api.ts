/** Invite calls against Supabase ("supabase" mode only). */
import { appUrl } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/modules/login/authErrors";
import {
  acceptFailure,
  inviteExpiry,
  type AcceptFailure,
  type InvitePreview,
  type InviteStage,
} from "./rules";

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

/** Join the team as the signed-in user. Returns the new person id. */
export async function acceptInvite(
  token: string,
): Promise<{ personId: string | null; failure: AcceptFailure | null; error: string | null }> {
  const { data, error } = await getSupabase().rpc("accept_invite", { p_token: token });
  if (error)
    return { personId: null, failure: acceptFailure(error), error: friendlyAuthError(error) };
  return { personId: (data as string | null) ?? null, failure: null, error: null };
}

export interface NewInvite {
  token: string;
  expiresAt: string;
  link: string;
}

/**
 * Create an invite in the caller's workspace with the caller as sponsor
 * (workspace_id and created_by default to the caller on the server).
 */
export async function createInvite(input: {
  sponsorPersonId: string;
  stage: InviteStage;
  name?: string;
  email?: string;
}): Promise<{ invite: NewInvite | null; error: string | null }> {
  const { data, error } = await getSupabase()
    .from("invites")
    .insert({
      sponsor_person_id: input.sponsorPersonId,
      stage: input.stage,
      name: input.name?.trim() || null,
      email: input.email?.trim() || null,
      expires_at: inviteExpiry(),
    })
    .select("token, expires_at")
    .single();
  if (error) {
    const rls = error.code === "42501" || /row-level security/i.test(error.message);
    return {
      invite: null,
      error: rls
        ? "You can't invite people from this account yet. Ask your leader."
        : friendlyAuthError(error),
    };
  }
  const row = data as { token: string; expires_at: string };
  return {
    invite: { token: row.token, expiresAt: row.expires_at, link: inviteLink(row.token) },
    error: null,
  };
}
