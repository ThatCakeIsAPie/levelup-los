import { createFileRoute, redirect } from "@tanstack/react-router";
import { IS_SUPABASE } from "@/lib/config";
import { AuthCallback, type CallbackSearch } from "@/modules/login/AuthCallback";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export const Route = createFileRoute("/auth/callback")({
  head: () => ({ meta: [{ title: "Signing in — LevelUp LOS" }] }),
  // Supabase adds code / error params; invite and next are ours.
  validateSearch: (s: Record<string, unknown>): CallbackSearch => ({
    code: str(s.code),
    invite: str(s.invite),
    next: str(s.next),
    error: str(s.error),
    error_code: str(s.error_code),
    error_description: str(s.error_description),
  }),
  beforeLoad: () => {
    // The browser-storage demo has no accounts.
    if (!IS_SUPABASE) throw redirect({ to: "/login", replace: true });
  },
  component: CallbackRoute,
});

function CallbackRoute() {
  const search = Route.useSearch();
  return <AuthCallback search={search} />;
}
