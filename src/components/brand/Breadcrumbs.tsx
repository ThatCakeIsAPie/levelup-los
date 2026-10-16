import { Fragment } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { LinkTarget } from "./layout";

/** One step of the trail: a page you can go back to (`link`), or the current page (no link). */
export interface Crumb {
  label: string;
  link?: LinkTarget & { search?: LinkProps["search"] };
}

const LINK =
  "block truncate rounded-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

function CrumbLink({ crumb, className }: { crumb: Crumb; className?: string }) {
  const link = crumb.link!;
  return (
    <BreadcrumbLink asChild>
      <Link to={link.to} params={link.params} search={link.search} className={cn(LINK, className)}>
        {crumb.label}
      </Link>
    </BreadcrumbLink>
  );
}

/**
 * The trail at the top of a page, where a back link would be:
 * "People › Anita Patel", "Library › Leadership › Talk". The last crumb is
 * the current page (no link). Always one line: long names truncate, and on
 * phones a trail longer than two puts the earlier steps behind a "…" menu
 * ("… › Leadership › Talk").
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (!items.length) return null;
  const n = items.length;
  // Steps folded into the "…" menu on phones.
  const folded = n > 2 ? items.slice(0, n - 2).filter((c) => c.link) : [];
  return (
    <Breadcrumb aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <BreadcrumbList className="flex-nowrap gap-1 text-[12.5px] sm:gap-1.5">
        {folded.length > 0 && (
          <>
            <BreadcrumbItem className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label="Show earlier pages"
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {folded.map((c) => (
                    <DropdownMenuItem key={c.label} asChild>
                      <Link to={c.link!.to} params={c.link!.params} search={c.link!.search}>
                        {c.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="text-faint sm:hidden" />
          </>
        )}
        {items.map((c, i) => {
          const current = i === n - 1;
          // On phones, only the last two steps show (the rest are in "…").
          const phoneHidden = n > 2 && i < n - 2;
          return (
            <Fragment key={`${i}-${c.label}`}>
              {i > 0 && (
                <BreadcrumbSeparator
                  className={cn("text-faint", phoneHidden || i === n - 2 ? "max-sm:hidden" : "")}
                />
              )}
              <BreadcrumbItem
                className={cn(
                  current ? "min-w-0 flex-1" : "min-w-0 max-w-[45%] shrink-0 sm:max-w-[16rem]",
                  phoneHidden && "hidden sm:inline-flex",
                )}
              >
                {current || !c.link ? (
                  <BreadcrumbPage
                    className={cn("block truncate", current ? "font-semibold" : "font-medium")}
                    aria-current={current ? "page" : undefined}
                  >
                    {c.label}
                  </BreadcrumbPage>
                ) : (
                  <CrumbLink crumb={c} />
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
