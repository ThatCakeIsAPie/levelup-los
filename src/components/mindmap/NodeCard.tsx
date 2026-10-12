import { memo } from "react";
import {
  BadgeCheck,
  Eye,
  EyeOff,
  Minus,
  MoreHorizontal,
  Pencil,
  Plus,
  ShoppingBag,
  UserPlus,
  Users,
} from "lucide-react";
import { PersonAvatar, StageChip, initials } from "@/components/brand";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BizClass, CrmPerson } from "@/data";
import { cn } from "@/lib/utils";
import { NODE_H, NODE_W } from "./layout";
import type { PositionedNode } from "./types";

export type CardAction = "apprentice" | "ibo" | "customer" | "view" | "edit";

export interface NodeCardProps {
  node: PositionedNode;
  /** Stage from the shared roster (IBO when the person isn't on the roster). */
  stage: BizClass;
  isViewer: boolean;
  selected: boolean;
  /** Customers of this person the viewer may see (only ever the viewer's own). */
  customers: CrmPerson[];
  /** Total customers this person owns (aggregate; names may be private). */
  customerCount: number;
  customersVisible: boolean;
  /** False while the header's "Show customers" switch overrides per-card toggles. */
  canToggleCustomers: boolean;
  /** False for candidates, who can't add people. */
  canAdd: boolean;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onAction: (node: PositionedNode, action: CardAction) => void;
  onToggleCustomers: (id: string) => void;
  onOpenCustomers: (id: string) => void;
}

const num = (n: number | undefined) => (n ?? 0).toLocaleString();

/** Performance bonus bracket from GPV. */
function bonusPct(gpv: number | undefined): number {
  const g = gpv ?? 0;
  if (g >= 7500) return 25;
  if (g >= 6000) return 23;
  if (g >= 4000) return 21;
  if (g >= 2500) return 18;
  if (g >= 1500) return 15;
  if (g >= 1000) return 12;
  if (g >= 600) return 9;
  if (g >= 300) return 6;
  if (g >= 100) return 3;
  return 0;
}

function NodeCardImpl({
  node,
  stage,
  isViewer,
  selected,
  customers,
  customerCount,
  customersVisible,
  canToggleCustomers,
  canAdd,
  onToggle,
  onSelect,
  onHover,
  onAction,
  onToggleCustomers,
  onOpenCustomers,
}: NodeCardProps) {
  const p = node.person;
  const members = p.memberCount ?? 1;
  const downline = members - 1;
  const rank = bonusPct(p.gpv);
  const firstName = p.name.split(/[\s,]+/)[0] || p.name;
  const canHaveCustomers = stage === "apprentice" || stage === "ibo";

  return (
    <div
      role="group"
      tabIndex={0}
      data-node-id={p.id}
      aria-label={`${p.name}${isViewer ? " (you)" : ""}, ${stage === "ibo" ? "IBO" : stage}, ${members} ${members === 1 ? "member" : "members"}`}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
      onMouseEnter={() => onHover(p.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "group/card absolute flex cursor-pointer flex-col rounded-card border bg-surface px-3 pb-2.5 pt-2.5 text-foreground",
        "shadow-[0_1px_2px_rgba(19,36,61,.06)] transition-[box-shadow,border-color] hover:shadow-md",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected ? "border-primary ring-2 ring-primary/25" : "border-line",
      )}
      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H }}
    >
      {/* Name row */}
      <div className="flex items-center gap-2.5">
        <PersonAvatar name={p.name} stage={stage} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold leading-tight" title={p.name}>
            {p.name}
            {isViewer && <span className="ml-1 font-semibold text-faint">· you</span>}
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <StageChip stage={stage} className="px-1.5 py-0 text-[10.5px]" />
            <span
              className="text-[11px] font-bold tabular-nums text-muted-foreground"
              title="Performance bonus level from GPV"
            >
              {rank}%
            </span>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="-mr-1.5 -mt-3 grid size-7 shrink-0 place-items-center self-start rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-surface-2"
              aria-label={`Actions for ${p.name}`}
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={() => onAction(node, "view")}>
              <Eye /> View person
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction(node, "edit")}>
              <Pencil /> Edit person
            </DropdownMenuItem>
            {customerCount > 0 && canToggleCustomers && (
              <DropdownMenuItem onSelect={() => onToggleCustomers(p.id)}>
                {customersVisible ? <EyeOff /> : <ShoppingBag />}
                {customersVisible ? "Hide customers" : "Show customers"}
              </DropdownMenuItem>
            )}
            {canAdd && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  Add under {isViewer ? "you" : firstName}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onAction(node, "apprentice")}>
                  <UserPlus /> Add apprentice
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAction(node, "ibo")}>
                  <BadgeCheck /> Add IBO
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canHaveCustomers}
                  onSelect={() => onAction(node, "customer")}
                >
                  <ShoppingBag />
                  <span className="grid">
                    Add customer
                    {!canHaveCustomers && (
                      <span className="text-[11px] text-muted-foreground">
                        Only apprentices and IBOs have customers
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Volume */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11.5px]">
        <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-2 py-1">
          <span className="font-semibold text-muted-foreground">PPV</span>
          <span className="font-bold tabular-nums">{num(p.ppv)}</span>
        </div>
        <div className="flex items-baseline justify-between rounded-lg bg-surface-2 px-2 py-1">
          <span className="font-semibold text-muted-foreground">GPV</span>
          <span className="font-bold tabular-nums">{num(p.gpv)}</span>
        </div>
      </div>

      {/* Members + customers */}
      <div className="mt-auto flex h-5 items-center gap-1 text-[11.5px] text-muted-foreground">
        <Users className="size-3.5" aria-hidden="true" />
        <span className="tabular-nums">
          {members} {members === 1 ? "member" : "members"}
        </span>
        <CustomerSlot
          personId={p.id}
          ownerName={firstName}
          customers={customers}
          count={customerCount}
          visible={customersVisible}
          onToggle={onToggleCustomers}
          onOpen={onOpenCustomers}
        />
      </div>

      {node.hasChildren && (
        <button
          type="button"
          aria-expanded={node.expanded}
          aria-label={
            node.expanded
              ? `Hide the people under ${p.name}`
              : `Show ${downline} ${downline === 1 ? "person" : "people"} under ${p.name}`
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggle(p.id);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            "absolute -bottom-3 left-1/2 z-10 inline-flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[11px] font-bold tabular-nums shadow-sm transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
            node.expanded
              ? "border-line bg-surface text-muted-foreground hover:text-foreground"
              : "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {node.expanded ? (
            <Minus className="size-3" aria-hidden="true" />
          ) : (
            <>
              <Plus className="size-3" aria-hidden="true" />
              {downline}
            </>
          )}
        </button>
      )}
    </div>
  );
}

