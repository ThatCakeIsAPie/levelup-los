import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Logo, LogoMark } from "@/components/brand";
import { IS_LOCAL_DEMO } from "@/lib/config";
import { cn } from "@/lib/utils";

/**
 * The branded split screen used before the app shell: a navy brand panel
 * (desktop: full-height left column; phone: a short header band) and the
 * content column. Login, sign-in link callback, invites and "no team yet"
 * all render inside it (see SessionGate in __root.tsx).
 */
export function AuthLayout({
  children,
  headline,
  blurb,
}: {
  children: ReactNode;
  headline?: ReactNode;
  blurb?: ReactNode;
}) {
  return (
    <div className="grid min-h-full grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
      <BrandPanel headline={headline} blurb={blurb} />
      <main className="flex items-start justify-center px-4 py-6 sm:py-10 lg:items-center lg:px-12">
        <div className="grid w-full max-w-[460px] gap-5">{children}</div>
      </main>
    </div>
  );
}

/** Heading + supporting line for the content column. */
export function AuthHeading({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <h2 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">{title}</h2>
      {children && <div className="text-[13px] text-muted-foreground">{children}</div>}
    </div>
  );
}

/** A round tinted icon above a status heading (sent, error, no team…). */
export function StatusIcon({
  icon: Icon,
  tone = "primary",
}: {
  icon: LucideIcon;
  tone?: "primary" | "bad" | "warn" | "info";
}) {
  const toneClass = {
    primary: "bg-primary-soft text-primary-ink",
    bad: "bg-bad-soft text-bad",
    warn: "bg-warn-soft text-warn-ink",
    info: "bg-info-soft text-info-ink",
  }[tone];
  return (
    <span className={cn("grid size-12 place-items-center rounded-full", toneClass)}>
      <Icon className="size-6" aria-hidden="true" />
    </span>
  );
}

/** Inline error under a form. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-[10px] bg-bad-soft px-3 py-2.5 text-[13px] font-medium text-bad"
    >
      {children}
    </p>
  );
}

/** Full-screen "restoring your session" state (no flash of the login page). */
export function AuthLoading({ label = "Signing you in…" }: { label?: string }) {
  return (
    <div className="grid h-dvh place-items-center bg-app" role="status" aria-live="polite">
      <div className="grid justify-items-center gap-4 text-muted-foreground">
        <Logo size="md" />
        <span className="flex items-center gap-2 text-[13px]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          {label}
        </span>
      </div>
    </div>
  );
}

function BrandPanel({ headline, blurb }: { headline?: ReactNode; blurb?: ReactNode }) {
  return (
    <aside className="relative isolate overflow-hidden bg-sidebar px-5 pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] text-white lg:flex lg:flex-col lg:px-12 lg:py-12">
      <LogoMotif />
      <div className="text-white">
        <Logo size="lg" wordmark tagline />
      </div>

      <div className="mt-5 grid max-w-[30rem] gap-2 lg:mt-auto lg:gap-3">
        <h1 className="text-[20px] font-extrabold leading-tight tracking-tight lg:text-[32px]">
          {headline ?? "Your team, customers and events in one place."}
        </h1>
        <p className="text-[13px] text-sidebar-fg lg:text-[15px]">
          {blurb ??
            "LevelUp LOS helps the LevelUp team track people on the business path, look after customers, and get everyone to the next event."}
        </p>
      </div>

      <p className="mt-10 hidden text-xs text-sidebar-fg lg:block">
        {IS_LOCAL_DEMO ? "Sandbox demo · LevelUp Leadership · LTD" : "LevelUp Leadership · LTD"}
      </p>
    </aside>
  );
}

/** The logo mark, large and faint, anchored to the panel's corner. */
function LogoMotif() {
  return (
    <div
      className="pointer-events-none absolute -bottom-10 -right-10 -z-10 opacity-[0.14] lg:-bottom-24 lg:-right-16 lg:opacity-[0.16]"
      aria-hidden="true"
    >
      <LogoMark className="size-48 lg:size-[30rem]" />
    </div>
  );
}
