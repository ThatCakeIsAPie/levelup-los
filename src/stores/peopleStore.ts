import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logPerson } from "./activityStore";

/**
 * Two relationship paths:
 *  - Business path: prospect -> apprentice -> ibo
 *      An apprentice is a prospect who qualified and became an IBO. During
 *      their first contract year they are an "apprentice"; one year after
 *      their business start date they are automatically an IBO.
 *  - Customer path: a customer always belongs to one apprentice or IBO
 *      (their owner) and never has a downline.
 */
export type BizClass = "prospect" | "apprentice" | "ibo" | "customer";

export type PipelineStage = "prospect" | "apprentice" | "ibo";

export type PersonPath = "business" | "customer";

export interface StageChange {
  stage: PipelineStage;
  at: string; // ISO timestamp
}

export interface CrmPerson {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  bizClass: BizClass;
  iboNumber?: string;
  ltdNumber?: string;
  location?: string;
  sponsorId?: string | null;
  /** Date the business was started — drives the apprentice -> IBO promotion. */
  businessStartDate?: string; // ISO date
  joinedDate?: string; // ISO date
  /** Customers only: the apprentice/IBO who owns this customer. */
  ownerId?: string | null;
  /** Customers only: monthly volume, used to rank top-producing customers. */
  monthlyVolume?: number;
  notes?: string;
  pipelineStage?: PipelineStage;
  stageHistory?: StageChange[];
  tags?: string[];
  lastUpdatedAt?: string; // ISO
  /** Stable link to a mind-map node (shared roster). */
  losUid?: string;
}

export interface LosSyncEntry {
  uid: string;
  name: string;
  sponsorUid: string | null;
}

interface PeopleState {
  people: CrmPerson[];
  add: (p: Omit<CrmPerson, "id"> & { id?: string }) => CrmPerson;
  update: (id: string, patch: Partial<CrmPerson>) => void;
  remove: (id: string) => void;
  getById: (id: string) => CrmPerson | undefined;
  getByLosUid: (uid: string) => CrmPerson | undefined;
  bulkAdd: (people: CrmPerson[]) => void;
  /** Upsert mind-map members into the shared roster, matched by losUid/name. */
  syncFromLos: (entries: LosSyncEntry[]) => void;
}

export const DAY = 24 * 60 * 60 * 1000;

export function isCustomer(p: CrmPerson): boolean {
  return p.bizClass === "customer";
}

export function personPath(p: CrmPerson): PersonPath {
  return isCustomer(p) ? "customer" : "business";
}

function addOneYear(iso: string): Date {
  const d = new Date(iso);
  return new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
}

/**
 * An apprentice whose first contract year has elapsed is treated as an IBO.
 */
export function effectiveBizClass(p: CrmPerson, today = new Date()): BizClass {
  if (p.bizClass !== "apprentice" || !p.businessStartDate) return p.bizClass;
  return addOneYear(p.businessStartDate) <= today ? "ibo" : "apprentice";
}

export type ApprenticeAlert = "90d" | "30d" | "due" | null;

/** Warn 90 and 30 days before the apprentice anniversary. */
export function apprenticeAlertLevel(p: CrmPerson, today = new Date()): ApprenticeAlert {
  if (p.bizClass !== "apprentice" || !p.businessStartDate) return null;
  const anniversary = addOneYear(p.businessStartDate);
  const days = Math.ceil((anniversary.getTime() - today.getTime()) / DAY);
  if (days <= 0) return "due";
  if (days <= 30) return "30d";
  if (days <= 90) return "90d";
  return null;
}

export function apprenticeAlertLabel(level: ApprenticeAlert): string {
  switch (level) {
    case "due": return "Apprentice year complete — now an IBO";
    case "30d": return "Becomes an IBO within 30 days";
    case "90d": return "Becomes an IBO within 90 days";
    default: return "";
  }
}

export function customersOf(people: CrmPerson[], ownerId: string): CrmPerson[] {
  return people
    .filter((p) => p.bizClass === "customer" && p.ownerId === ownerId)
    .sort((a, b) => (b.monthlyVolume ?? 0) - (a.monthlyVolume ?? 0));
}

export function topCustomers(people: CrmPerson[], ownerId: string, n = 3): CrmPerson[] {
  return customersOf(people, ownerId).slice(0, n);
}

export const bizClassLabel: Record<BizClass, string> = {
  prospect: "Prospect",
  apprentice: "Apprentice",
  ibo: "IBO",
  customer: "Customer",
};

export const bizClassShort: Record<BizClass, string> = {
  prospect: "P",
  apprentice: "A",
  ibo: "IBO",
  customer: "Cust",
};

