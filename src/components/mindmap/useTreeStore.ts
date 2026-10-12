import { create } from "zustand";
import type { Person, TreeNode } from "./types";
import { buildForest, collectIds, normalizeForest, rowsToPeople } from "./buildTree";
import type { FieldMap, Row } from "@/lib/parseSpreadsheet";
import { usePeopleStore, type LosSyncEntry } from "@/stores/peopleStore";

export type NewMemberClass = "apprentice" | "ibo";

export interface NewMemberInput {
  name: string;
  bizClass: NewMemberClass;
  businessStartDate?: string;
  iboNumber?: string;
  ltdNumber?: string;
  location?: string;
}

interface TreeState {
  people: Person[];
  roots: TreeNode[];
  expanded: Set<string>;
  selectedId: string | null;
  /** Node ids whose customer circles are revealed. */
  showCustomers: Set<string>;
  showAllCustomers: boolean;
  /** Node id whose full customer list panel is open. */
  customerPanelId: string | null;
  loadRows: (rows: Row[], map: FieldMap) => void;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  select: (id: string | null) => void;
  toggleCustomers: (id: string) => void;
  setShowAllCustomers: (v: boolean) => void;
  openCustomerPanel: (id: string | null) => void;
  addMember: (parentId: string, input: NewMemberInput) => void;
}

function flatten(roots: TreeNode[]): Person[] {
  const flat: Person[] = [];
  const walk = (n: TreeNode) => {
    flat.push(n.person);
    n.children.forEach(walk);
  };
  roots.forEach(walk);
  return flat;
}

function syncEntries(roots: TreeNode[]): LosSyncEntry[] {
  const out: LosSyncEntry[] = [];
  const walk = (n: TreeNode, sponsorUid: string | null) => {
    out.push({ uid: n.person.uid, name: n.person.name, sponsorUid });
    n.children.forEach((c) => walk(c, n.person.uid));
  };
  roots.forEach((r) => walk(r, null));
  return out;
}

function findNode(roots: TreeNode[], id: string): TreeNode | null {
  for (const r of roots) {
    if (r.person.id === id) return r;
    const hit = findNode(r.children, id);
    if (hit) return hit;
  }
  return null;
}

export const useTreeStore = create<TreeState>((set, get) => ({
  people: [],
  roots: [],
  expanded: new Set(),
  selectedId: null,
  showCustomers: new Set(),
  showAllCustomers: false,
  customerPanelId: null,
  loadRows: (rows, map) => {
    const people = rowsToPeople(rows, map);
    const roots = normalizeForest(buildForest(people));
    const expanded = new Set<string>(roots.map((r) => r.person.id));
    set({ people: flatten(roots), roots, expanded, selectedId: null });
    usePeopleStore.getState().syncFromLos(syncEntries(roots));
  },
  toggle: (id) => {
    const next = new Set(get().expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ expanded: next });
  },
  expandAll: () => {
    const all = new Set<string>();
    get().roots.forEach((r) => collectIds(r, all));
    set({ expanded: all });
  },
  collapseAll: () => set({ expanded: new Set() }),
  select: (id) => set({ selectedId: id }),
  toggleCustomers: (id) => {
    const next = new Set(get().showCustomers);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ showCustomers: next });
  },
  setShowAllCustomers: (v) => set({ showAllCustomers: v }),
  openCustomerPanel: (id) => set({ customerPanelId: id }),
  addMember: (parentId, input) => {
    const { roots, expanded, people } = get();
    const parent = findNode(roots, parentId);
    if (!parent) return;

    // Remember expansion by stable uid — normalizeForest renumbers ids.
    const uidById = new Map(people.map((p) => [p.id, p.uid] as const));
    const expandedUids = new Set<string>();
    expanded.forEach((id) => {
      const uid = uidById.get(id);
      if (uid) expandedUids.add(uid);
    });
    expandedUids.add(parent.person.uid);

    const uid = crypto.randomUUID();
    const child: TreeNode = {
      person: {
        id: uid,
        uid,
        name: input.name,
        sponsorId: parent.person.id,
        ppv: 300,
        gpv: 300,
        memberCount: 1,
        raw: {},
      },
      children: [],
    };
    parent.children.push(child);

    const nextRoots = normalizeForest(roots.map((r) => r));
    const flat = flatten(nextRoots);
    const nextExpanded = new Set<string>();
    flat.forEach((p) => {
      if (expandedUids.has(p.uid)) nextExpanded.add(p.id);
    });

    set({ roots: nextRoots, people: flat, expanded: nextExpanded });

    const store = usePeopleStore.getState();
    store.syncFromLos(syncEntries(nextRoots));
    const rosterPerson = usePeopleStore.getState().getByLosUid(uid);
    if (rosterPerson) {
      store.update(rosterPerson.id, {
        bizClass: input.bizClass,
        pipelineStage: input.bizClass,
        businessStartDate: input.businessStartDate,
        iboNumber: input.iboNumber,
        ltdNumber: input.ltdNumber,
        location: input.location,
      });
    }
  },
}));
