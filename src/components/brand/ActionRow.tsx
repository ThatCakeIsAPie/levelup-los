import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { TONE_CLASS, type IconTone } from "./stage";
import type { LinkTarget } from "./layout";

/**
 * One row of a "Today"-style action list: tinted icon square, bold title,
 * muted meta line (chips + text), and a trailing action (usually a small
 * Button). Rows separate themselves with a top hairline; wrap a list of them
 * in a plain <div> (no extra gaps). Make the title clickable with `link`
 * (in-app route), `href` (external/mailto/tel) or `onClick`.
 */
export function ActionRow({
  icon: Icon,
  iconTone = "primary",
  title,
  meta,
  action,
  link,
  href,
  onClick,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  iconTone?: IconTone;
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  link?: LinkTarget;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const titleCls = "block truncate text-[13px] font-semibold";
  const clickable = "rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring";
  let titleEl: ReactNode = <span className={titleCls}>{title}</span>;
  if (link) {
    titleEl = (
      <Link to={link.to} params={link.params} className={cn(titleCls, clickable)}>
        {title}
      </Link>
    );
  } else if (href) {
    titleEl = (
      <a href={href} className={cn(titleCls, clickable)}>
        {title}
      </a>
    );
  } else if (onClick) {
    titleEl = (
      <button type="button" onClick={onClick} className={cn(titleCls, clickable, "text-left")}>
        {title}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-[11px] first:border-t-0 first:pt-0.5",
        className,
      )}
    >
      <span className={cn("grid size-8 place-items-center rounded-[9px]", TONE_CLASS[iconTone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        {titleEl}
        {meta && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {meta}
          </div>
        )}
      </div>
      {action ? <div className="shrink-0">{action}</div> : <span />}
    </div>
  );
}