function defaultStage(bc: BizClass): PipelineStage | undefined {
  if (bc === "customer") return undefined;
  return bc === "ibo" ? "ibo" : bc === "apprentice" ? "apprentice" : "prospect";
}

export const seed: CrmPerson[] = [
  { id: "1", name: "Maria Reyes", bizClass: "ibo", iboNumber: "IBO-1001", ltdNumber: "LTD-501", location: "Dallas, TX", sponsorId: null, businessStartDate: "2019-03-12", joinedDate: "2019-03-12", email: "maria@example.com", phone: "214-555-0101", pipelineStage: "ibo", tags: ["leader"] },
  { id: "2", name: "Anita Patel", bizClass: "ibo", iboNumber: "IBO-1002", ltdNumber: "LTD-501", location: "Austin, TX", sponsorId: "1", businessStartDate: "2020-06-01", joinedDate: "2020-06-01", email: "anita@example.com", phone: "512-555-0102", pipelineStage: "ibo" },
  { id: "3", name: "David Chen", bizClass: "ibo", iboNumber: "IBO-1003", ltdNumber: "LTD-501", location: "Houston, TX", sponsorId: "1", businessStartDate: "2020-08-15", joinedDate: "2020-08-15", phone: "713-555-0103", pipelineStage: "ibo" },
  { id: "4", name: "Jamal Brown", bizClass: "apprentice", iboNumber: "IBO-1004", ltdNumber: "LTD-501", location: "Atlanta, GA", sponsorId: "2", businessStartDate: "2026-04-10", joinedDate: "2026-04-10", email: "jamal@example.com", pipelineStage: "apprentice" },
  { id: "5", name: "Linh Nguyen", bizClass: "prospect", location: "San Jose, CA", sponsorId: "2", pipelineStage: "prospect" },
  { id: "6", name: "Marcus Hill", bizClass: "ibo", iboNumber: "IBO-1006", ltdNumber: "LTD-501", location: "Phoenix, AZ", sponsorId: "1", businessStartDate: "2021-04-22", joinedDate: "2021-04-22", email: "marcus@example.com", pipelineStage: "ibo" },
  { id: "7", name: "Sarah Kim", bizClass: "apprentice", iboNumber: "IBO-1007", ltdNumber: "LTD-501", location: "Seattle, WA", sponsorId: "3", businessStartDate: "2026-02-14", joinedDate: "2026-02-14", pipelineStage: "apprentice" },
  { id: "8", name: "Priya Singh", bizClass: "ibo", iboNumber: "IBO-1008", ltdNumber: "LTD-501", location: "Chicago, IL", sponsorId: "1", businessStartDate: "2022-09-09", joinedDate: "2022-09-09", email: "priya@example.com", pipelineStage: "ibo" },
  { id: "9", name: "Carlos Rivera", bizClass: "prospect", location: "Miami, FL", sponsorId: "4", pipelineStage: "prospect" },
  { id: "10", name: "Emily Foster", bizClass: "prospect", location: "Denver, CO", sponsorId: "6", pipelineStage: "prospect" },
  { id: "11", name: "Tom Walker", bizClass: "apprentice", iboNumber: "IBO-1011", ltdNumber: "LTD-501", location: "Portland, OR", sponsorId: "7", businessStartDate: "2025-12-01", joinedDate: "2025-12-01", pipelineStage: "apprentice" },
  { id: "12", name: "Nia Owens", bizClass: "prospect", location: "Boston, MA", sponsorId: "8", pipelineStage: "prospect" },
  { id: "13", name: "Felix Wong", bizClass: "ibo", iboNumber: "IBO-1013", ltdNumber: "LTD-501", location: "San Diego, CA", sponsorId: "3", businessStartDate: "2021-11-30", joinedDate: "2021-11-30", pipelineStage: "ibo" },
  { id: "14", name: "Layla Hassan", bizClass: "apprentice", iboNumber: "IBO-1014", ltdNumber: "LTD-501", location: "Detroit, MI", sponsorId: "8", businessStartDate: "2026-01-05", joinedDate: "2026-01-05", email: "layla@example.com", pipelineStage: "apprentice" },
  { id: "15", name: "Marco Diaz", bizClass: "prospect", location: "Las Vegas, NV", sponsorId: "13", pipelineStage: "prospect" },
  { id: "16", name: "June Park", bizClass: "prospect", location: "Nashville, TN", sponsorId: "13", pipelineStage: "prospect" },
  { id: "17", name: "Ed Miller", bizClass: "ibo", iboNumber: "IBO-1017", ltdNumber: "LTD-501", location: "Charlotte, NC", sponsorId: "2", businessStartDate: "2020-12-12", joinedDate: "2020-12-12", pipelineStage: "ibo" },
  { id: "18", name: "Joy Reed", bizClass: "prospect", location: "Minneapolis, MN", sponsorId: "11", pipelineStage: "prospect" },
  { id: "19", name: "Sky Ortiz", bizClass: "apprentice", iboNumber: "IBO-1019", ltdNumber: "LTD-501", location: "Salt Lake City, UT", sponsorId: "6", businessStartDate: "2025-11-20", joinedDate: "2025-11-20", pipelineStage: "apprentice" },
  { id: "20", name: "Beau Foster", bizClass: "prospect", location: "Kansas City, MO", sponsorId: "10", pipelineStage: "prospect" },

  // Customer path — always downstream from an apprentice or IBO.
  { id: "c1", name: "Grace Lin", bizClass: "customer", ownerId: "1", location: "Dallas, TX", email: "grace@example.com", monthlyVolume: 180, joinedDate: "2024-05-02" },
  { id: "c2", name: "Peter Vargas", bizClass: "customer", ownerId: "1", location: "Plano, TX", monthlyVolume: 120, joinedDate: "2024-09-14" },
  { id: "c3", name: "Hannah Boyd", bizClass: "customer", ownerId: "1", location: "Irving, TX", monthlyVolume: 95, joinedDate: "2025-01-20" },
  { id: "c4", name: "Omar Haddad", bizClass: "customer", ownerId: "1", location: "Dallas, TX", monthlyVolume: 60, joinedDate: "2025-06-01" },
  { id: "c5", name: "Julia Stern", bizClass: "customer", ownerId: "2", location: "Austin, TX", monthlyVolume: 210, joinedDate: "2023-11-11" },
  { id: "c6", name: "Wes Carver", bizClass: "customer", ownerId: "2", location: "Round Rock, TX", monthlyVolume: 75, joinedDate: "2025-03-08" },
  { id: "c7", name: "Dana Pratt", bizClass: "customer", ownerId: "3", location: "Houston, TX", monthlyVolume: 140, joinedDate: "2024-02-19" },
  { id: "c8", name: "Kofi Mensah", bizClass: "customer", ownerId: "4", location: "Atlanta, GA", monthlyVolume: 55, joinedDate: "2026-05-03" },
  { id: "c9", name: "Rosa Iglesias", bizClass: "customer", ownerId: "8", location: "Chicago, IL", monthlyVolume: 165, joinedDate: "2024-07-30" },
  { id: "c10", name: "Ben Tucker", bizClass: "customer", ownerId: "13", location: "San Diego, CA", monthlyVolume: 88, joinedDate: "2025-08-12" },
];

