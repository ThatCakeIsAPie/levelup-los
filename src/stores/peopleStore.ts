import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { logPerson } from "./activityStore";
import { parseDate } from "@/lib/dates";
import { seedPeople, SEED_VERSION } from "@/data/seed";

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
  const d = parseDate(iso);
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
    case "due":
      return "Apprentice year complete — now an IBO";
    case "30d":
      return "Becomes an IBO within 30 days";
    case "90d":
      return "Becomes an IBO within 90 days";
    default:
      return "";
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

export const usePeopleStore = create<PeopleState>()(
  persist(
    (set, get) => ({
      people: seedPeople(),
      add: (p) => {
        const stage =
          p.bizClass === "customer" ? undefined : (p.pipelineStage ?? defaultStage(p.bizClass));
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
          logPerson("stage_changed", id, `Pipeline → ${patch.pipelineStage}`, {
            from: prev.pipelineStage,
            to: patch.pipelineStage,
          });
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
          const sponsorRosterId = e.sponsorUid ? (uidToRosterId.get(e.sponsorUid) ?? null) : null;
          if (sponsorRosterId && person.sponsorId !== sponsorRosterId) {
            person.sponsorId = sponsorRosterId;
          }
        }

        set({ people: [...people] });
      },
    }),
    {
      name: "levelup.people",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ people: s.people }),
      version: SEED_VERSION,
      // Older saved data predates the relative-date seed: start fresh.
      migrate: () => ({ people: seedPeople() }) as unknown as PeopleState,
    },
  ),
);

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
