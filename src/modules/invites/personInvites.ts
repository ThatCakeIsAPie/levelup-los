/**
 * Inviting a person who is already on the roster to sign in to their record:
 * the actions the profile card, the people list and the "Congrats" dialog share
 * (`inviteExistingPerson`, `withdrawPersonInvite`) and the hooks that read the
 * state (`usePersonInvite`, `usePersonSignIn`).
 *
 * Real accounts: the invite is a row in `invites` with `person_id` set (the
 * database picks sponsor and stage from the person), the email goes out from
 * the browser. Demo: the invite lives in `localInvites` and no email is sent.
 */
import { useEffect, useMemo, useState } from "react";
import {
  DEMO_USERS,
  updatePerson,
  useActingFor,
  useCurrentUser,
  useDownline,
  type CrmPerson,
} from "@/data";
import { whenIdle } from "@/data/remote";
import { IS_SUPABASE } from "@/lib/config";
import { inviteLink } from "./api";
import { sendInviteEmail } from "./emailLink";
import { localToken, setPersonInvite, usePersonInviteStore } from "./localInvites";
import { createPersonInvite, deletePersonInvites, fetchPersonInviteState } from "./personInviteApi";
import { canOfferInvite, type PersonInvite } from "./personRules";
import { inviteExpiry } from "./rules";

export type EmailOutcome =
  /** The email went out. */
  | { kind: "sent" }
  /** The built-in mail sender refused or failed: the link still works. */
  | { kind: "failed"; reason: string }
  /** The demo never sends email. */
  | { kind: "demo" };

export type InviteResult =
  | { ok: true; invite: PersonInvite; link: string; email: EmailOutcome }
  | { ok: false; error: string };

/**
 * Invite `person` to sign in at `email`: save the address on their record when
 * it changed, create the invite (replacing any unused one), send the email.
 */
export async function inviteExistingPerson(
  person: Pick<CrmPerson, "id" | "name" | "email">,
  email: string,
): Promise<InviteResult> {
  const address = email.trim();
  if (address !== (person.email ?? "").trim()) updatePerson(person.id, { email: address });

  if (!IS_SUPABASE) {
    const now = new Date();
    const invite: PersonInvite = {
      token: localToken(),
      email: address,
      createdAt: now.toISOString(),
      expiresAt: inviteExpiry(now),
    };
    setPersonInvite(person.id, invite);
    return { ok: true, invite, link: inviteLink(invite.token), email: { kind: "demo" } };
  }

  // The new address and a registration just made are written by now.
  await whenIdle();
  const created = await createPersonInvite(person.id, address);
  if (!created.invite) return { ok: false, error: created.error ?? "Couldn't create the invite." };
  setPersonInvite(person.id, created.invite);
  const sendError = await sendInviteEmail(address, created.invite.token, person.name).catch(
    () => "We couldn't reach the email service.",
  );
  return {
    ok: true,
    invite: created.invite,
    link: inviteLink(created.invite.token),
    email: sendError ? { kind: "failed", reason: sendError } : { kind: "sent" },
  };
}

/** Withdraw the person's unused invite. Returns an error message or null. */
export async function withdrawPersonInvite(personId: string): Promise<string | null> {
  if (IS_SUPABASE) {
    const error = await deletePersonInvites(personId);
    if (error) return error;
  }
  setPersonInvite(personId, null);
  return null;
}

/**
 * Registration was undone: the person is a prospect again, so their unused
 * invite goes. (With real accounts the database withdraws it in the same
 * statement as the undo; this keeps the app's copy in step.)
 */
export function forgetPersonInvite(personId: string): void {
  setPersonInvite(personId, null);
}

/** Whether the person already signs in, and their open invite. `ready` once known. */
export function usePersonInvite(personId: string): {
  ready: boolean;
  hasLogin: boolean;
  invite: PersonInvite | null;
} {
  const invite = usePersonInviteStore((s) => s.invites[personId] ?? null);
  const [remoteLogin, setRemoteLogin] = useState<boolean | null>(null);

  useEffect(() => {
    if (!IS_SUPABASE) return;
    let live = true;
    fetchPersonInviteState(personId).then(
      (r) => {
        if (!live) return;
        setPersonInvite(personId, r.invite);
        setRemoteLogin(r.hasLogin);
      },
      () => undefined, // Unknown: the invite UI stays hidden.
    );
    return () => {
      live = false;
    };
  }, [personId]);

  if (!IS_SUPABASE) {
    return { ready: true, hasLogin: DEMO_USERS.some((u) => u.personId === personId), invite };
  }
  return { ready: remoteLogin !== null, hasLogin: remoteLogin ?? false, invite };
}

/** Whether to offer the invite for `person` to the viewer, with the person's open invite. */
export function usePersonSignIn(person: CrmPerson): {
  ready: boolean;
  eligible: boolean;
  invite: PersonInvite | null;
} {
  const me = useCurrentUser();
  const downline = useDownline(me.personId);
  const actingFor = useActingFor();
  const { ready, hasLogin, invite } = usePersonInvite(person.id);
  const inDownline = useMemo(() => downline.some((p) => p.id === person.id), [downline, person.id]);
  const eligible =
    ready &&
    canOfferInvite({
      viewer: { personId: me.personId, role: me.role },
      actsAsLeader: me.role === "leader" || actingFor.length > 0,
      person,
      inDownline,
      hasLogin,
    });
  return { ready, eligible, invite };
}
