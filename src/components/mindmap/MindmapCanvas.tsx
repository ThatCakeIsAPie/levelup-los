import { useEffect, useMemo, useRef, useState } from "react";
import { NodeCard } from "./NodeCard";
import { H_GAP, NODE_H, NODE_W, ROW_GAP, V_GAP, layout } from "./layout";
import type { Edge, PositionedNode, TreeNode } from "./types";
import { useTreeStore } from "./useTreeStore";

interface Props {
  root: TreeNode;
}

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
void ROW_GAP;

export function MindmapCanvas({ root }: Props) {
  const expanded = useTreeStore((s) => s.expanded);
  const toggle = useTreeStore((s) => s.toggle);
  const selectedId = useTreeStore((s) => s.selectedId);
  const select = useTreeStore((s) => s.select);

  const laid = useMemo(() => layout(root, expanded), [root, expanded]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    laid.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [laid.nodes]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setScale((s) => Math.min(2, Math.max(0.25, s * (e.deltaY > 0 ? 0.9 : 1.1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };
  const stopDrag = () => {
    dragging.current = null;
  };

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden bg-muted/30"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
      style={{ cursor: dragging.current ? "grabbing" : "grab" }}
    >
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: "0 0",
          width: laid.width,
          height: laid.height,
          position: "relative",
        }}
      >
        <svg
          width={laid.width}
          height={laid.height}
          className="pointer-events-none absolute inset-0 text-muted-foreground/60"
        >
          {laid.edges.map((e, i) => (
            <path
              key={i}
              d={edgePath(nodeMap, e)}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            />
          ))}
        </svg>
        {laid.nodes.map((n) => (
          <div data-node key={n.id}>
            <NodeCard node={n} selected={selectedId === n.id} onToggle={toggle} onSelect={select} />
          </div>
        ))}
      </div>

      <div className="absolute bottom-16 right-3 flex items-center gap-1 rounded-md border bg-background/90 px-2 py-1 text-xs shadow-sm backdrop-blur">
        <button
          className="px-1.5 hover:text-primary"
          onClick={() => setScale((s) => Math.max(0.25, s - 0.1))}
        >
          −
        </button>
        <span className="tabular-nums w-10 text-center">{Math.round(scale * 100)}%</span>
        <button
          className="px-1.5 hover:text-primary"
          onClick={() => setScale((s) => Math.min(2, s + 0.1))}
        >
          +
        </button>
        <button
          className="ml-2 rounded px-1.5 hover:bg-muted"
          onClick={() => {
            setScale(1);
            setPan({ x: 40, y: 40 });
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}

// satisfy unused-import linter if H_GAP not used directly
void H_GAP;
