import { useState, type FormEvent } from "react";
import { Check, Copy, Loader2, Mail, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePerson, useStageNames, type CrmPerson } from "@/data";
import { inviteExistingPerson, usePersonInvite, type InviteResult } from "./personInvites";
import { inviteEmailProblem, shortDate } from "./personRules";
import type { InviteRequest } from "./inviteDialogStore";

import { Sensitive } from "@/components/brand";
import { sensitive } from "@/lib/sensitive";
type Sent = Extract<InviteResult, { ok: true }>;

/**
 * Confirm a person's email and send them an invite to sign in to their own
 * record. The same dialog serves the profile's Invite button, the people list
 * menu and the "Congrats" step after a card is moved into Registered.
 */
export function InvitePersonDialog({
  request,
  onClose,
}: {
  request: InviteRequest | null;
  onClose: () => void;
}) {
  const person = usePerson(request?.personId);
  const open = !!request && !!person;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        {request && person && (
          <InviteBody key={request.seq} person={person} mode={request.mode} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function InviteBody({
  person,
  mode,
  onClose,
}: {
  person: CrmPerson;
  mode: InviteRequest["mode"];
  onClose: () => void;
}) {
  const stages = useStageNames("recruiting");
  const { invite: existing } = usePersonInvite(person.id);
  const congrats = mode === "congrats";
  const [step, setStep] = useState<"ask" | "form">(congrats ? "ask" : "form");
  const [email, setEmail] = useState(existing?.email || person.email || "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent | null>(null);
  const first = person.name.split(" ")[0];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = inviteEmailProblem(email);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    const r = await inviteExistingPerson(person, email);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSent(r);
  }

  if (sent) return <InviteSent person={person} sent={sent} onClose={onClose} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {congrats ? (
            "Congrats!"
          ) : (
            <>
              Invite <Sensitive kind="name">{person.name}</Sensitive>
            </>
          )}
        </DialogTitle>
        <DialogDescription>
          {congrats ? (
            <>
              <Sensitive kind="name">{person.name}</Sensitive> moved to {stages.name("registered")}{" "}
              and is now an apprentice.
            </>
          ) : (
            <>
              We&rsquo;ll email <Sensitive kind="name">{first}</Sensitive> a link that signs them in
              to this record.
            </>
          )}
        </DialogDescription>
      </DialogHeader>

      {step === "ask" ? (
        <>
          <p className="text-[13px] text-muted-foreground">
            Want to invite <Sensitive kind="name">{first}</Sensitive> to sign in? We'll email a link
            that signs them in to this record.
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Not now
            </Button>
            <Button type="button" onClick={() => setStep("form")}>
              Invite {first}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form className="grid gap-4" onSubmit={submit} noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-person-email">Their email</Label>
            <Input
              id="invite-person-email"
              type="email"
              inputMode="email"
              autoComplete="off"
              autoFocus={congrats}
              {...sensitive("email")}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby="invite-person-hint"
              placeholder="name@example.com"
            />
            <p id="invite-person-hint" className="text-[12px] text-muted-foreground">
              {congrats
                ? "Without an email they can't sign in. We'll also save it on their record."
                : "They'll get an email with a link that signs them in to this record. We'll save the address on their record."}
            </p>
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] font-medium text-bad"
            >
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {congrats ? "Not now" : "Cancel"}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Mail aria-hidden="true" />
              )}
              Send invite
            </Button>
          </DialogFooter>
        </form>
      )}
    </>
  );
}

function InviteSent({
  person,
  sent,
  onClose,
}: {
  person: CrmPerson;
  sent: Sent;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const outcome = sent.email;

  async function copy() {
    try {
      await navigator.clipboard.writeText(sent.link);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {outcome.kind === "sent" ? (
            <>
              Invite sent to <Sensitive kind="email">{sent.invite.email}</Sensitive>
            </>
          ) : (
            <>
              Invite for <Sensitive kind="name">{person.name}</Sensitive>
            </>
          )}
        </DialogTitle>
        <DialogDescription>
          {outcome.kind === "sent" ? (
            <>
              <Sensitive kind="name">{person.name.split(" ")[0]}</Sensitive> can sign in to their
              record from the email.
            </>
          ) : outcome.kind === "demo" ? (
            "The demo does not send email. Share this link."
          ) : (
            "We couldn't send the email. Share the link yourself."
          )}
        </DialogDescription>
      </DialogHeader>
      {outcome.kind === "failed" && (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13px] text-warn-ink"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {outcome.reason}
        </p>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="invite-person-link">Invite link</Label>
        <div className="flex gap-2">
          <Input
            id="invite-person-link"
            readOnly
            value={sent.link}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-[12.5px]"
          />
          <Button type="button" onClick={copy} aria-label="Copy invite link" className="shrink-0">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Works once, until {shortDate(sent.invite.expiresAt)}.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}
