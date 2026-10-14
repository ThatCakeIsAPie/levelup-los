/**
 * Demo people the pipeline needs on top of the CRM seed, and where every demo
 * prospect sits on the board. Kept free of imports from src/data/seed.ts so
 * that seedPeople() can append these without an import cycle.
 *
 *  - 45 more prospects ("500".."544") spread over Maria's team, outside
 *    Jamal Brown's branch (his branch is pinned by the integration tests);
 *  - 5 people who registered in the last two weeks ("560".."564"), now
 *    apprentices, so the Registered column has real cards.
 *
 * Every date is relative to today. Placements say which column each prospect
 * is in, since how many days, and when they were first contacted; the
 * pipeline seed (./seed.ts) turns them into cards and moves.
 */
import { subDays } from "date-fns";
import { localDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";

const ago = (n: number) => localDate(subDays(new Date(), n));

/** Maria Reyes, the team leader who owns the default steps. */
export const PARTNER_LEADER_ID = "1";

/** Maria's steps (the partner team's defaults), in board order per band. */
export const DEFAULT_STEPS = [
  { id: "s-story", band: "contact", label: "Shared Story" },
  { id: "s-door", band: "contact", label: "Opened the Door" },
  { id: "s-book", band: "first_meeting", label: "Book" },
  { id: "s-mg2", band: "first_meeting", label: "MG2" },
  { id: "s-f1", band: "first_plan", label: "F1" },
  { id: "s-info2", band: "first_plan", label: "Info 2" },
  { id: "s-f2", band: "first_plan", label: "F2" },
  { id: "s-info3", band: "first_plan", label: "Info 3" },
  { id: "s-f3", band: "first_plan", label: "F3+" },
] as const;

/** Anita's own step (her team, Jamal's included, inherits it). */
export const ANITA_STEP = {
  id: "s-3way",
  ownerId: "2",
  band: "first_meeting",
  label: "3-way call",
};
/** David hides Info 3 for his team. */
export const DAVID_HIDES = { personId: "3", stepId: "s-info3" };

export interface Placement {
  personId: string;
  /** Milestone code or step id. */
  column: string;
  enteredDaysAgo: number;
  /** First contact; defaults to the person's joinedDate. */
  contactDaysAgo?: number;
  hot?: boolean;
  source?: string;
  next?: { text: string; inDays: number };
}

export interface Registration {
  personId: string;
  regDaysAgo: number;
  contactDaysAgo: number;
}

function makeRng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ["Tasha Reed", "Omar Lewis", "Grace Kim", "Ray Collins", "Devon Price", "Lena Ortiz", "Marcus Bell", "Ana Cruz", "Tom Reyes", "Ben Ford", "Ana Lopez", "Kim Brooks", "Jay Holt", "Priscilla Moore", "Derek Shaw", "Yasmin Farah", "Victor Huang", "Monique Ellis", "Brandon Cole", "Keisha Grant", "Ethan Brooks", "Sofia Marquez", "Isaac Turner", "Chloe Bennett", "Darius King", "Hailey Ross", "Mateo Silva", "Naomi Fields", "Trevor Lang", "Aaliyah Scott", "Wesley Park", "Bianca Russo", "Jared Mills", "Imani Wright", "Colin Fraser", "Daniela Vega", "Reggie Coleman", "Tanya Brooks", "Kyle Dunn", "Fatima Noor", "Nate Simmons", "Erin Walsh", "Malik Ahmed", "Paige Lowry", "Rudy Castillo"]; // prettier-ignore

/** Who the generated prospects belong to (weights), all outside Jamal's branch. */
const OWNERS: [string, number][] = [["1", 7], ["2", 6], ["3", 5], ["6", 5], ["8", 5], ["7", 4], ["17", 3], ["13", 2], ["14", 2], ["19", 1], ["11", 1], ["104", 1], ["301", 1], ["306", 1]]; // prettier-ignore

const CITY: Record<string, string> = {
  "1": "Dallas, TX",
  "2": "Austin, TX",
  "3": "Houston, TX",
  "6": "Phoenix, AZ",
  "8": "Chicago, IL",
  "7": "Seattle, WA",
  "17": "Charlotte, NC",
  "13": "San Diego, CA",
  "14": "Detroit, MI",
};

const SOURCES = ["Gym", "Coworker", "Referral", "Neighbor", "Church", "Instagram", "Old friend", "Kids' school", "Coffee shop", "Family"]; // prettier-ignore

/** Board columns a generated prospect may sit in, with weights. */
const COLUMN_WEIGHTS: [string, number, number][] = [
  // column, weight, band (0 contact, 1 first meeting, 2 first plan)
  ["contact", 15, 0],
  ["s-story", 9, 0],
  ["s-door", 10, 0],
  ["first_meeting", 8, 1],
  ["s-book", 6, 1],
  ["s-mg2", 7, 1],
  ["first_plan", 5, 2],
  ["s-f1", 8, 2],
  ["s-info2", 5, 2],
  ["s-f2", 4, 2],
  ["s-info3", 2, 2],
  ["s-f3", 3, 2],
];

/** What the next step after each column is usually called. */
export const NEXT_TEXT: Record<string, string> = {
  contact: "Share story",
  "s-story": "Open the door",
  "s-door": "MG1",
  first_meeting: "Book",
  "s-book": "MG2",
  "s-mg2": "Info",
  "s-3way": "Info",
  first_plan: "F1 call",
  "s-f1": "Info 2",
  "s-info2": "F2 call",
  "s-f2": "Info 3",
  "s-info3": "F3",
  "s-f3": "Register",
};

/** Hand-placed existing prospects (the CRM seed's people). */
const EXISTING: Placement[] = [
  { personId: "5", column: "s-f2", enteredDaysAgo: 9, source: "Old friend", next: { text: "Info 3", inDays: 4 } },
  { personId: "9", column: "first_plan", enteredDaysAgo: 3, hot: true, next: { text: "Bring to Fall Weekend", inDays: 26 } },
  { personId: "10", column: "s-door", enteredDaysAgo: 18 },
  { personId: "12", column: "first_meeting", enteredDaysAgo: 2, source: "Gym", next: { text: "Book", inDays: 3 } },
  { personId: "15", column: "s-mg2", enteredDaysAgo: 8, next: { text: "Info", inDays: 2 } },
  { personId: "16", column: "s-f1", enteredDaysAgo: 6, next: { text: "Call", inDays: 1 } },
  { personId: "18", column: "s-story", enteredDaysAgo: 4, source: "Neighbor" },
  { personId: "20", column: "s-info2", enteredDaysAgo: 5, next: { text: "F2 call", inDays: 2 } },
  { personId: "21", column: "s-story", enteredDaysAgo: 2, source: "Coworker", next: { text: "Open the door", inDays: 3 } },
  { personId: "100", column: "s-door", enteredDaysAgo: 6, next: { text: "MG1", inDays: 3 } },
  { personId: "101", column: "s-book", enteredDaysAgo: 10 },
  { personId: "102", column: "contact", enteredDaysAgo: 33 },
  { personId: "103", column: "s-f1", enteredDaysAgo: 24 },
  { personId: "105", column: "s-story", enteredDaysAgo: 5, source: "Instagram" },
  { personId: "110", column: "s-mg2", enteredDaysAgo: 11 },
  { personId: "113", column: "first_meeting", enteredDaysAgo: 4, next: { text: "Book", inDays: 1 } },
  { personId: "200", column: "s-book", enteredDaysAgo: 7, next: { text: "MG2", inDays: 2 } },
  { personId: "202", column: "s-f3", enteredDaysAgo: 12 },
  { personId: "204", column: "s-door", enteredDaysAgo: 4, source: "Coworker", next: { text: "MG1", inDays: 2 } },
  { personId: "205", column: "s-f1", enteredDaysAgo: 13 },
  { personId: "207", column: "s-mg2", enteredDaysAgo: 5 },
  { personId: "209", column: "s-info3", enteredDaysAgo: 8 },
  { personId: "212", column: "s-3way", enteredDaysAgo: 6, next: { text: "Info", inDays: 4 } },
  { personId: "214", column: "first_meeting", enteredDaysAgo: 1, hot: true, next: { text: "Book", inDays: 2 } },
  { personId: "304", column: "s-f2", enteredDaysAgo: 10 },
  { personId: "305", column: "s-info2", enteredDaysAgo: 4, next: { text: "F2 call", inDays: 3 } },
  { personId: "308", column: "s-door", enteredDaysAgo: 3, source: "Family" },
  { personId: "309", column: "s-3way", enteredDaysAgo: 2 },
  { personId: "310", column: "first_plan", enteredDaysAgo: 9 },
  { personId: "311", column: "s-book", enteredDaysAgo: 15 },
]; // prettier-ignore

/** People who registered lately (now apprentices). */
const REGISTERED: { id: string; name: string; sponsorId: string; reg: number; contact: number; ibo: boolean }[] = [
  { id: "560", name: "Rosa Delgado", sponsorId: "2", reg: 1, contact: 41, ibo: false },
  { id: "561", name: "Kevin Osei", sponsorId: "1", reg: 3, contact: 37, ibo: true },
  { id: "562", name: "Hana Sato", sponsorId: "8", reg: 6, contact: 48, ibo: true },
  { id: "563", name: "Luis Romero", sponsorId: "6", reg: 9, contact: 44, ibo: true },
  { id: "564", name: "Megan Clark", sponsorId: "3", reg: 12, contact: 52, ibo: true },
]; // prettier-ignore

interface Plan {
  people: CrmPerson[];
  placements: Placement[];
  registrations: Registration[];
}

let cached: { day: string; plan: Plan } | null = null;

/** The generated people and every prospect's placement (stable for a given day). */
export function pipelineSeedPlan(): Plan {
  const day = localDate();
  if (cached?.day === day) return cached.plan;
  const rng = makeRng(2026);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const weighted = <T>(xs: readonly (readonly [T, number, ...unknown[]])[]): T => {
    const total = xs.reduce((s, x) => s + x[1], 0);
    let r = rng() * total;
    for (const x of xs) {
      r -= x[1];
      if (r < 0) return x[0];
    }
    return xs[xs.length - 1][0];
  };

  const people: CrmPerson[] = [];
  const placements: Placement[] = [...EXISTING];
  NAMES.forEach((name, i) => {
    const id = String(500 + i);
    const owner = weighted(OWNERS);
    const column = weighted(COLUMN_WEIGHTS);
    const band = COLUMN_WEIGHTS.find((c) => c[0] === column)![2];
    const entered = rng() < 0.8 ? Math.floor(rng() * 12) : 13 + Math.floor(rng() * 16);
    const gap =
      column === "contact"
        ? 0
        : band === 0
          ? 1 + Math.floor(rng() * 6)
          : band === 1
            ? 6 + Math.floor(rng() * 20)
            : 14 + Math.floor(rng() * 32);
    const contact = entered + gap;
    const fresh = entered < 13;
    placements.push({
      personId: id,
      column,
      enteredDaysAgo: entered,
      contactDaysAgo: contact,
      hot: fresh && rng() < 0.1,
      source: rng() < 0.5 ? pick(SOURCES) : undefined,
      next:
        fresh && rng() < 0.6
          ? { text: NEXT_TEXT[column], inDays: 1 + Math.floor(rng() * 6) }
          : undefined,
    });
    people.push({
      id,
      name,
      bizClass: "prospect",
      sponsorId: owner,
      pipelineStage: "prospect",
      joinedDate: ago(contact),
      ...(CITY[owner] && rng() < 0.6 ? { location: CITY[owner] } : {}),
    });
  });

  const registrations: Registration[] = [];
  for (const r of REGISTERED) {
    people.push({
      id: r.id,
      name: r.name,
      bizClass: "apprentice",
      sponsorId: r.sponsorId,
      pipelineStage: "apprentice",
      businessStartDate: ago(r.reg),
      joinedDate: ago(r.contact),
      ltdNumber: "LTD-501",
      ...(r.ibo ? { iboNumber: `IBO-${r.id}` } : {}),
      ...(CITY[r.sponsorId] ? { location: CITY[r.sponsorId] } : {}),
    });
    registrations.push({ personId: r.id, regDaysAgo: r.reg, contactDaysAgo: r.contact });
  }

  const plan = { people, placements, registrations };
  cached = { day, plan };
  return plan;
}

/** Extra demo people for seedPeople() (fresh copies). */
export function pipelineSeedPeople(): CrmPerson[] {
  return pipelineSeedPlan().people.map((p) => ({ ...p }));
}
