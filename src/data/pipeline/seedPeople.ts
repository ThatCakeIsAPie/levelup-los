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
import type { ContactRating } from "../rating";

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
  /** Milestone code, step id, or "referral_source" (reached from Contact made). */
  column: string;
  enteredDaysAgo: number;
  /** First contact; defaults to the person's joinedDate. */
  contactDaysAgo?: number;
  /** Hot / Warm / Cold (src/data/rating.ts). */
  rating?: ContactRating;
  source?: string;
  /**
   * The booked next step: a column on the owner's board, in `inDays` days
   * (0 = today, negative = overdue), at `time` ("HH:MM") if given. A column
   * the owner's board doesn't show books the next column instead.
   */
  next?: { column: string; inDays: number; time?: string };
  /** The card's note. */
  note?: string;
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

/** The column a card in each column usually books next. */
export const NEXT_COLUMN: Record<string, string> = {
  contact: "s-story",
  "s-story": "s-door",
  "s-door": "first_meeting",
  first_meeting: "s-book",
  "s-book": "s-mg2",
  "s-mg2": "first_plan",
  "s-3way": "first_plan",
  first_plan: "s-f1",
  "s-f1": "s-info2",
  "s-info2": "s-f2",
  "s-f2": "s-info3",
  "s-info3": "s-f3",
  "s-f3": "registered",
};

/** Hand-placed existing prospects (the CRM seed's people). */
const EXISTING: Placement[] = [
  { personId: "5", column: "s-f2", enteredDaysAgo: 9, rating: "warm", source: "Old friend", next: { column: "s-info3", inDays: 0, time: "19:00" }, note: "Bring her husband this time" },
  { personId: "9", column: "first_plan", enteredDaysAgo: 3, rating: "hot", next: { column: "s-f1", inDays: -1 }, note: "Bring to Fall Weekend" },
  { personId: "10", column: "s-door", enteredDaysAgo: 18, rating: "cold" },
  { personId: "12", column: "first_meeting", enteredDaysAgo: 2, source: "Gym", next: { column: "s-book", inDays: 3 } },
  { personId: "15", column: "s-mg2", enteredDaysAgo: 8, next: { column: "first_plan", inDays: 2 } },
  { personId: "16", column: "s-f1", enteredDaysAgo: 6, next: { column: "s-info2", inDays: 1 }, note: "Call first" },
  { personId: "18", column: "s-story", enteredDaysAgo: 4, source: "Neighbor" },
  { personId: "20", column: "s-info2", enteredDaysAgo: 5, next: { column: "s-f2", inDays: 2 } },
  { personId: "21", column: "s-story", enteredDaysAgo: 2, rating: "warm", source: "Coworker", next: { column: "s-door", inDays: 0 } },
  { personId: "100", column: "s-door", enteredDaysAgo: 6, next: { column: "first_meeting", inDays: 3 } },
  { personId: "101", column: "s-book", enteredDaysAgo: 10 },
  { personId: "102", column: "contact", enteredDaysAgo: 33 },
  { personId: "103", column: "s-f1", enteredDaysAgo: 24 },
  { personId: "105", column: "s-story", enteredDaysAgo: 5, source: "Instagram" },
  { personId: "110", column: "s-mg2", enteredDaysAgo: 11 },
  { personId: "113", column: "first_meeting", enteredDaysAgo: 4, next: { column: "s-book", inDays: 1 } },
  { personId: "200", column: "s-book", enteredDaysAgo: 7, next: { column: "s-mg2", inDays: -2 } },
  { personId: "202", column: "s-f3", enteredDaysAgo: 12 },
  { personId: "204", column: "s-door", enteredDaysAgo: 4, source: "Coworker", next: { column: "first_meeting", inDays: 0, time: "18:30" }, note: "Coffee at Main St" },
  { personId: "205", column: "s-f1", enteredDaysAgo: 13 },
  { personId: "207", column: "s-mg2", enteredDaysAgo: 5 },
  { personId: "209", column: "s-info3", enteredDaysAgo: 8 },
  { personId: "212", column: "s-3way", enteredDaysAgo: 6, next: { column: "first_plan", inDays: 4 } },
  { personId: "214", column: "first_meeting", enteredDaysAgo: 1, rating: "hot", next: { column: "s-book", inDays: 2 } },
  { personId: "304", column: "s-f2", enteredDaysAgo: 10 },
  { personId: "305", column: "s-info2", enteredDaysAgo: 4, next: { column: "s-f2", inDays: 3 } },
  { personId: "308", column: "s-door", enteredDaysAgo: 3, source: "Family" },
  { personId: "309", column: "s-3way", enteredDaysAgo: 2 },
  { personId: "310", column: "first_plan", enteredDaysAgo: 9 },
  { personId: "311", column: "s-book", enteredDaysAgo: 15 },
]; // prettier-ignore

