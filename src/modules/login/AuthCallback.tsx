import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { KeyRound, Link2Off, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabase } from "@/lib/supabase";
import { exchangeCode, takePendingInvite, updatePassword } from "./auth";
import { friendlyAuthError } from "./authErrors";
import { AuthHeading, AuthLayout, AuthLoading, FormError, StatusIcon } from "./AuthLayout";

export interface CallbackSearch {
  code?: string;
  invite?: string;
  next?: string;
  error?: string;
  error_code?: string;
  error_description?: string;
}

/**
 * One exchange per code: React StrictMode runs effects twice in development,
 * and a PKCE code can only be traded once.
 */
const exchanges = new Map<string, Promise<string | null>>();
function exchangeOnce(code: string): Promise<string | null> {
  let p = exchanges.get(code);
  if (!p) {
    p = exchangeCode(code);
    exchanges.set(code, p);
  }
  return p;
}

/** Errors can arrive in the query or (from the auth server) in the hash. */
function linkError(search: CallbackSearch): string | null {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const code = search.error_code ?? hash.get("error_code") ?? undefined;
  const description = search.error_description ?? hash.get("error_description") ?? undefined;
  const error = search.error ?? hash.get("error") ?? undefined;
  if (!code && !description && !error) return null;
  return friendlyAuthError({ code, message: description ?? error });
}

type State = { kind: "working" } | { kind: "error"; message: string } | { kind: "reset" };

/**
 * /auth/callback: where sign-in, sign-up and password-reset emails land.
 * Trades the link's code for a session, then continues to the invite being
 * accepted (if any), the "set a new password" form, or Home.
 */
export function AuthCallback({ search }: { search: CallbackSearch }) {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: "working" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fromLink = linkError(search);
      if (fromLink) {
        setState({ kind: "error", message: fromLink });
        return;
      }
      if (search.code) {
        const err = await exchangeOnce(search.code);
        if (cancelled) return;
        if (err) {
          // A refresh after a successful exchange reuses the code: fine if
          // we're already signed in.
          const { data } = await getSupabase().auth.getSession();
          if (cancelled) return;
          if (!data.session) {
            setState({ kind: "error", message: err });
            return;
          }
        }
      } else {
        const { data } = await getSupabase().auth.getSession();
        if (cancelled) return;
        if (!data.session) {
          setState({
            kind: "error",
            message: "This link is missing its sign-in code. Ask for a new one.",
          });
          return;
        }
      }
      if (search.next === "reset") {
        setState({ kind: "reset" });
        return;
      }
      const invite = search.invite ?? takePendingInvite();
      if (invite) navigate({ to: "/invite/$token", params: { token: invite }, replace: true });
      else navigate({ to: "/", replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [search, navigate]);

  if (state.kind === "working") return <AuthLoading label="Finishing sign-in…" />;

  if (state.kind === "reset")
    return <SetPassword onDone={() => navigate({ to: "/", replace: true })} />;

  return (
    <AuthLayout>
      <StatusIcon icon={Link2Off} tone="bad" />
      <AuthHeading title="That link didn't work">
        <p>{state.message}</p>
      </AuthHeading>
      <div>
        <Link to="/login" replace className={buttonVariants()}>
          Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}

/** After a password-reset link: choose a new password. */
function SetPassword({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 6) return setError("Pick a longer password (at least 6 characters).");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    const err = await updatePassword(password);
    setBusy(false);
    if (err) return setError(err);
    toast.success("Password updated");
    onDone();
  }

  return (
    <AuthLayout>
      <AuthHeading title="Set a new password">
        <p>You're signed in. Choose a new password for next time.</p>
      </AuthHeading>
      <form className="grid gap-4" onSubmit={submit} noValidate>
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-password">Type it again</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <FormError>{error}</FormError>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={busy}>
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound aria-hidden="true" />
            )}
            Save password
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Skip for now
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
