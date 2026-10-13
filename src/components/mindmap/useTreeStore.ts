import { create } from "zustand";
import type { Person, TreeNode } from "./types";
import { buildForest, collectIds, normalizeForest, rowsToPeople } from "./buildTree";
import type { FieldMap, Row } from "@/lib/parseSpreadsheet";
import {
  addPerson,
  getPersonByLosUid,
  syncPeopleFromLos,
  updatePerson,
  type LosSyncEntry,
} from "@/data";

export type NewMemberClass = "apprentice" | "ibo";

export interface NewMemberInput {
  name: string;
  bizClass: NewMemberClass;
  businessStartDate?: string;
  iboNumber?: string;
  ltdNumber?: string;
  location?: string;
}

/** Where the current tree came from. */
export type TreeSource = "roster" | "upload";

export interface LoadOptions {
  source: TreeSource;
  /** Roster: signature of the visible team. Upload: the uploader's person id. */
  key: string;
  /** Keep expanded/selected nodes (matched by name) across the reload. */
  keepExpanded?: boolean;
}

interface TreeState {
  people: Person[];
  source: TreeSource | null;
  sourceKey: string | null;
  roots: TreeNode[];
  expanded: Set<string>;
  selectedId: string | null;
  /** Node ids whose customer circles are revealed. */
  showCustomers: Set<string>;
  showAllCustomers: boolean;
  /** Node id whose full customer list panel is open. */
  customerPanelId: string | null;
  loadRows: (rows: Row[], map: FieldMap, opts: LoadOptions) => void;
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

const ROSTER_UID = "roster:";

/**
 * The roster person id a map node stands for, when the map was drawn from
 * the roster (their uid is "roster:<id>"). Uploaded maps link through
 * `losUid` instead.
 */
export function rosterIdOf(p: Person): string | undefined {
  return p.uid.startsWith(ROSTER_UID) ? p.uid.slice(ROSTER_UID.length) : undefined;
}

/**
 * Stable uids so reloading the same source links to the same roster people:
 * roster maps use the roster id; uploads use the sheet's own member id plus
 * the name (re-uploading the same file matches by losUid instead of by name).
 */
function stampUids(people: Person[], source: TreeSource): void {
  for (const p of people) {
    p.uid =
      source === "roster" ? `${ROSTER_UID}${p.id}` : `sheet:${p.id}:${p.name.trim().toLowerCase()}`;
  }
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
  source: null,
  sourceKey: null,
  roots: [],
  expanded: new Set(),
  selectedId: null,
  showCustomers: new Set(),
  showAllCustomers: false,
  customerPanelId: null,
  loadRows: (rows, map, opts) => {
    const prev = get();
    const people = rowsToPeople(rows, map);
    stampUids(people, opts.source);
    const roots = normalizeForest(buildForest(people));
    const flat = flatten(roots);
    let expanded = new Set<string>(roots.map((r) => r.person.id));
    let showCustomers = new Set<string>();
    let selectedId: string | null = null;
    if (opts.keepExpanded) {
      // Ids are renumbered on every load; carry view state over by name.
      const nameOf = new Map(prev.people.map((p) => [p.id, p.name] as const));
      const idsByName = new Map<string, string[]>();
      flat.forEach((p) => idsByName.set(p.name, [...(idsByName.get(p.name) ?? []), p.id]));
      const remap = (ids: Iterable<string>, into = new Set<string>()) => {
        for (const id of ids) {
          const name = nameOf.get(id);
          if (name) idsByName.get(name)?.forEach((n) => into.add(n));
        }
        return into;
      };
      expanded = remap(prev.expanded, expanded);
      showCustomers = remap(prev.showCustomers);
      if (prev.selectedId) selectedId = [...remap([prev.selectedId])][0] ?? null;
    }
    set({
      people: flat,
      roots,
      expanded,
      selectedId,
      showCustomers,
      customerPanelId: null,
      source: opts.source,
      sourceKey: opts.key,
    });
    // A roster map is drawn from the roster itself: nothing to sync back.
    if (opts.source === "upload") syncPeopleFromLos(syncEntries(roots));
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

    const details = {
      bizClass: input.bizClass,
      pipelineStage: input.bizClass,
      businessStartDate: input.businessStartDate,
      iboNumber: input.iboNumber,
      ltdNumber: input.ltdNumber,
      location: input.location,
    };
    const sponsorId = rosterIdOf(parent.person);
    if (sponsorId) {
      // Roster map: add them straight to the roster; the map redraws from it.
      addPerson({ name: input.name, sponsorId, ...details });
      return;
    }
    syncPeopleFromLos(syncEntries(nextRoots));
    const rosterPerson = getPersonByLosUid(uid);
    if (rosterPerson) updatePerson(rosterPerson.id, details);
  },
}));
