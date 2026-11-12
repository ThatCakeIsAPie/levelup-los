/** Database calls for person-bound invites ("supabase" mode only). */
import { getSupabase } from "@/lib/supabase";
import { friendlyAuthError } from "@/modules/login/authErrors";
import type { PersonInvite } from "./personRules";

interface InviteRow {
  token: string;
  email: string | null;
  created_at: string;
  expires_at: string;
}

const COLUMNS = "token, email, created_at, expires_at";

function fromRow(r: InviteRow): PersonInvite {
  return { token: r.token, email: r.email ?? "", createdAt: r.created_at, expiresAt: r.expires_at };
}

/** Whether the person already signs in (a member row with a user), and their open invite, if any. */
export async function fetchPersonInviteState(
  personId: string,
): Promise<{ hasLogin: boolean; invite: PersonInvite | null }> {
  const db = getSupabase();
  const [member, invite] = await Promise.all([
    db.from("members").select("user_id").eq("person_id", personId).maybeSingle(),
    db
      .from("invites")
      .select(COLUMNS)
      .eq("person_id", personId)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (member.error) throw member.error;
  if (invite.error) throw invite.error;
  return {
    hasLogin: Boolean((member.data as { user_id: string | null } | null)?.user_id),
    invite: invite.data ? fromRow(invite.data as InviteRow) : null,
  };
}

/**
 * Create the person's invite for `email`. The database fills in sponsor, stage
 * and name from the person and withdraws their previous unused invite.
 */
export async function createPersonInvite(
  personId: string,
  email: string,
): Promise<{ invite: PersonInvite | null; error: string | null }> {
  const { data, error } = await getSupabase()
    .from("invites")
    .insert({ person_id: personId, email: email.trim() })
    .select(COLUMNS)
    .single();
  if (error) {
    const refused = error.code === "42501" || /row-level security/i.test(error.message);
    return {
      invite: null,
      error: refused ? "You can't invite this person." : friendlyAuthError(error),
    };
  }
  return { invite: fromRow(data as InviteRow), error: null };
}

/** Withdraw the person's unused invite. Returns an error message or null. */
export async function deletePersonInvites(personId: string): Promise<string | null> {
  const { error } = await getSupabase()
    .from("invites")
    .delete()
    .eq("person_id", personId)
    .is("used_at", null);
  return error ? friendlyAuthError(error) : null;
}
