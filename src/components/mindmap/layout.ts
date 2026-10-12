import type { Edge, PositionedNode, TreeNode } from "./types";

// Card size used by both the layout and NodeCard (rendering only).
export const NODE_W = 216;
export const NODE_H = 122;
export const H_GAP = 24; // horizontal gap between sibling column footprints
export const V_GAP = 28; // vertical gap between a parent and its children row
export const ROW_GAP = 70; // gap between root row and depth-1 row

/**
 * Layout rules:
 *  - Children of any node are ordered by total descendant count DESC.
 *    Tie-breaker: GPV DESC.
 *  - Depth 0 (root): children are placed in a single horizontal row beneath it.
 *  - Depth >= 1: when expanded, the FIRST child sits directly beneath the
 *    parent (same x). Siblings step right by NODE_W + H_GAP.
 *  - An expanded node N's children row is bumped DOWN to sit one V_GAP below
 *    the deepest visible row of any expanded subtree whose root sits at an
 *    x strictly greater than N.x AND is NOT a descendant of N. Descendants
 *    of N never push N's own children row.
 */

function descendantCount(node: TreeNode): number {
  let n = node.children.length;
  for (const c of node.children) n += descendantCount(c);
  return n;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children].sort((a, b) => {
    const d = descendantCount(b) - descendantCount(a);
    if (d !== 0) return d;
    return (b.person.gpv ?? 0) - (a.person.gpv ?? 0);
  });
}

interface SizedNode {
  node: TreeNode;
  kids: SizedNode[];
  isExpanded: boolean;
}

function build(node: TreeNode, depth: number, expanded: Set<string>, maxDepth: number): SizedNode {
  const isExpanded = expanded.has(node.person.id) && node.children.length > 0 && depth < maxDepth;
  const kids = isExpanded
    ? sortedChildren(node).map((c) => build(c, depth + 1, expanded, maxDepth))
    : [];
  return { node, kids, isExpanded };
}

export interface LaidOut {
  nodes: PositionedNode[];
  edges: Edge[];
  width: number;
  height: number;
}

export function layout(root: TreeNode, expanded: Set<string>, maxDepth = 64): LaidOut {
  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];

  const sized = build(root, 0, expanded, maxDepth);

  // x is deterministic: first child inherits parent x, siblings step right.
  const xOf = new Map<string, number>();
  function assignX(sn: SizedNode, x: number) {
    xOf.set(sn.node.person.id, x);
    if (!sn.isExpanded) return;
    let cx = x;
    for (const k of sn.kids) {
      assignX(k, cx);
      cx += NODE_W + H_GAP;
    }
  }
  assignX(sized, 0);

  // Placed expanded nodes (depth >= 1). Populated during the rightmost-first
  // DFS placement. By the time we visit N, every expanded node to N's right
  // that is NOT one of N's descendants has already been placed and is in
  // this list — descendants of N have not been visited yet.
  const placed: { x: number; bottomY: number }[] = [];
  const yOf = new Map<string, number>();
  const bottomYOf = new Map<string, number>();

  function place(sn: SizedNode, x: number, y: number, depth: number, parentId: string | null) {
    const { node, isExpanded, kids } = sn;
    yOf.set(node.person.id, y);

    const mode: PositionedNode["childMode"] = isExpanded
      ? depth === 0
        ? "horizontal"
        : "vertical"
      : "none";

    nodes.push({
      id: node.person.id,
      person: node.person,
      x,
      y,
      depth,
      hasChildren: node.children.length > 0,
      expanded: isExpanded,
      parentId,
      childMode: mode,
    });

    if (!isExpanded) {
      bottomYOf.set(node.person.id, y + NODE_H);
      return;
    }

    const gap = depth === 0 ? ROW_GAP : V_GAP;
    let childRowY = y + NODE_H + gap;

    // Only depth >= 1 expansions participate in the bump-down rule.
    if (depth >= 1) {
      const nx = x;
      for (const p of placed) {
        if (p.x > nx) {
          const candidate = p.bottomY + V_GAP;
          if (candidate > childRowY) childRowY = candidate;
        }
      }
    }

    // Visit children rightmost-first so right siblings (and their full
    // subtrees) populate `placed` before we recurse into left siblings.
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      const cx = x + i * (NODE_W + H_GAP);
      place(k, cx, childRowY, depth + 1, node.person.id);
    }

    // Edges in display order (left-to-right) for stable rendering.
    for (let i = 0; i < kids.length; i++) {
      edges.push({
        from: node.person.id,
        to: kids[i].node.person.id,
        mode: depth === 0 ? "horizontal" : "vertical",
      });
    }

    // Bottom of N's subtree = deepest descendant bottom.
    let bottom = y + NODE_H;
    for (const k of kids) {
      const b = bottomYOf.get(k.node.person.id) ?? 0;
      if (b > bottom) bottom = b;
    }
    bottomYOf.set(node.person.id, bottom);

    if (depth >= 1) {
      placed.push({ x, bottomY: bottom });
    }
  }

  place(sized, 0, 0, 0, null);

  const maxX = nodes.reduce((m, n) => Math.max(m, n.x + NODE_W), 0);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + NODE_H), 0);
  return { nodes, edges, width: maxX, height: maxY };
}
