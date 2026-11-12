import { useRef } from "react";
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

const LONG_PRESS_MS = 500;

/**
 * Long press on a card (touch or mouse): fires after half a second without
 * moving. `swallowClick` goes on the list (capture) and eats the click that
 * follows the press: by then the card is a select button, so that click
 * would otherwise untick the person again (or open the profile).
 */
function useLongPress(onLongPress: ((id: string) => void) | undefined) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** When the last long press fired (0 = none pending). */
  const fired = useRef(0);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  const swallowClick = (e: React.MouseEvent) => {
    if (!fired.current) return;
    const recent = Date.now() - fired.current < 1500;
    fired.current = 0;
    if (!recent) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const bind = (id: string) =>
    onLongPress
      ? {
          onPointerDown: (e: React.PointerEvent) => {
            if (e.button !== 0) return;
            fired.current = 0;
            start.current = { x: e.clientX, y: e.clientY };
            timer.current = window.setTimeout(() => {
              fired.current = Date.now();
              timer.current = null;
              navigator.vibrate?.(15);
              onLongPress(id);
            }, LONG_PRESS_MS);
          },
          onPointerMove: (e: React.PointerEvent) => {
            const s = start.current;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) cancel();
          },
          onPointerUp: cancel,
          onPointerCancel: cancel,
          onPointerLeave: cancel,
          onContextMenu: (e: React.MouseEvent) => {
            // The phone's own long-press menu would cover the list.
            if (fired.current || timer.current !== null) e.preventDefault();
          },
        }
      : {};
  return { bind, swallowClick };
}

/**
 * Phone / tablet list (< 1024px). In select mode a tap toggles the row
 * instead of opening it; a long press starts select mode with that person.
 */
export function PeopleCards({
  rows,
  viewerId,
  selecting,
  selected,
  onToggle,
  onLongPress,
}: {
  rows: PersonRow[];
  viewerId: string;
  selecting: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onLongPress?: (id: string) => void;
}) {
  const longPress = useLongPress(onLongPress);
  return (
    <ul
      className="grid overflow-hidden rounded-card border border-line bg-card"
      onClickCapture={longPress.swallowClick}
    >
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
                className={cn(cls, "select-none active:bg-surface-2 [-webkit-touch-callout:none]")}
                {...(r.isSelf ? {} : longPress.bind(p.id))}
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
