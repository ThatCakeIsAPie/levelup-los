import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ShoppingBag, X } from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import type { CrmPerson } from "@/data";
import { NODE_W } from "./layout";
import type { PositionedNode } from "./types";

/**
 * Full customer list for one card, drawn beside it on the canvas. It's an
 * overlay only: it never takes part in the tree layout.
 */
export function CustomerPanel({
  node,
  customers,
  isViewer,
  onClose,
}: {
  node: PositionedNode;
  customers: CrmPerson[];
  isViewer: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = customers.reduce((sum, c) => sum + (c.monthlyVolume ?? 0), 0);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Customers of ${node.person.name}`}
      tabIndex={-1}
      data-no-pan
      className="absolute z-20 grid w-64 gap-2 rounded-card border border-line bg-surface p-3 text-foreground shadow-lg outline-none"
      style={{ left: node.x + NODE_W + 14, top: node.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-lg bg-stage-customer-soft text-stage-customer-ink">
          <ShoppingBag className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-bold">
            {isViewer ? "Your customers" : `Customers of ${node.person.name}`}
          </div>
          <div className="text-[11.5px] text-muted-foreground tabular-nums">
            {customers.length} · {total.toLocaleString()} PV a month
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close customer list"
          className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="-mx-1 max-h-60 overflow-y-auto overscroll-contain">
        {customers.map((c) => (
          <li key={c.id}>
            <Link
              to="/people/$id"
              params={{ id: c.id }}
              className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[12.5px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              <PersonAvatar name={c.name} stage="customer" size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              <span className="tabular-nums text-muted-foreground">
                {(c.monthlyVolume ?? 0).toLocaleString()} PV
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {isViewer && (
        <Link
          to="/customers"
          className="justify-self-start rounded text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Open customers
        </Link>
      )}
    </div>
  );
}
