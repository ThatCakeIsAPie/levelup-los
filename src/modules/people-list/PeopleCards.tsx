import { Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { PersonAvatar, StageChip } from "@/components/brand";
import { cn } from "@/lib/utils";
import { ContactText, FlagChips } from "./cells";
import { shortDate, type PersonRow } from "./model";

function metaLine(r: PersonRow, viewerId: string): string {
  const p = r.person;
  if (p.bizClass === "customer") {
    const parts = [p.monthlyVolume ? `${p.monthlyVolume} PV a month` : "No volume yet"];
    if (r.lastSale) parts.push(`bought ${shortDate(r.lastSale.date)}`);
    return parts.join(" · ");
  }
  if (r.isSelf) return [p.location, "This is you"].filter(Boolean).join(" · ");
  const up = r.upline ? (r.upline.id === viewerId ? "you" : r.upline.name) : undefined;
  return [up ? `Under ${up}` : undefined, p.location].filter(Boolean).join(" · ") || "No sponsor";
}

/** Phone / tablet list (< 1024px). In select mode a tap toggles the row instead of opening it. */
export function PeopleCards({
  rows,
  viewerId,
  selecting,
  selected,
  onToggle,
}: {
  rows: PersonRow[];
  viewerId: string;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="grid overflow-hidden rounded-card border border-line bg-card">
      {rows.map((r) => {
        const p = r.person;
        const checked = selected.has(p.id);
        const body = (
          <>
            {selecting && (
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-[18px] shrink-0 place-items-center rounded-sm border border-primary",
                  checked && "bg-primary text-primary-foreground",
                  r.isSelf && "border-line",
                )}
              >
                {checked && <Check className="size-3.5" />}
              </span>
            )}
            <PersonAvatar name={p.name} stage={r.stage} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[13.5px] font-semibold">{p.name}</span>
                <StageChip stage={r.stage} />
              </div>
              <div className="truncate text-[12px] text-muted-foreground">
                {metaLine(r, viewerId)}
              </div>
              <FlagChips row={r} className="mt-1" />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {!r.isSelf && <ContactText row={r} compact />}
              {!selecting && <ChevronRight className="size-4 text-faint" aria-hidden="true" />}
            </div>
          </>
        );
        const cls = cn(
          "flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
          checked && "bg-primary-soft/50",
        );
        return (
          <li key={p.id} className="border-b border-line last:border-b-0">
            {selecting ? (
              <button
                type="button"
                className={cn(cls, r.isSelf && "opacity-60")}
                onClick={() => !r.isSelf && onToggle(p.id)}
                aria-pressed={checked}
                aria-disabled={r.isSelf}
              >
                {body}
              </button>
            ) : (
              <Link
                to="/people/$id"
                params={{ id: p.id }}
                className={cn(cls, "active:bg-surface-2")}
              >
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
