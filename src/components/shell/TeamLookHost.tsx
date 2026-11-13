import { useEffect } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { useSessionStore } from "@/stores/sessionStore";
import { hideTeamLook, showSavedLook, useTeamLook } from "@/data";

/**
 * Keeps the page in step with the team's saved look (src/lib/teamLook.ts is the
 * one place that writes it): applied while a person is signed in and whenever
 * the saved look changes (after a load, a refresh or the leader's Save), and
 * dropped for the brand's own look, with the cache, when nobody is signed in.
 * While the session is still loading, the look restored before the first render
 * stays. Renders nothing.
 */
export function TeamLookHost() {
  const look = useTeamLook();
  const owner = useSessionStore(
    (s) => (IS_SUPABASE ? s.account?.userId : s.user?.personId) ?? null,
  );
  const signedIn = useSessionStore((s) =>
    IS_SUPABASE ? s.status === "ready" && !!s.user : !!s.user,
  );
  const signedOut = useSessionStore((s) =>
    IS_SUPABASE ? s.status === "signedOut" || s.status === "noTeam" : !s.user,
  );
  // A refresh hands back an equal look as a new object: apply only when something changed.
  const key = JSON.stringify(look);
  useEffect(() => {
    if (signedIn) void showSavedLook();
    else if (signedOut) hideTeamLook();
  }, [key, owner, signedIn, signedOut]);
  return null;
}
