import type { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/data";
import { IS_SUPABASE } from "@/lib/config";
import { startAuth, useAuthStatus } from "@/modules/login/auth";
import { useRemoteStore } from "@/data/remote/extras";
import { AuthLoading } from "@/modules/login/AuthLayout";
import { AccountErrorScreen, NoTeamScreen } from "@/modules/login/AccountScreens";

// Real accounts: follow Supabase Auth from the first render (no-op in the
// browser-storage demo).
startAuth();

function NotFoundComponent() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong. You can try again or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href={import.meta.env.BASE_URL}
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { title: "LevelUp LOS" },
      {
        name: "description",
        content: "Team, customer, and event management for direct sales leaders.",
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootComponent() {
  const { resolved } = useTheme();
  const desktop = useIsDesktop();
  return (
    <>
      {/* Renders route head() tags; React 19 hoists <title>/<meta> into <head>. */}
      <HeadContent />
      {/* One provider for every Tooltip in the app. */}
      <TooltipProvider delayDuration={200}>
        <SessionGate />
      </TooltipProvider>
      <Toaster
        theme={resolved}
        position={desktop ? "bottom-right" : "top-center"}
        richColors
        closeButton
      />
    </>
  );
}

/** Routes that render without a session (and without the shell). */
const PUBLIC_ROUTES = new Set<string>(["/login", "/auth/callback", "/invite/$token"]);

/**
 * Logged out: only the public routes render (without the shell); anything
 * else redirects to /login. Logged in: every route renders inside <AppShell>.
 *
 * With real accounts the status stays "loading" until the person's data has
 * loaded from the database ("Loading your team…"), so pages never render
 * with empty stores.
 *
 * With real accounts ("supabase" mode) there are more states: while the saved
 * session restores, a loading screen (never a flash of /login); signed in
 * without a team, the "not on a team yet" screen; signed in but the account
 * didn't load, a retry screen. /auth/callback and /invite/$token always
 * render, since they finish signing in and joining. /login leaves for Home
 * once signed in.
 */
function SessionGate() {
  const user = useSession();
  const status = useAuthStatus();
  // Real accounts: after sign-in the team's data loads before the app shows.
  const loadingData = useRemoteStore((s) => s.phase === "loading");
  // Gate on the rendered matches, not location: during the redirect, location
  // flips to /login before its matches load, and <Outlet /> would briefly
  // render the previous (user-requiring) route with a null user.
  const publicRoute = useRouterState({
    select: (s) => s.matches.find((m) => PUBLIC_ROUTES.has(m.routeId))?.routeId ?? null,
  });
  const onLogin = publicRoute === "/login";
  const navigate = useNavigate();

  // Where the gate sends you: /login when signed out, Home when a signed-in
  // account is still on /login.
  const toLogin = !user && !publicRoute && (status === "ready" || status === "signedOut");
  const toHome = IS_SUPABASE && onLogin && status === "ready" && !!user;
  useEffect(() => {
    if (toLogin) navigate({ to: "/login", replace: true });
    else if (toHome) navigate({ to: "/", replace: true });
  }, [toLogin, toHome, navigate]);

  // /auth/callback and /invite/$token handle every auth state themselves.
  const selfManaged = publicRoute !== null && !onLogin;
  if (!selfManaged) {
    if (status === "loading" || toHome)
      return <AuthLoading label={loadingData ? "Loading your team…" : undefined} />;
    if (status === "noTeam")
      return (
        <PublicFrame>
          <NoTeamScreen />
        </PublicFrame>
      );
    if (status === "error")
      return (
        <PublicFrame>
          <AccountErrorScreen />
        </PublicFrame>
      );
  }
  if (publicRoute) {
    return (
      <PublicFrame>
        <Outlet />
      </PublicFrame>
    );
  }
  if (!user) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

function PublicFrame({ children }: { children: ReactNode }) {
  return <div className="h-dvh overflow-y-auto bg-app">{children}</div>;
}