// Deterministic stress-test downlines under David Chen (3), Jamal Brown (4), Linh Nguyen (5).
(() => {
  const FIRST = ["Alex","Jordan","Taylor","Morgan","Casey","Riley","Avery","Quinn","Sage","Drew","Reese","Skylar","Rowan","Emerson","Hayden","Parker","Logan","Cameron","Devon","Finley","Harper","Jamie","Kai","Lane","Micah","Noa","Owen","Remy","Sasha","Tatum","Val","Wren","Zane","Blair","Cody","Dana","Eli","Frankie","Gray"];
  const LAST = ["Stone","Rivers","Walker","Hayes","Bennett","Cruz","Ford","Hughes","Iverson","Jenkins","Knox","Lopez","Marsh","Nash","Pierce","Quincy","Reyes","Sutton","Tate","Underwood","Vance","Ward","Xiong","Young","Zimmer","Abbott","Bishop","Carter","Doyle"];
  let t = 42;
  const rng = () => { t += 0x6d2b79f5; let r = Math.imul(t ^ (t >>> 15), t | 1); r ^= r + Math.imul(r ^ (r >>> 7), r | 61); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  const used = new Set(seed.map((p) => p.name));
  [["3", 100], ["4", 200], ["5", 300]].forEach(([root, start]) => {
    const pool = [root as string];
    for (let i = 0; i < 15; i++) {
      const id = String((start as number) + i);
      let name = "";
      do { name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`; } while (used.has(name));
      used.add(name);
      const r = rng();
      const bizClass: BizClass = r < 0.35 ? "ibo" : r < 0.6 ? "apprentice" : "prospect";
      const sponsorId = pool[Math.floor(rng() * pool.length)];
      const biz = bizClass !== "prospect";
      seed.push({
        id, name, bizClass, sponsorId, pipelineStage: bizClass as PipelineStage,
        iboNumber: biz ? `IBO-${id}` : undefined, ltdNumber: biz ? "LTD-501" : undefined,
        businessStartDate: bizClass === "apprentice" ? "2026-03-01" : bizClass === "ibo" ? "2023-05-01" : undefined,
      });
      pool.push(id);
    }
  });
})();
seed.forEach((p) => {
  if (p.pipelineStage) {
    p.stageHistory = [{ stage: p.pipelineStage, at: "2024-01-01T00:00:00.000Z" }];
  }
});

export const usePeopleStore = create<PeopleState>()(persist((set, get) => ({
  people: seed,
  add: (p) => {
    const stage = p.bizClass === "customer" ? undefined : p.pipelineStage ?? defaultStage(p.bizClass);
    const now = new Date().toISOString();
    const person: CrmPerson = {
      ...p,
      id: p.id ?? crypto.randomUUID(),
      pipelineStage: stage,
      stageHistory: stage ? [{ stage, at: now }] : undefined,
      lastUpdatedAt: now,
    };
    set({ people: [...get().people, person] });
    logPerson("created", person.id, `Added ${person.name} (${bizClassLabel[person.bizClass]})`);
    return person;
  },
  update: (id, patch) => {
    const prev = get().people.find((p) => p.id === id);
    if (!prev) return;
    const now = new Date().toISOString();
    let stageHistory = prev.stageHistory ?? [];
    if (patch.pipelineStage && patch.pipelineStage !== prev.pipelineStage) {
      stageHistory = [...stageHistory, { stage: patch.pipelineStage, at: now }];
      logPerson(
        "stage_changed",
        id,
        `Pipeline → ${patch.pipelineStage}`,
        { from: prev.pipelineStage, to: patch.pipelineStage },
      );
    } else {
      const p1 = patch as unknown as Record<string, unknown>;
      const p0 = prev as unknown as Record<string, unknown>;
      const changedKeys = Object.keys(patch).filter((k) => p1[k] !== p0[k]);
      if (changedKeys.length) {
        logPerson("updated", id, `Edited ${changedKeys.join(", ")}`);
      }
    }
    set({
      people: get().people.map((p) =>
        p.id === id ? { ...p, ...patch, stageHistory, lastUpdatedAt: now } : p,
      ),
    });
  },
  remove: (id) => {
    const prev = get().people.find((p) => p.id === id);
    set({ people: get().people.filter((p) => p.id !== id) });
    if (prev) logPerson("deleted", id, `Removed ${prev.name}`);
  },
  getById: (id) => get().people.find((p) => p.id === id),
  getByLosUid: (uid) => get().people.find((p) => p.losUid === uid),
  bulkAdd: (people) => set({ people: [...get().people, ...people] }),
  syncFromLos: (entries) => {
    const people = [...get().people];
    const byUid = new Map(people.filter((p) => p.losUid).map((p) => [p.losUid!, p]));
    const byName = new Map(people.map((p) => [p.name.trim().toLowerCase(), p] as const));
    const uidToRosterId = new Map<string, string>();

    // Pass 1: match or create.
    for (const e of entries) {
      const existing = byUid.get(e.uid) ?? byName.get(e.name.trim().toLowerCase());
      if (existing) {
        uidToRosterId.set(e.uid, existing.id);
        if (existing.losUid !== e.uid) existing.losUid = e.uid;
      } else {
        const created: CrmPerson = {
          id: `los-${e.uid.slice(0, 8)}-${people.length}`,
          name: e.name,
          bizClass: "ibo",
          pipelineStage: "ibo",
          sponsorId: null,
          losUid: e.uid,
        };
        people.push(created);
        byUid.set(e.uid, created);
        byName.set(created.name.trim().toLowerCase(), created);
        uidToRosterId.set(e.uid, created.id);
      }
    }

    // Pass 2: keep sponsor links aligned with the mind map.
    for (const e of entries) {
      const rosterId = uidToRosterId.get(e.uid);
      if (!rosterId) continue;
      const person = people.find((p) => p.id === rosterId);
      if (!person) continue;
      const sponsorRosterId = e.sponsorUid ? uidToRosterId.get(e.sponsorUid) ?? null : null;
      if (sponsorRosterId && person.sponsorId !== sponsorRosterId) {
        person.sponsorId = sponsorRosterId;
      }
    }

    set({ people: [...people] });
  },
}), { name: "levelup.people", storage: createJSONStorage(() => localStorage), partialize: (s) => ({ people: s.people }) }));

export function missingRequiredFields(p: CrmPerson): string[] {
  const m: string[] = [];
  if (!p.name?.trim()) m.push("name");
  if (p.bizClass === "customer") {
    if (!p.ownerId) m.push("owner");
    return m;
  }
  if (p.bizClass === "ibo" || p.bizClass === "apprentice") {
    if (!p.iboNumber?.trim()) m.push("iboNumber");
    if (!p.ltdNumber?.trim()) m.push("ltdNumber");
  }
  if (p.bizClass === "apprentice" && !p.businessStartDate) m.push("businessStartDate");
  return m;
}
