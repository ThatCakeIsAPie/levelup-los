/** Pure rules for inviting a person who is already on the roster (unit-tested). */
import type { Role } from "@/stores/sessionStore";
import { looksLikeEmail } from "./rules";

/** The open (unused) invite of one person, as the app shows it. */
export interface PersonInvite {
  token: string;
  /** The address the inviter confirmed; only this account can claim the record. */
  email: string;
  createdAt: string;
  expiresAt: string;
}

export type SignInState = "none" | "open" | "expired";

/** No invite, a live one, or one whose link has lapsed (Send again still works). */
export function signInState(
  invite: PersonInvite | null | undefined,
  now = new Date(),
): SignInState {
  if (!invite) return "none";
  return new Date(invite.expiresAt).getTime() > now.getTime() ? "open" : "expired";
}

export interface InviteViewer {
  personId: string;
  role: Role;
}

/**
 * Whether to offer "Invite" for a person. Mirrors `can_invite_person()` in the
 * database (the database enforces it; this only hides what would be refused)
 * plus the app rule that sign-ins are for registered people: apprentices and
 * IBOs, never prospects or customers.
 */
export function canOfferInvite(input: {
  viewer: InviteViewer;
  /** The viewer is a leader, or a deputy acting for one. */
  actsAsLeader: boolean;
  person: { id: string; bizClass: string };
  /** The person is in the viewer's own downline. */
  inDownline: boolean;
  hasLogin: boolean;
}): boolean {
  const { viewer, person } = input;
  if (viewer.role === "candidate") return false;
  if (person.id === viewer.personId) return false;
  if (person.bizClass !== "apprentice" && person.bizClass !== "ibo") return false;
  if (input.hasLogin) return false;
  return input.actsAsLeader || input.inDownline;
}

/** What is wrong with the address typed into the invite form, or null. */
export function inviteEmailProblem(email: string): string | null {
  if (!email.trim()) return "Add their email so they can sign in.";
  if (!looksLikeEmail(email)) return "That email doesn't look right.";
  return null;
}

/** "Oct 18" in the viewer's locale. */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The profile's line under "Sign-in" for a person with an invite. */
export function inviteStatusLine(invite: PersonInvite, now = new Date()): string {
  const sent = shortDate(invite.createdAt);
  const until = shortDate(invite.expiresAt);
  return signInState(invite, now) === "open"
    ? `Invited ${sent}, link expires ${until}`
    : `Invited ${sent}, link expired ${until}`;
}
