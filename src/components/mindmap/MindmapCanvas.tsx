import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Maximize, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { STAGE_LABEL, STAGE_SOLID_CLASS } from "@/components/brand";
import {
  addPerson,
  effectiveBizClass,
  useCurrentUser,
  useCustomerCounts,
  useVisibleCustomers,
  useVisiblePeople,
  type BizClass,
  type CrmPerson,
} from "@/data";
import { cn } from "@/lib/utils";
import { AddCustomerDialog, AddMemberDialog } from "./AddPersonDialogs";
import { CustomerPanel } from "./CustomerPanel";
import { NodeCard, type CardAction } from "./NodeCard";
import { NODE_H, NODE_W, V_GAP, layout } from "./layout";
import type { Edge, PositionedNode, TreeNode } from "./types";
import { useTreeStore, type NewMemberClass } from "./useTreeStore";

interface Props {
  root: TreeNode;
  /** False for candidates: no add actions. */
  canAdd: boolean;
}

const MIN_K = 0.25;
const MAX_K = 2;
const PAD = 24;
const EMPTY: CrmPerson[] = [];
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));

function edgePath(nodes: Map<string, PositionedNode>, e: Edge): string {
  const a = nodes.get(e.from);
  const b = nodes.get(e.to);
  if (!a || !b) return "";
  const ax = a.x + NODE_W / 2;
  const ay = a.y + NODE_H;
  const bx = b.x + NODE_W / 2;
  const by = b.y;
  // Trunk sits a constant distance above the child row so each band gets
  // its own visible horizontal busbar, even when siblings are stratified.
  const midY = by - V_GAP / 2;
  return `M ${ax} ${ay} V ${midY} H ${bx} V ${by}`;
}

