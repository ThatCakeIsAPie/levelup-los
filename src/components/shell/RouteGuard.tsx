import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { LockKeyhole, Network, Sparkles, UserPlus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FEATURES,
  routeAccess,
  useCurrentUser,
  useUnlocks,
  useVisibleCustomers,
  type LockReason,
} from "@/data";

/** The app path without the deployment's base path (GitHub Pages serves under /levelup-los/). */
function appPath(pathname: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/+$/, "");
  return base && pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

/**
 * Pages that aren't unlocked for this person can't be reached by URL either:
 * they get a friendly panel saying what opens them (src/data/unlocks.ts
 * `routeAccess`). Row-level security already limits the data; this is the
 * UI side.
 */
export function RouteGuard({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const unlocks = useUnlocks();
  const me = useCurrentUser().personId;
  const customers = useVisibleCustomers();
  const access = routeAccess(appPath(pathname), unlocks, {
    me,
    ownsCustomer: (id) => customers.some((c) => c.id === id),
  });
  if (access.ok) return <>{children}</>;
  return <LockedPanel reason={access.reason} canManageTeam={unlocks.can.teamSettings} />;
}

const featureLabel = (key: string) => FEATURES.find((f) => f.key === key)?.label ?? "This";

export function LockedPanel({
  reason,
  canManageTeam,
}: {
  reason: LockReason;
  canManageTeam?: boolean;
}) {
  let icon: LucideIcon = LockKeyhole;
  let title: string;
  let body: string;
  let primary: ReactNode = null;
  if (reason.kind === "milestone") {
    icon = Network;
    title = "This unlocks when you sponsor your first person";
    body =
      "Your team, the people on it, the recruiting pipeline and reports open up as soon as someone you sponsor registers. Until then, your customers and your list are the place to be.";
    primary = (
      <Button asChild>
        <Link to="/customers">Go to your customers</Link>
      </Button>
    );
  } else if (reason.kind === "feature") {
    icon = Sparkles;
    const label = featureLabel(reason.feature);
    title = `${label} isn't switched on for your team yet`;
    body = canManageTeam
      ? `${label} is ready to try. You can switch it on for the whole team in Team settings.`
      : `${label} is coming in a later phase. Your team's leader can switch it on when the team is ready.`;
    if (canManageTeam)
      primary = (
        <Button asChild>
          <Link to="/settings/team">Open team settings</Link>
        </Button>
      );
  } else if (reason.kind === "candidate") {
    icon = UserPlus;
    title = "This opens when you register";
    body =
      "Customers, chats, the recruiting pipeline and campaigns are for registered apprentices and IBOs. Your sponsor can tell you how to get started.";
  } else {
    title = "Team settings are for leaders";
    body = "Your team's leader and the deputies they name look after these settings.";
  }
  const Icon = icon;
  return (
    <div className="grid flex-1 place-items-center px-4 py-10 lg:px-[26px]">
      <section
        aria-labelledby="locked-title"
        className="grid w-full max-w-md justify-items-center gap-3 rounded-card border border-line bg-surface px-6 py-8 text-center"
      >
        <span
          className="grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary-ink"
          aria-hidden="true"
        >
          <Icon className="size-6" />
        </span>
        <h1 id="locked-title" className="text-lg font-extrabold leading-snug">
          {title}
        </h1>
        <p className="text-[13.5px] text-muted-foreground">{body}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {primary}
          <Button asChild variant="outline">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
