import type { ReactNode } from "react";
import type { LinkProps } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { Breadcrumbs, type Crumb } from "./Breadcrumbs";

/** Typed in-app link target (same as TanStack Router's <Link to/params>). */
export type LinkTarget = { to: LinkProps["to"]; params?: LinkProps["params"] };

/**
 * Page title row. Title + optional subtitle on the left, actions on the right
 * (actions wrap under the title on phones). `crumbs` puts the breadcrumb trail
 * above the title, ending with the current page, e.g.
 * `crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Team settings" }]}`.
 * The Log button lives in the app shell (top right on desktop, the tab bar on
 * phones), never in page headers.
 */
export function PageHeader({
  title,
  subtitle,
  crumbs,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  crumbs?: Crumb[];
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("grid gap-1", className)}>
      {crumbs && crumbs.length > 0 && <Breadcrumbs items={crumbs} />}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">{title}</h1>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * The standard card: white/navy surface, 1px warm border, 14px radius, bold
 * title row with an optional right-side action (a link or small button).
 * `variant="event"` is the navy "next event" card (white text).
 */
export function SectionCard({
  title,
  action,
  children,
  className,
  variant = "default",
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  variant?: "default" | "event";
}) {
  return (
    <section
      className={cn(
        "grid min-w-0 content-start gap-3 rounded-card border px-4 py-4 sm:px-[18px]",
        variant === "event"
          ? "border-transparent bg-event text-event-fg [&_.text-muted-foreground]:text-event-muted"
          : "border-line bg-card text-card-foreground",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-bold">{title}</h2>}
          {action && <div className="shrink-0 text-[12.5px] font-semibold">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** One big number with a small label, on a subtle tile (team KPIs). */
export function StatTile({
  value,
  label,
  className,
}: {
  value: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[10px] bg-surface-2 px-3 py-2.5", className)}>
      <div className="text-xl font-extrabold tabular-nums leading-tight">{value}</div>
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
    </div>
  );
}

/**
 * A bordered row of stats separated by dividers (desktop); a 2-column grid on
 * phones. Used for profile/event summary numbers.
 */
export function StatStrip({
  items,
  className,
}: {
  items: { value: ReactNode; label: string }[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 rounded-card border border-line bg-card lg:grid-cols-[repeat(var(--cols),minmax(0,1fr))]",
        "[&>*:nth-child(even)]:border-l [&>*:nth-child(n+3)]:border-t",
        "lg:[&>*]:border-l lg:[&>*]:border-t-0 lg:[&>*:first-child]:border-l-0",
        className,
      )}
      style={{ "--cols": items.length } as React.CSSProperties}
    >
      {items.map((it, i) => (
        <div key={i} className="border-line px-4 py-3">
          <div className="text-lg font-extrabold tabular-nums leading-tight">{it.value}</div>
          <div className="text-[11.5px] text-muted-foreground">{it.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Centered "nothing here yet" message with optional body text and action. */
export function EmptyState({
  title,
  body,
  action,
  icon,
  className,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid justify-items-center gap-2 rounded-card border border-dashed border-line px-6 py-8 text-center",
        className,
      )}
    >
      {icon && <div className="text-faint [&_svg]:size-6">{icon}</div>}
      <p className="text-sm font-semibold">{title}</p>
      {body && <p className="max-w-sm text-[13px] text-muted-foreground">{body}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
