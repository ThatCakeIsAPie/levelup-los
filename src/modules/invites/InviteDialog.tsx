import { useState, type FormEvent } from "react";
import { Check, Copy, Database, Link2, Loader2, Send, Share2 } from "lucide-react";
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
import { useSession } from "@/data";
import { IS_SUPABASE } from "@/lib/config";
import { cn } from "@/lib/utils";
import { canInvite } from "@/modules/login/roles";
import { createInvite, type NewInvite } from "./api";
import { INVITE_DAYS, looksLikeEmail, type InviteStage } from "./rules";

/**
 * "Invite" button for page headers: shown to people with a team (leaders,
 * IBOs, apprentices). Opens the invite dialog.
 */
export function InviteButton({ className }: { className?: string }) {
  const user = useSession();
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  if (!canInvite(user?.role)) return null;
  return (
    <>
      <Button
        variant="outline"
        className={className}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
        aria-label="Invite someone"
      >
        <Send />
        <span className="hidden sm:inline">Invite</span>
      </Button>
      <InviteDialog key={formKey} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Create an invite link that signs a new person up under you. In the
 * browser-storage demo there are no accounts, so it only explains.
 */
export function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Invite someone</DialogTitle>
          <DialogDescription>
            They'll join your team right under you. Each link signs up one person and works for{" "}
            {INVITE_DAYS} days.
          </DialogDescription>
        </DialogHeader>
        {IS_SUPABASE ? (
          <InviteForm onClose={() => onOpenChange(false)} />
        ) : (
          <LocalModeNote onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function LocalModeNote({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="flex items-start gap-2.5 rounded-[10px] bg-info-soft px-3 py-2.5 text-[13px] text-info-ink">
        <Database className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Invites need the real database. This demo keeps everything in your browser, so there's no
          account for a new person to join. In the team's app, this creates a link you can text or
          email; opening it signs them up under you.
        </p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Got it</Button>
      </DialogFooter>
    </>
  );
}

const STAGES: { value: InviteStage; label: string; hint: string }[] = [
  { value: "prospect", label: "Prospect", hint: "Looking at the business" },
  { value: "apprentice", label: "Apprentice", hint: "Signed up, first year" },
];

function InviteForm({ onClose }: { onClose: () => void }) {
  const user = useSession();
  const [stage, setStage] = useState<InviteStage>("prospect");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<NewInvite | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (email.trim() && !looksLikeEmail(email)) return setError("That email doesn't look right.");
    setBusy(true);
    setError(null);
    const r = await createInvite({ sponsorPersonId: user.personId, stage, name, email });
    setBusy(false);
    if (r.error || !r.invite) return setError(r.error ?? "Couldn't create the invite.");
    setInvite(r.invite);
  }

  if (invite) {
    return (
      <InviteCreated
        invite={invite}
        who={name.trim() || undefined}
        onAnother={() => {
          setInvite(null);
          setName("");
          setEmail("");
        }}
        onClose={onClose}
      />
    );
  }

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">They start as</legend>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {STAGES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={stage === s.value}
              onClick={() => setStage(s.value)}
              className={cn(
                "grid gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                stage === s.value
                  ? "border-primary bg-primary-soft text-primary-ink"
                  : "border-line bg-surface hover:bg-surface-2",
              )}
            >
              <span className="text-[13px] font-bold">{s.label}</span>
              <span className="text-[12px] opacity-80">{s.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="invite-new-name">Their name (optional)</Label>
        <Input
          id="invite-new-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="So the invite greets them by name"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="invite-new-email">Their email (optional)</Label>
        <Input
          id="invite-new-email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Fills in the sign-up form for them"
        />
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
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Link2 aria-hidden="true" />
          )}
          Create invite link
        </Button>
      </DialogFooter>
    </form>
  );
}

function InviteCreated({
  invite,
  who,
  onAnother,
  onClose,
}: {
  invite: NewInvite;
  who?: string;
  onAnother: () => void;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const expires = new Date(invite.expiresAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function copy() {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="invite-link">{who ? `Invite link for ${who}` : "Invite link"}</Label>
        <div className="flex gap-2">
          <Input
            id="invite-link"
            readOnly
            value={invite.link}
            onFocus={(e) => e.currentTarget.select()}
            className="font-mono text-[12.5px]"
          />
          <Button type="button" onClick={copy} aria-label="Copy invite link" className="shrink-0">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
        <p className="text-[12px] text-muted-foreground">
          Send it by text or email. Works once, until {expires}.
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onAnother}>
          Invite someone else
        </Button>
        {canShare && (
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              navigator
                .share({ title: "Join the team on LevelUp LOS", url: invite.link })
                .catch(() => undefined)
            }
          >
            <Share2 aria-hidden="true" /> Share
          </Button>
        )}
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}