function CustomerSlot({
  personId,
  ownerName,
  customers,
  count,
  visible,
  onToggle,
  onOpen,
}: {
  personId: string;
  ownerName: string;
  customers: CrmPerson[];
  count: number;
  visible: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  if (count === 0) return null;
  const pill =
    "ml-auto inline-flex h-5 items-center gap-1 rounded-full bg-stage-customer-soft px-1.5 text-[10.5px] font-bold text-stage-customer-ink";

  if (!visible) {
    return (
      <button
        type="button"
        className={cn(
          pill,
          "hover:brightness-95 focus-visible:outline-2 focus-visible:outline-ring",
        )}
        aria-label={`Show ${count} ${count === 1 ? "customer" : "customers"}`}
        title="Show customers"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(personId);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <ShoppingBag className="size-3" aria-hidden="true" />
        <span className="tabular-nums">{count}</span>
      </button>
    );
  }

  // Someone else's customers: the count is shared, names are private.
  if (customers.length === 0) {
    return (
      <span className={pill} title={`Only ${ownerName} sees who their customers are`}>
        <ShoppingBag className="size-3" aria-hidden="true" />
        <span className="tabular-nums">
          {count} {count === 1 ? "customer" : "customers"}
        </span>
      </span>
    );
  }

  const top = customers.slice(0, 3);
  const more = customers.length - top.length;
  const circle =
    "grid size-5 place-items-center rounded-full border-2 border-surface bg-stage-customer-soft text-[8.5px] font-bold leading-none text-stage-customer-ink";
  return (
    <button
      type="button"
      className="-my-0.5 ml-auto flex items-center rounded-full p-0.5 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`Open ${customers.length} ${customers.length === 1 ? "customer" : "customers"}`}
      title="Open customer list"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(personId);
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span className="flex -space-x-1.5">
        {top.map((c) => (
          <span key={c.id} className={circle} title={c.name}>
            {initials(c.name)}
          </span>
        ))}
        {more > 0 && (
          <span className={cn(circle, "w-auto min-w-5 bg-amber px-1 text-on-amber tabular-nums")}>
            +{more}
          </span>
        )}
      </span>
    </button>
  );
}

export const NodeCard = memo(NodeCardImpl);
