/** Pure invite rules (unit-tested). */

export type InviteStage = "prospect" | "apprentice";

/** Invites last 14 days. */
export const INVITE_DAYS = 14;

/** A row of the database's `get_invite(p_token)` preview (anon may call it). */
export interface InvitePreview {
  workspace_id: string;
  workspace_name: string;
  sponsor_name: string | null;
  stage: string;
  name: string | null;
  email: string | null;
  expires_at: string;
  is_valid: boolean;
}

export type InviteState = "valid" | "expired" | "used" | "notFound";

/**
 * The preview only says whether the invite is still valid; an invalid one
 * whose expiry is still ahead must have been used.
 */
export function inviteState(
  preview: InvitePreview | null | undefined,
  now = new Date(),
): InviteState {
  if (!preview) return "notFound";
  if (preview.is_valid) return "valid";
  return new Date(preview.expires_at).getTime() <= now.getTime() ? "expired" : "used";
}

/** Expiry timestamp for a new invite. */
export function inviteExpiry(now = new Date(), days = INVITE_DAYS): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

/** What went wrong accepting an invite, from the `accept_invite` error. */
export type AcceptFailure =
  "used" | "expired" | "notFound" | "alreadyMember" | "signedOut" | "other";

export function acceptFailure(
  error: { message?: string; code?: string } | null | undefined,
): AcceptFailure {
  const msg = (error?.message ?? "").toLowerCase();
  if (msg.includes("already been used")) return "used";
  if (msg.includes("expired")) return "expired";
  if (msg.includes("already a member") || error?.code === "23505") return "alreadyMember";
  if (msg.includes("not found") || error?.code === "P0002") return "notFound";
  if (msg.includes("sign in") || error?.code === "28000") return "signedOut";
  return "other";
}

/** Plain-language stage name for the invite copy. */
export function stageLabel(stage: string): string {
  if (stage === "apprentice") return "an apprentice";
  if (stage === "ibo") return "an IBO";
  return "a prospect";
}

/** True when the string is plausibly an email (the server validates for real). */
export function looksLikeEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}