/**
 * Referral sources (src/data/referrals): Maria's Nina passed on two names a
 * couple of weeks ago, and Hector (in the column 9 days) hasn't yet, so Home
 * says "Ask Hector for names". Jamal's Zane Hayes (205) referred Andre Lewis
 * (21, src/data/seed.ts). All reach Contact made only, so the first-meeting
 * numbers stay as tuned.
 */
const REFERRALS: { id: string; name: string; joined: number; referredBy?: string; place: Omit<Placement, "personId"> }[] = [
  { id: "570", name: "Nina Alvarez", joined: 25, place: { column: "referral_source", enteredDaysAgo: 18, source: "Gym" } },
  { id: "571", name: "Ty Jordan", joined: 4, referredBy: "570", place: { column: "contact", enteredDaysAgo: 4, rating: "warm", source: "Referral" } },
  { id: "572", name: "Mae Collins", joined: 9, referredBy: "570", place: { column: "s-story", enteredDaysAgo: 2, source: "Referral" } },
  { id: "573", name: "Hector Ruiz", joined: 16, place: { column: "referral_source", enteredDaysAgo: 9, source: "Coworker" } },
]; // prettier-ignore

/** Jamal's prospect who passes on names (Andre Lewis, 21, is one of them). */
const JAMAL_REFERRAL_SOURCE: Placement = {
  personId: "205",
  column: "referral_source",
  enteredDaysAgo: 10,
  contactDaysAgo: 16,
};

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
      // Same draws as before ratings had three values; older cards cool off.
      rating: fresh && rng() < 0.1 ? "hot" : !fresh && i % 5 === 0 ? "cold" : undefined,
      source: rng() < 0.5 ? pick(SOURCES) : undefined,
      // Some booked steps are due today or overdue (-2 to 3 days).
      next:
        fresh && rng() < 0.6
          ? { column: NEXT_COLUMN[column], inDays: Math.floor(rng() * 6) - 2 }
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

  // Referral sources and the people they referred (Maria's, Jamal's).
  for (const r of REFERRALS) {
    placements.push({ personId: r.id, contactDaysAgo: r.joined, ...r.place });
    people.push({
      id: r.id,
      name: r.name,
      bizClass: "prospect",
      sponsorId: "1",
      pipelineStage: "prospect",
      joinedDate: ago(r.joined),
      location: CITY["1"],
      ...(r.referredBy ? { referredBy: r.referredBy } : {}),
    });
  }
  const zane = placements.findIndex((pl) => pl.personId === JAMAL_REFERRAL_SOURCE.personId);
  if (zane >= 0) placements[zane] = JAMAL_REFERRAL_SOURCE;

  // Maria and Anita each get a first meeting booked for tonight and a first
  // plan that is a day overdue (Home's "Done" moves them through milestones).
  const CONTACT_BAND = ["contact", "s-story", "s-door"];
  const MEETING_BAND = ["first_meeting", "s-book", "s-mg2"];
  for (const owner of ["1", "2"]) {
    const mine = (cols: string[]) =>
      placements.find(
        (pl) =>
          cols.includes(pl.column) &&
          people.some((p) => p.id === pl.personId && p.sponsorId === owner),
      );
    const a = mine(CONTACT_BAND);
    if (a) a.next = { column: "first_meeting", inDays: 0, time: "19:00" };
    const b = mine(MEETING_BAND);
    if (b) b.next = { column: "first_plan", inDays: -1 };
  }

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
