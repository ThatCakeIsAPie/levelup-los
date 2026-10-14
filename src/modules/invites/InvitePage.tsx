import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarX2,
  CircleCheck,
  CloudOff,
  KeyRound,
  Link2Off,
  Loader2,
  LogOut,
  Mail,
  PartyPopper,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { PersonAvatar } from "@/components/brand";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IS_SUPABASE } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  clearPendingInvite,
  refreshAccount,
  sendSignInLink,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  useAccount,
  useAuthStatus,
} from "@/modules/login/auth";
import {
  AuthHeading,
  AuthLayout,
  AuthLoading,
  FormError,
  StatusIcon,
} from "@/modules/login/AuthLayout";
import { SentPanel } from "@/modules/login/SentPanel";
import { acceptInvite, fetchInvite } from "./api";
import { inviteState, looksLikeEmail, stageLabel, type InvitePreview } from "./rules";

/**
 * /invite/$token: who invited you and to which team; sign up or sign in
 * (email link or password); then accept the invite, which creates your
 * person under the sponsor, and land on Home.
 */
export function InvitePage({ token }: { token: string }) {
  if (!IS_SUPABASE) return <LocalModeInvite />;
  return <RemoteInvite token={token} />;
}

function RemoteInvite({ token }: { token: string }) {
  const status = useAuthStatus();
  const query = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      const r = await fetchInvite(token);
      if (r.error) throw new Error(r.error);
      return r.preview;
    },
    retry: 1,
    staleTime: 30_000,
  });

  if (query.isPending || status === "loading") return <AuthLoading label="Opening your invite…" />;

  if (query.isError) {
    return (
      <AuthLayout>
        <StatusIcon icon={CloudOff} tone="warn" />
        <AuthHeading title="We couldn't open this invite">
          <p>{query.error.message}</p>
        </AuthHeading>
        <div>
          <Button variant="outline" onClick={() => query.refetch()}>
            <RefreshCw aria-hidden="true" /> Try again
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const preview = query.data;
  const state = inviteState(preview);
  // A signed-in member who just used this invite sees it as "used": send them home.
  if (state !== "valid" || !preview) {
    return <InvalidInvite state={state} preview={preview} signedIn={status === "ready"} />;
  }

  return (
    <AuthLayout
      headline={`Welcome to ${preview.workspace_name}.`}
      blurb="LevelUp LOS is where the team keeps track of people, customers and events, and talks it all through."
    >
      <InviteHeader preview={preview} />
      {status === "signedOut" && <JoinForm token={token} preview={preview} />}
      {status === "noTeam" && <Accepting token={token} preview={preview} />}
      {status === "ready" && <AlreadyOnTeam />}
      {status === "error" && <AccountLoadError />}
    </AuthLayout>
  );
}

function InviteHeader({ preview }: { preview: InvitePreview }) {
  const sponsor = preview.sponsor_name ?? "Someone on the team";
  return (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5">
      <PersonAvatar name={sponsor} stage="ibo" size="lg" />
      <p className="min-w-0 text-[13px] text-muted-foreground">
        <span className="block text-sm font-bold text-foreground">{sponsor}</span>
        invited you to join{" "}
        <span className="font-semibold text-foreground">{preview.workspace_name}</span> as{" "}
        {stageLabel(preview.stage)}.
      </p>
    </div>
  );
}

type JoinMode = "link" | "new" | "existing";

function JoinForm({ token, preview }: { token: string; preview: InvitePreview }) {
  const [mode, setMode] = useState<JoinMode>("link");
  const [name, setName] = useState(preview.name ?? "");
  const [email, setEmail] = useState(preview.email ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"signin" | "confirm" | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (mode !== "existing" && !name.trim() && !preview.name) return setError("Enter your name.");
    if (!looksLikeEmail(email)) return setError("Enter your email address.");
    if (mode !== "link" && password.length < 6)
      return setError(
        mode === "new" ? "Pick a password with at least 6 characters." : "Enter your password.",
      );
    setBusy(true);
    setError(null);
    try {
      if (mode === "link") {
        const err = await sendSignInLink(email, { invite: token, name, createUser: true });
        if (err) setError(err);
        else setSent("signin");
      } else if (mode === "new") {
        const r = await signUpWithPassword(email, password, { name, invite: token });
        if (r.error) {
          setError(r.error);
          if (/already an account/.test(r.error)) setMode("existing");
        } else if (r.needsConfirm) setSent("confirm");
        // Otherwise signed in: status becomes "noTeam" and <Accepting> joins.
      } else {
        const err = await signInWithPassword(email, password);
        if (err) setError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) return <SentPanel email={email.trim()} kind={sent} onBack={() => setSent(null)} />;

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <AuthHeading
        title={
          preview.name ? `Hi ${preview.name.split(" ")[0]}, let's get you in` : "Let's get you in"
        }
      >
        <p>
          You'll join right under {preview.sponsor_name?.split(" ")[0] ?? "your sponsor"}. Use your
          email; we'll send a link that signs you in, or you can pick a password.
        </p>
      </AuthHeading>

      <div
        role="tablist"
        aria-label="How to sign in"
        className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1 text-[12.5px] font-semibold"
      >
        {(
          [
            ["link", "Email link"],
            ["new", "New password"],
            ["existing", "I have an account"],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cn(
              "rounded-md px-2 py-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              mode === m
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== "existing" && !preview.name && (
        <div className="grid gap-1.5">
          <Label htmlFor="invite-name">Your name</Label>
          <Input
            id="invite-name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="First and last name"
          />
        </div>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="invite-email">Email</Label>
        <Input
          id="invite-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </div>

      {mode !== "link" && (
        <div className="grid gap-1.5">
          <Label htmlFor="invite-password">
            {mode === "new" ? "Choose a password" : "Password"}
          </Label>
          <Input
            id="invite-password"
            type="password"
            autoComplete={mode === "new" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === "new" && (
            <p className="text-[12px] text-muted-foreground">At least 6 characters.</p>
          )}
        </div>
      )}

      <FormError>{error}</FormError>

      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : mode === "link" ? (
          <Mail aria-hidden="true" />
        ) : (
          <KeyRound aria-hidden="true" />
        )}
        {mode === "link"
          ? "Email me a sign-in link"
          : mode === "new"
            ? "Create account and join"
            : "Sign in and join"}
      </Button>
    </form>
  );
}

/** Signed in without a team: accept the invite once, then go Home. */
function Accepting({ token, preview }: { token: string; preview: InvitePreview }) {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const r = await acceptInvite(token);
      if (r.error) {
        setError(
          r.failure === "used"
            ? "This invite was already used. Ask for a new link."
            : r.failure === "expired"
              ? "This invite has expired. Ask for a new link."
              : r.error,
        );
        return;
      }
      clearPendingInvite();
      await refreshAccount();
      toast.success(`Welcome to ${preview.workspace_name}!`);
      navigate({ to: "/", replace: true });
    })();
  }, [token, preview.workspace_name, navigate, attempt]);

  if (error) {
    return (
      <div className="grid gap-4">
        <FormError>{error}</FormError>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setError(null);
              started.current = false;
              setAttempt((n) => n + 1);
            }}
          >
            <RefreshCw aria-hidden="true" /> Try again
          </Button>
          <Button variant="ghost" onClick={() => void signOut()}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Joining {preview.workspace_name}…
    </p>
  );
}

/** Signed in, but the account didn't load: retry before deciding anything. */
function AccountLoadError() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-3">
      <FormError>We couldn't load your account. Check your connection and try again.</FormError>
      <div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await refreshAccount().finally(() => setBusy(false));
          }}
        >
          <RefreshCw aria-hidden="true" /> Try again
        </Button>
      </div>
    </div>
  );
}