type View = { x: number; y: number; k: number };
type Gesture =
  | { type: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { type: "pinch"; d0: number; k0: number; cx: number; cy: number };

export function MindmapCanvas({ root, canAdd }: Props) {
  const expanded = useTreeStore((s) => s.expanded);
  const toggle = useTreeStore((s) => s.toggle);
  const selectedId = useTreeStore((s) => s.selectedId);
  const select = useTreeStore((s) => s.select);
  const showCustomers = useTreeStore((s) => s.showCustomers);
  const showAllCustomers = useTreeStore((s) => s.showAllCustomers);
  const toggleCustomers = useTreeStore((s) => s.toggleCustomers);
  const customerPanelId = useTreeStore((s) => s.customerPanelId);
  const openCustomerPanel = useTreeStore((s) => s.openCustomerPanel);
  const addMember = useTreeStore((s) => s.addMember);

  const user = useCurrentUser();
  const visible = useVisiblePeople();
  const myCustomers = useVisibleCustomers();
  const customerCounts = useCustomerCounts();
  const navigate = useNavigate();

  const laid = useMemo(() => layout(root, expanded), [root, expanded]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    laid.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [laid.nodes]);
  // Layout places nodes right-to-left; render them parent-first, left-to-right
  // so keyboard focus moves through the tree in reading order.
  const ordered = useMemo(() => {
    const kids = new Map<string | null, PositionedNode[]>();
    for (const n of laid.nodes) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
    const out: PositionedNode[] = [];
    const walk = (n: PositionedNode) => {
      out.push(n);
      [...(kids.get(n.id) ?? [])].sort((a, b) => a.x - b.x).forEach(walk);
    };
    (kids.get(null) ?? []).forEach(walk);
    return out;
  }, [laid.nodes]);

  // Tree nodes -> roster people (matched by the synced losUid, then by name).
  const rosterFor = useMemo(() => {
    const byUid = new Map<string, CrmPerson>();
    const byName = new Map<string, CrmPerson>();
    for (const p of visible) {
      if (p.bizClass === "customer") continue;
      if (p.losUid) byUid.set(p.losUid, p);
      byName.set(p.name.trim().toLowerCase(), p);
    }
    return (n: PositionedNode): CrmPerson | undefined =>
      byUid.get(n.person.uid) ?? byName.get(n.person.name.trim().toLowerCase());
  }, [visible]);

  const customersByOwner = useMemo(() => {
    const m = new Map<string, CrmPerson[]>();
    for (const c of myCustomers) {
      if (!c.ownerId) continue;
      m.set(c.ownerId, [...(m.get(c.ownerId) ?? []), c]);
    }
    return m;
  }, [myCustomers]);

  // ---- view (pan + zoom) ----
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setViewState] = useState<View>({ x: PAD, y: PAD, k: 1 });
  const viewRef = useRef(view);
  const setView = useCallback((v: View) => {
    viewRef.current = v;
    setViewState(v);
  }, []);
  const [dragging, setDragging] = useState(false);

  const zoomAt = useCallback(
    (px: number, py: number, nextK: number) => {
      const v = viewRef.current;
      const k = clampK(nextK);
      const cx = (px - v.x) / v.k;
      const cy = (py - v.y) / v.k;
      setView({ k, x: px - cx * k, y: py - cy * k });
    },
    [setView],
  );
  const zoomBy = (factor: number) => {
    const el = wrapRef.current;
    if (!el) return;
    zoomAt(el.clientWidth / 2, el.clientHeight / 2, viewRef.current.k * factor);
  };
  const home = useCallback(() => {
    const w = wrapRef.current?.clientWidth ?? 1024;
    setView({ x: w < 640 ? 16 : PAD, y: PAD, k: w < 640 ? 0.8 : 1 });
  }, [setView]);
  const fit = () => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight - 64; // keep clear of the zoom controls
    const k = clampK(Math.min(1, (w - PAD * 2) / laid.width, (h - PAD * 2) / laid.height));
    setView({ k, x: Math.max(PAD, (w - laid.width * k) / 2), y: PAD });
  };

  // Start at the root whenever the tree's root changes (login / upload).
  const rootName = root.person.name;
  useLayoutEffect(() => {
    home();
  }, [rootName, home]);

  // Wheel / trackpad pinch zooms around the pointer.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-pan]")) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, viewRef.current.k * factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Pointer pan (mouse, pen, one finger) and two-finger pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);

  const local = (e: React.PointerEvent) => {
    const rect = wrapRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const startPan = (pt: { x: number; y: number }, moved: boolean) => {
    const v = viewRef.current;
    gesture.current = { type: "pan", sx: pt.x, sy: pt.y, ox: v.x, oy: v.y, moved };
  };
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    const v = viewRef.current;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    gesture.current = {
      type: "pinch",
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      k0: v.k,
      cx: (mx - v.x) / v.k,
      cy: (my - v.y) / v.k,
    };
    suppressClick.current = true;
    setDragging(true);
  };

  // React bubbles events from portals (menus, dialogs) through this tree, so
  // only handle events whose DOM target is really inside the canvas.
  const inCanvas = (t: EventTarget) => !!wrapRef.current?.contains(t as Node);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!inCanvas(e.target)) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, [role=menuitem], [data-no-pan]")) return;
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 1) {
      suppressClick.current = false;
      startPan(pt, false);
    } else if (pointers.current.size === 2) {
      startPinch();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const pt = local(e);
    pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (!g) return;
    if (g.type === "pan") {
      const dx = pt.x - g.sx;
      const dy = pt.y - g.sy;
      if (!g.moved) {
        if (Math.hypot(dx, dy) < 5) return;
        g.moved = true;
        suppressClick.current = true;
        setDragging(true);
        try {
          wrapRef.current?.setPointerCapture(e.pointerId);
        } catch {
          // pointer already released
        }
      }
      setView({ ...viewRef.current, x: g.ox + dx, y: g.oy + dy });
    } else if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = clampK(g.k0 * (Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      setView({ k, x: mx - g.cx * k, y: my - g.cy * k });
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    if (pointers.current.size === 1) {
      // Pinch -> pan with the remaining finger.
      startPan([...pointers.current.values()][0], true);
    } else if (pointers.current.size === 0) {
      gesture.current = null;
      setDragging(false);
    }
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (suppressClick.current && inCanvas(e.target)) {
      suppressClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };

  // Keep keyboard focus visible: pan a focused card into view. The wrapper is
  // overflow-hidden, so undo any native scroll the browser does on focus.
  const onFocusCapture = (e: React.FocusEvent) => {
    const el = wrapRef.current;
    const t = e.target as HTMLElement;
    if (!el || !t.dataset.nodeId) return;
    const wr = el.getBoundingClientRect();
    const r = t.getBoundingClientRect();
    const v = viewRef.current;
    let { x, y } = v;
    if (r.left < wr.left + 16) x += wr.left + 16 - r.left;
    else if (r.right > wr.right - 16) x -= r.right - (wr.right - 16);
    if (r.top < wr.top + 16) y += wr.top + 16 - r.top;
    else if (r.bottom > wr.bottom - 72) y -= r.bottom - (wr.bottom - 72);
    if (x !== v.x || y !== v.y) setView({ ...v, x, y });
  };

  // ---- branch emphasis ----
  const [hoverId, setHoverId] = useState<string | null>(null);
  const activeId = hoverId ?? selectedId;
  const branch = useMemo(() => {
    const ids = new Set<string>();
    let cur = activeId ? nodeMap.get(activeId) : undefined;
    while (cur) {
      ids.add(cur.id);
      cur = cur.parentId ? nodeMap.get(cur.parentId) : undefined;
    }
    return ids;
  }, [activeId, nodeMap]);
  const isHot = (e: Edge) => branch.has(e.to) || (e.from === activeId && branch.has(e.from));

  // ---- card actions + dialogs ----
  const [memberDialog, setMemberDialog] = useState<{
    node: PositionedNode;
    kind: NewMemberClass;
  } | null>(null);
  const [customerNode, setCustomerNode] = useState<PositionedNode | null>(null);

  const onAction = useCallback(
    (node: PositionedNode, action: CardAction) => {
      if (action === "apprentice" || action === "ibo") {
        setMemberDialog({ node, kind: action });
      } else if (action === "customer") {
        setCustomerNode(node);
      } else {
        const rp = rosterFor(node);
        if (!rp) {
          toast.error("This person isn't on your roster yet");
          return;
        }
        void navigate({
          to: "/people/$id",
          params: { id: rp.id },
          hash: action === "edit" ? "edit" : undefined,
        });
      }
    },
    [navigate, rosterFor],
  );
  const onOpenCustomers = useCallback(
    (id: string) => openCustomerPanel(useTreeStore.getState().customerPanelId === id ? null : id),
    [openCustomerPanel],
  );
  const closePanel = useCallback(() => openCustomerPanel(null), [openCustomerPanel]);

  const panelNode = customerPanelId ? nodeMap.get(customerPanelId) : undefined;
  const panelRoster = panelNode ? rosterFor(panelNode) : undefined;
  const panelCustomers = panelRoster ? (customersByOwner.get(panelRoster.id) ?? EMPTY) : EMPTY;
  const customerRoster = customerNode ? rosterFor(customerNode) : undefined;

  const dots = 22 * view.k;

  return (
    <div
      ref={wrapRef}
      className={cn(
        "relative h-full w-full touch-none select-none overflow-hidden bg-app outline-none",
        dragging ? "cursor-grabbing" : "cursor-grab",
      )}
      style={{
        backgroundImage: "radial-gradient(circle, var(--line) 1.2px, transparent 1.3px)",
        backgroundSize: `${dots}px ${dots}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture}
      onFocusCapture={onFocusCapture}
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
    >
      <div
        className="absolute left-0 top-0"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          transformOrigin: "0 0",
          width: laid.width,
          height: laid.height,
        }}
      >
        <svg
          width={laid.width}
          height={laid.height}
          className="pointer-events-none absolute inset-0 overflow-visible"
          aria-hidden="true"
        >
          <g fill="none" strokeLinejoin="round" style={{ stroke: "var(--line)" }} strokeWidth={2}>
            {laid.edges.map((e) =>
              isHot(e) ? null : <path key={`${e.from}-${e.to}`} d={edgePath(nodeMap, e)} />,
            )}
          </g>
          <g fill="none" strokeLinejoin="round" className="stroke-primary" strokeWidth={2.25}>
            {laid.edges.map((e) =>
              isHot(e) ? <path key={`${e.from}-${e.to}`} d={edgePath(nodeMap, e)} /> : null,
            )}
          </g>
        </svg>
        {ordered.map((n) => {
          const rp = rosterFor(n);
          const stage: BizClass = rp ? effectiveBizClass(rp) : "ibo";
          const own = rp ? (customersByOwner.get(rp.id) ?? EMPTY) : EMPTY;
          return (
            <NodeCard
              key={n.id}
              node={n}
              stage={stage}
              isViewer={rp?.id === user.personId}
              selected={selectedId === n.id}
              customers={own}
              customerCount={rp ? (customerCounts[rp.id] ?? own.length) : 0}
              customersVisible={showAllCustomers || showCustomers.has(n.id)}
              canToggleCustomers={!showAllCustomers}
              canAdd={canAdd}
              onToggle={toggle}
              onSelect={select}
              onHover={setHoverId}
              onAction={onAction}
              onToggleCustomers={toggleCustomers}
              onOpenCustomers={onOpenCustomers}
            />
          );
        })}
        {root.children.length === 0 && canAdd && (
          <p
            className="absolute left-0 w-64 text-[12.5px] text-muted-foreground"
            style={{ top: NODE_H + 20 }}
          >
            People you sponsor appear under you. Use the menu on your card to add an apprentice or
            IBO.
          </p>
        )}
        {panelNode && panelCustomers.length > 0 && (
          <CustomerPanel
            node={panelNode}
            customers={panelCustomers}
            isViewer={panelRoster?.id === user.personId}
            onClose={closePanel}
          />
        )}
      </div>

      {/* Stage legend (desktop) */}
      <div
        className="pointer-events-none absolute bottom-4 left-4 hidden items-center gap-3.5 rounded-lg border border-line bg-surface/90 px-3 py-1.5 text-[11.5px] text-muted-foreground backdrop-blur lg:flex"
        aria-hidden="true"
      >
        {(["ibo", "apprentice", "prospect"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className={cn("size-2.5 rounded-[3px]", STAGE_SOLID_CLASS[s])} />
            {STAGE_LABEL[s]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <i className="size-2.5 rounded-full bg-stage-customer" />
          Customers
        </span>
      </div>

      {/* Zoom controls: above the phone tab bar's raised Log button. */}
      <div
        data-no-pan
        role="toolbar"
        aria-label="Zoom"
        className="absolute bottom-14 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-sm lg:bottom-4 lg:right-4"
      >
        <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)} disabled={view.k <= MIN_K}>
          <Minus className="size-4" aria-hidden="true" />
        </ZoomButton>
        <button
          type="button"
          onClick={() => {
            const el = wrapRef.current;
            if (el) zoomAt(el.clientWidth / 2, el.clientHeight / 2, 1);
          }}
          className="h-8 w-12 rounded-md text-[12px] font-bold tabular-nums text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
          aria-label={`Zoom ${Math.round(view.k * 100)} percent. Reset to 100 percent`}
          title="Reset to 100%"
        >
          {Math.round(view.k * 100)}%
        </button>
        <ZoomButton label="Zoom in" onClick={() => zoomBy(1.2)} disabled={view.k >= MAX_K}>
          <Plus className="size-4" aria-hidden="true" />
        </ZoomButton>
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
        <ZoomButton label="Fit the map on screen" onClick={fit}>
          <Maximize className="size-4" aria-hidden="true" />
        </ZoomButton>
      </div>

      <AddMemberDialog
        bizClass={memberDialog?.kind ?? null}
        parentName={memberDialog?.node.person.name ?? ""}
        onClose={() => setMemberDialog(null)}
        onSubmit={(input) => {
          if (!memberDialog) return;
          const parent = memberDialog.node.person;
          addMember(parent.id, input);
          toast.success(`${input.name} added under ${parent.name}`);
          setMemberDialog(null);
        }}
      />

      <AddCustomerDialog
        open={customerNode !== null}
        ownerName={customerNode?.person.name ?? ""}
        isOwnCard={customerRoster?.id === user.personId}
        onClose={() => setCustomerNode(null)}
        onSubmit={(data) => {
          if (!customerNode || !customerRoster) {
            toast.error("This person isn't on your roster yet");
            return;
          }
          const vol = Number(data.monthlyVolume);
          addPerson({
            name: data.name,
            bizClass: "customer",
            ownerId: customerRoster.id,
            sponsorId: customerRoster.id,
            email: data.email || undefined,
            phone: data.phone || undefined,
            monthlyVolume: data.monthlyVolume && Number.isFinite(vol) ? vol : undefined,
            joinedDate: data.startDate || undefined,
          });
          const own = customerRoster.id === user.personId;
          toast.success(
            own
              ? `${data.name} added to your customers`
              : `${data.name} added as a customer of ${customerNode.person.name}`,
          );
          if (own && !useTreeStore.getState().showCustomers.has(customerNode.id)) {
            toggleCustomers(customerNode.id);
          }
          setCustomerNode(null);
        }}
      />
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}
