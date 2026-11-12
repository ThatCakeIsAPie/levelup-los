import { useState } from "react";
import { Copy, KeyRound, Send } from "lucide-react";
import { toast } from "sonner";
import { SectionCard, Sensitive } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { CrmPerson } from "@/data";
import { inviteLink } from "./api";
import { openInviteDialog } from "./inviteDialogStore";
import { usePersonSignIn, withdrawPersonInvite } from "./personInvites";
import { inviteStatusLine, signInState } from "./personRules";

/**
 * "Sign-in" card on a profile: for a registered person who doesn't sign in yet,
 * an Invite button; once invited, when and until when, with Send again and
 * Withdraw. Nothing for people who already sign in, for yourself, for people
 * you may not invite, and for prospects and customers.
 */
export function SignInCard({ person }: { person: CrmPerson }) {
  const { eligible, invite } = usePersonSignIn(person);
  const [busy, setBusy] = useState(false);
  if (!eligible) return null;

  const state = signInState(invite);

  async function withdraw() {
    setBusy(true);
    const error = await withdrawPersonInvite(person.id);
    setBusy(false);
    if (error) toast.error(error);
    else toast("Invite withdrawn");
  }

  async function copy() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(inviteLink(invite.token));
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  return (
    <SectionCard title="Sign-in">
      <div className="flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-surface-2 text-muted-foreground">
          <KeyRound className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          {invite ? (
            <>
              <p className="text-[13px] font-semibold">Invited, not signed in yet</p>
              <p className="text-[12.5px] text-muted-foreground">{inviteStatusLine(invite)}</p>
              <p className="truncate text-[12.5px] text-muted-foreground">
                <Sensitive kind="email">{invite.email}</Sensitive>
              </p>
            </>
          ) : (
            <>
              <p className="text-[13px] font-semibold">No sign-in yet</p>
              <p className="text-[12.5px] text-muted-foreground">
                Invite <Sensitive kind="name">{person.name.split(" ")[0]}</Sensitive> to sign in to
                this record.
              </p>
            </>
          )}
        </div>
      </div>
      {invite ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openInviteDialog(person.id)}>
            <Send /> Send again
          </Button>
          {state === "open" && (
            <Button size="sm" variant="outline" onClick={copy}>
              <Copy /> Copy link
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={withdraw}>
            Withdraw
          </Button>
        </div>
      ) : (
        <div>
          <Button size="sm" onClick={() => openInviteDialog(person.id)}>
            <Send /> Invite
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
