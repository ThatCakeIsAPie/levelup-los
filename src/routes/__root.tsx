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
import { useEffect } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsDesktop } from "@/hooks/use-media-query";
import { useTheme } from "@/lib/theme";
import { useSession } from "@/data";

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

/**
 * Logged out: only /login renders (without the shell); anything else
 * redirects there. Logged in: every route renders inside <AppShell>.
 */
function SessionGate() {
  const user = useSession();
  // Gate on the rendered matches, not location: during the redirect, location
  // flips to /login before its matches load, and <Outlet /> would briefly
  // render the previous (user-requiring) route with a null user.
  const onLogin = useRouterState({
    select: (s) => s.matches.some((m) => m.routeId === "/login"),
  });
  const navigate = useNavigate();
  useEffect(() => {
    if (!user && !onLogin) navigate({ to: "/login", replace: true });
  }, [user, onLogin, navigate]);
  if (onLogin) {
    return (
      <div className="h-dvh overflow-y-auto bg-app">
        <Outlet />
      </div>
    );
  }
  if (!user) return null;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