/** Opened while already signed in as a team member. */
function AlreadyOnTeam() {
  const account = useAccount();
  return (
    <div className="grid gap-4 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <UserRoundCheck className="mt-0.5 size-5 shrink-0 text-primary-ink" aria-hidden="true" />
        <p className="text-[13px] text-muted-foreground">
          You're signed in as{" "}
          <span className="font-semibold text-foreground">{account?.email ?? "a team member"}</span>
          {account?.workspaceName ? <>, already on {account.workspaceName}</> : null}. This invite
          is for someone new: sign out to use it with a different email, or pass the link on.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to="/" className={buttonVariants()}>
          Go to Home
        </Link>
        <Button variant="ghost" onClick={() => void signOut()}>
          <LogOut aria-hidden="true" /> Sign out
        </Button>
      </div>
    </div>
  );
}

function InvalidInvite({
  state,
  preview,
  signedIn,
}: {
  state: "expired" | "used" | "notFound" | "valid";
  preview: InvitePreview | null;
  signedIn: boolean;
}) {
  const sponsor = preview?.sponsor_name?.split(" ")[0];
  const ask = sponsor ? `Ask ${sponsor} for a new link.` : "Ask whoever sent it for a new link.";
  const content =
    state === "expired"
      ? {
          icon: CalendarX2,
          title: "This invite has expired",
          body: `Invite links work for 14 days. ${ask}`,
        }
      : state === "used"
        ? {
            icon: signedIn ? CircleCheck : PartyPopper,
            title: "This invite was already used",
            body: signedIn
              ? "You're on the team already. Head to Home to get going."
              : `Each link signs up one person. If that was you, sign in with your email. If not, ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`,
          }
        : {
            icon: Link2Off,
            title: "We couldn't find this invite",
            body: "The link may be incomplete. Copy the whole link from the message you got, or ask for a new one.",
          };
  return (
    <AuthLayout>
      <StatusIcon icon={content.icon} tone={state === "used" ? "info" : "bad"} />
      <AuthHeading title={content.title}>
        <p>{content.body}</p>
      </AuthHeading>
      <div>
        {signedIn ? (
          <Link to="/" className={buttonVariants()}>
            Go to Home
          </Link>
        ) : (
          <Link to="/login" className={buttonVariants({ variant: "outline" })}>
            Go to sign in
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}

/** The browser-storage demo has no accounts, so invite links can't work. */
function LocalModeInvite() {
  return (
    <AuthLayout>
      <StatusIcon icon={Link2Off} tone="info" />
      <AuthHeading title="Invites need the real app">
        <p>
          This is the sandbox demo: everything lives in your browser, so there are no accounts to
          join. In the team's real app this link signs you up right under the person who invited
          you.
        </p>
      </AuthHeading>
      <div>
        <Link to="/login" className={buttonVariants()}>
          Try the demo instead
        </Link>
      </div>
    </AuthLayout>
  );
}
