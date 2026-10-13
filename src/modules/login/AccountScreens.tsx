import { useState } from "react";
import { CloudOff, Loader2, LogOut, RefreshCw, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshAccount, signOut, useAccount, useAuthError } from "./auth";
import { AuthHeading, AuthLayout, StatusIcon } from "./AuthLayout";

/**
 * Signed in, but the account isn't on a team (no member row): typically
 * someone who signed up without an invite link.
 */
export function NoTeamScreen() {
  const account = useAccount();
  return (
    <AuthLayout
      headline="One step left: join your team."
      blurb="Your leader or sponsor sends you an invite link. Opening it puts you on the team, right under the person who invited you."
    >
      <StatusIcon icon={UsersRound} tone="info" />
      <AuthHeading title="You're not on a team yet">
        <p>
          You're signed in
          {account?.email ? (
            <>
              {" "}
              as <span className="font-semibold text-foreground">{account.email}</span>
            </>
          ) : null}
          , but this account isn't part of a team. Ask your leader for an invite link, then open it
          on this device.
        </p>
      </AuthHeading>
      <ul className="grid gap-1.5 rounded-card border border-line bg-surface p-4 text-[13px] text-muted-foreground">
        <li>
          <span className="font-semibold text-foreground">Already have a link?</span> Open it now;
          you'll join without signing in again.
        </li>
        <li>
          <span className="font-semibold text-foreground">Used a different email before?</span> Sign
          out and sign in with that one.
        </li>
      </ul>
      <Actions />
    </AuthLayout>
  );
}

/** Signed in, but the account couldn't be loaded (offline, server down…). */
export function AccountErrorScreen() {
  const error = useAuthError();
  return (
    <AuthLayout>
      <StatusIcon icon={CloudOff} tone="warn" />
      <AuthHeading title="We couldn't load your account">
        <p>{error ?? "Something went wrong."} Your data is safe; try again in a moment.</p>
      </AuthHeading>
      <Actions />
    </AuthLayout>
  );
}

function Actions() {
  const [checking, setChecking] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        disabled={checking}
        onClick={async () => {
          setChecking(true);
          try {
            await refreshAccount();
          } finally {
            setChecking(false);
          }
        }}
      >
        {checking ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <RefreshCw aria-hidden="true" />
        )}
        Check again
      </Button>
      <Button variant="ghost" onClick={() => void signOut()}>
        <LogOut aria-hidden="true" />
        Sign out
      </Button>
    </div>
  );
}
