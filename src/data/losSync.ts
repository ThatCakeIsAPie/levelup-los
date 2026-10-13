/**
 * Matching mind-map members (from an uploaded spreadsheet, or people added on
 * the map) to the shared roster. Pure; the people store applies the result.
 *
 * For each entry, in order:
 *  1. a roster person whose `losUid` equals the entry's uid;
 *  2. otherwise, by name, but only when exactly one business person has that
 *     name, they have no `losUid` yet, and the name appears once in the
 *     entries (the match then claims them by setting `losUid`);
 *  3. otherwise a new IBO is created (ambiguous names never merge people).
 *
 * Sponsor links are then aligned with the map, except that an existing
 * person's sponsor is never rewritten to someone created because their name
 * was ambiguous.
 */
import type { CrmPerson } from "@/stores/peopleStore";

export interface LosSyncEntry {
  uid: string;
  name: string;
  sponsorUid: string | null;
}

export type LosMatch = "uid" | "name" | "created";

export interface LosSyncResult {
  people: CrmPerson[];
  /** How each entry uid was resolved, and to which roster id. */
  matches: Map<string, { id: string; how: LosMatch; ambiguous?: boolean }>;
}

const norm = (name: string) => name.trim().toLowerCase();

export function syncLosEntries(people: CrmPerson[], entries: LosSyncEntry[]): LosSyncResult {
  // Copy-on-write: untouched people keep their identity; no change returns `people`.
  const out = [...people];
  const indexOf = new Map(out.map((p, i) => [p.id, i]));
  let changed = false;
  const get = (id: string) => out[indexOf.get(id)!];
  const patch = (id: string, change: Partial<CrmPerson>) => {
    out[indexOf.get(id)!] = { ...get(id), ...change };
    changed = true;
  };

  const byUid = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const p of out) {
    if (p.losUid) byUid.set(p.losUid, p.id);
    if (p.bizClass === "customer") continue;
    byName.set(norm(p.name), [...(byName.get(norm(p.name)) ?? []), p.id]);
  }
  const entryNames = new Map<string, number>();
  for (const e of entries) entryNames.set(norm(e.name), (entryNames.get(norm(e.name)) ?? 0) + 1);

  const matches: LosSyncResult["matches"] = new Map();

  // Pass 1: match or create.
  for (const e of entries) {
    const hit = byUid.get(e.uid);
    if (hit) {
      matches.set(e.uid, { id: hit, how: "uid" });
      continue;
    }
    const same = byName.get(norm(e.name)) ?? [];
    if (same.length === 1 && !get(same[0]).losUid && entryNames.get(norm(e.name)) === 1) {
      patch(same[0], { losUid: e.uid });
      byUid.set(e.uid, same[0]);
      matches.set(e.uid, { id: same[0], how: "name" });
      continue;
    }
    const created: CrmPerson = {
      id: `los-${crypto.randomUUID()}`,
      name: e.name,
      bizClass: "ibo",
      pipelineStage: "ibo",
      sponsorId: null,
      losUid: e.uid,
    };
    indexOf.set(created.id, out.length);
    out.push(created);
    changed = true;
    byUid.set(e.uid, created.id);
    matches.set(e.uid, { id: created.id, how: "created", ambiguous: same.length > 0 });
  }

  // Pass 2: keep sponsor links aligned with the map.
  const existed = new Set(people.map((p) => p.id));
  for (const e of entries) {
    if (!e.sponsorUid) continue;
    const m = matches.get(e.uid);
    const sponsor = matches.get(e.sponsorUid);
    if (!m || !sponsor || get(m.id).sponsorId === sponsor.id) continue;
    if (existed.has(m.id) && sponsor.ambiguous) continue;
    patch(m.id, { sponsorId: sponsor.id });
  }

  return { people: changed ? out : people, matches };
}
