import { useState, type FormEvent } from "react";
import { ChevronRight, KeyRound, Loader2, Mail, Wrench } from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { roleLabel } from "@/data";
import { looksLikeEmail } from "@/modules/invites/rules";
import { sendPasswordReset, sendSignInLink, signInWithPassword } from "./auth";
import { AuthHeading, FormError } from "./AuthLayout";
import { DEV_ACCOUNTS, DEV_PASSWORD, ROLE_STAGE } from "./demoRoles";
import { SentPanel } from "./SentPanel";

type Mode = "link" | "password" | "forgot";

/**
 * Real sign-in ("supabase" mode): an emailed sign-in link first, a password
 * as the alternative, and "Forgot password" for a reset link. Signing in
 * updates the session store; SessionGate then leaves /login.
 */
export function SignInForm() {
  const [mode, setMode] = useState<Mode>("link");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<"signin" | "reset" | null>(null);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!looksLikeEmail(email)) {
      setError("Enter the email address you were invited with.");
      return;
    }
    if (mode === "password" && !password) {
      setError("Enter your password.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "link") {
        const err = await sendSignInLink(email);
        if (err) setError(err);
        else setSent("signin");
      } else if (mode === "forgot") {
        const err = await sendPasswordReset(email);
        if (err) setError(err);
        else setSent("reset");
      } else {
        const err = await signInWithPassword(email, password);
        if (err) setError(err);
        // Success: the auth listener loads the account and the gate moves on.
      }
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <SentPanel
        email={email.trim()}
        kind={sent}
        onBack={() => {
          setSent(null);
          setMode("link");
        }}
      />
    );
  }

  const title = mode === "forgot" ? "Reset your password" : "Sign in";
  const lead =
    mode === "forgot"
      ? "We'll email you a link to set a new password."
      : mode === "password"
        ? "Sign in with your email and password."
        : "Enter your email and we'll send you a link that signs you in. No password needed.";

  return (
    <>
      <AuthHeading title={title}>
        <p>{lead}</p>
      </AuthHeading>

      <form className="grid gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="signin-email">Email</Label>
          <Input
            id="signin-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {mode === "password" && (
          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="signin-password">Password</Label>
              <button
                type="button"
                onClick={() => switchMode("forgot")}
                className="rounded-sm text-[12.5px] font-semibold text-primary-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Forgot password?
              </button>
            </div>
            <Input
              id="signin-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}

        <FormError>{error}</FormError>

        <Button type="submit" size="lg" disabled={busy} className="w-full">
          {busy ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : mode === "password" ? (
            <KeyRound aria-hidden="true" />
          ) : (
            <Mail aria-hidden="true" />
          )}
          {mode === "link"
            ? "Email me a sign-in link"
            : mode === "forgot"
              ? "Email me a reset link"
              : "Sign in"}
        </Button>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[13px]">
          {mode !== "link" && (
            <ModeLink onClick={() => switchMode("link")}>Email me a sign-in link instead</ModeLink>
          )}
          {mode !== "password" && (
            <ModeLink onClick={() => switchMode("password")}>
              {mode === "forgot" ? "Back to password sign-in" : "Use a password instead"}
            </ModeLink>
          )}
        </div>
      </form>

      <p className="text-center text-[12.5px] text-muted-foreground">
        New here? Ask your leader for an invite link. It sets up your account.
      </p>

      {DEV_ACCOUNTS.length > 0 && <DevAccounts onError={setError} />}
    </>
  );
}

function ModeLink({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-sm font-semibold text-primary-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}

/** Development only: one-click sign-in as the seeded local-database users. */
function DevAccounts({ onError }: { onError: (e: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section
      aria-labelledby="dev-accounts"
      className="grid gap-2.5 rounded-card border border-dashed border-line p-3"
    >
      <h3
        id="dev-accounts"
        className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-muted-foreground"
      >
        <Wrench className="size-3.5" aria-hidden="true" />
        Demo accounts · development only
      </h3>
      <ul className="grid gap-1.5">
        {DEV_ACCOUNTS.map((a) => (
          <li key={a.email}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(a.email);
                onError(null);
                const err = await signInWithPassword(a.email, DEV_PASSWORD);
                setBusy(null);
                if (err) onError(`${err} (Is the local database seeded? npx supabase db reset)`);
              }}
              className="group grid w-full grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              <PersonAvatar name={a.name} stage={ROLE_STAGE[a.role]} size="md" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold">
                  {a.name}{" "}
                  <span className="font-normal text-muted-foreground">
                    · {a.label ?? roleLabel[a.role]}
                  </span>
                </span>
                <span className="block truncate text-[12px] text-muted-foreground">{a.email}</span>
              </span>
              {busy === a.email ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <ChevronRight
                  className="size-4 text-faint group-hover:text-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
