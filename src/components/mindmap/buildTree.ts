import type { FieldMap, Row } from "@/lib/parseSpreadsheet";
import type { Person, TreeNode } from "./types";

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[$,%]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function rowsToPeople(rows: Row[], map: FieldMap): Person[] {
  return rows
    .map((r) => {
      const id = String(r[map.id] ?? "").trim();
      if (!id) return null;
      let name = "";
      if (map.name && r[map.name]) name = String(r[map.name]);
      else if (map.lastName || map.firstName) {
        const last = map.lastName ? String(r[map.lastName] ?? "") : "";
        const first = map.firstName ? String(r[map.firstName] ?? "") : "";
        name = last && first ? `${last}, ${first}` : last || first;
      }
      if (!name) name = id;
      const sponsorRaw = map.sponsorId ? r[map.sponsorId] : null;
      const sponsorId =
        sponsorRaw === null || sponsorRaw === undefined || sponsorRaw === ""
          ? null
          : String(sponsorRaw).trim();
      return {
        id,
        uid: crypto.randomUUID(),
        name,
        sponsorId,
        rank: map.rank ? (r[map.rank] as string | number | undefined) : undefined,
        ppv: map.ppv ? toNum(r[map.ppv]) : undefined,
        gpv: map.gpv ? toNum(r[map.gpv]) : undefined,
        customers: map.customers ? toNum(r[map.customers]) : undefined,
        raw: r as Record<string, unknown>,
      } as Person;
    })
    .filter((p): p is Person => !!p);
}

export function buildForest(people: Person[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  people.forEach((p) => byId.set(p.id, { person: p, children: [] }));
  const roots: TreeNode[] = [];
  byId.forEach((node) => {
    const sid = node.person.sponsorId;
    if (sid && byId.has(sid) && sid !== node.person.id) {
      byId.get(sid)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

export function collectIds(node: TreeNode, out: Set<string> = new Set()): Set<string> {
  out.add(node.person.id);
  node.children.forEach((c) => collectIds(c, out));
  return out;
}

function subtreeDescendantCount(node: TreeNode): number {
  let n = node.children.length;
  for (const c of node.children) n += subtreeDescendantCount(c);
  return n;
}

/**
 * Normalize the parsed forest:
 *  - Sort children (and roots) by total downline count DESC, tie-break by GPV DESC.
 *  - Keep each person's PPV as given (0 when missing).
 *  - Recompute GPV as the sum of PPV in the subtree (incl. self).
 *  - Stamp memberCount = total nodes in the subtree (incl. self).
 *  - Re-assign sequential IDs in DFS order (post-sort) starting at 1.
 *    Sponsor IDs are rewritten to match.
 */
export function normalizeForest(roots: TreeNode[]): TreeNode[] {
  // 1. Recursive sort: heaviest downline first, GPV tie-breaker.
  function sortRec(nodes: TreeNode[]): TreeNode[] {
    const sorted = [...nodes].sort((a, b) => {
      const d = subtreeDescendantCount(b) - subtreeDescendantCount(a);
      if (d !== 0) return d;
      return (b.person.gpv ?? 0) - (a.person.gpv ?? 0);
    });
    for (const n of sorted) n.children = sortRec(n.children);
    return sorted;
  }
  const sortedRoots = sortRec(roots);

  // 2. Missing PPV counts as 0.
  function setPpv(n: TreeNode) {
    n.person.ppv ??= 0;
    n.children.forEach(setPpv);
  }
  sortedRoots.forEach(setPpv);

  // 3. memberCount + GPV bottom-up.
  function tally(n: TreeNode): number {
    let count = 1;
    let gpv = n.person.ppv ?? 0;
    for (const c of n.children) {
      count += tally(c);
      gpv += c.person.gpv ?? 0;
    }
    n.person.memberCount = count;
    n.person.gpv = gpv;
    return count;
  }
  sortedRoots.forEach(tally);

  // 4. Reassign IDs in DFS order (post-sort) starting at 1.
  let next = 1;
  function renumber(n: TreeNode, parentNewId: string | null) {
    const newId = String(next++);
    n.person.id = newId;
    n.person.sponsorId = parentNewId;
    for (const c of n.children) renumber(c, newId);
  }
  sortedRoots.forEach((r) => renumber(r, null));

  return sortedRoots;
}
