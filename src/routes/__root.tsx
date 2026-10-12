import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useSessionStore } from "@/stores/sessionStore";

import appCss from "../styles.css?url";
import { TopNav } from "@/components/TopNav";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
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
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
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
            href="/"
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
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "LevelUp LOS" },
      {
        name: "description",
        content: "Team, customer, and event management for direct sales leaders.",
      },
      { property: "og:title", content: "LevelUp LOS" },
      {
        property: "og:description",
        content: "Team, customer, and event management for direct sales leaders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "LevelUp LOS" },
      {
        name: "twitter:description",
        content: "Team, customer, and event management for direct sales leaders.",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex h-screen w-screen flex-col bg-background">
        <TopNav />
        <div className="flex-1 min-h-0">
          <SessionGate />
        </div>
      </div>
    </QueryClientProvider>
  );
}

function SessionGate() {
  const [mounted, setMounted] = useState(false);
  const user = useSessionStore((s) => s.user);
  // Gate on the rendered matches, not location: during the redirect, location
  // flips to /login before its matches load, and <Outlet /> would briefly
  // render the previous (user-requiring) route with a null user.
  const onLogin = useRouterState({ select: (s) => s.matches.some((m) => m.routeId === "/login") });
  const navigate = useNavigate();
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (mounted && !user && !onLogin) navigate({ to: "/login", replace: true });
  }, [mounted, user, onLogin, navigate]);
  if (!mounted) return null;
  if (!user && !onLogin) return null;
  return <Outlet />;
}
