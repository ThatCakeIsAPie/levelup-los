export interface Person {
  id: string;
  /** Stable identity that survives renumbering; links to the shared roster. */
  uid: string;
  name: string;
  sponsorId: string | null;
  rank?: number | string;
  ppv?: number;
  gpv?: number;
  customers?: number;
  /** Total members in this node's subtree, including self. */
  memberCount?: number;
  raw: Record<string, unknown>;
}

export interface TreeNode {
  person: Person;
  children: TreeNode[];
}

export interface PositionedNode {
  id: string;
  person: Person;
  x: number;
  y: number;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
  parentId: string | null;
  /** Layout style chosen for this node's children */
  childMode: "horizontal" | "vertical" | "none";
}

export interface Edge {
  from: string;
  to: string;
  mode: "horizontal" | "vertical";
}
