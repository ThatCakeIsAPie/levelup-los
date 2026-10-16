/**
 * Your list and customer pipeline demo seed. Every date is relative to now.
 *
 *  - Steps: Maria's starting set (Sampled product, Product meeting 2+,
 *    Sample box sale); her whole team inherits them.
 *  - Lists and boards for Maria, Anita, David, Jamal, Marcus and Tasha (the
 *    new apprentice under Jamal from the MVP mockup). Names in First sale and
 *    On Ditto are linked to the seed's existing customers (c1–c8, c11), so the
 *    seed makes no new people: Jamal still owns only Kofi (c8).
 *  - About six months of history for names no longer on a list (entry ids
 *    start with "xl-"), so the customer funnel has believable numbers.
 */
import { addDays, getDate, startOfMonth, subMonths } from "date-fns";
import { localDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";
import {
  CUSTOMER_MILESTONES,
  REFERRAL_SOURCE,
  STARTER_CUSTOMER_STEPS,
  type CustomerBand,
  type CustomerCard,
  type CustomerMilestone,
  type CustomerMove,
  type CustomerPipelineData,
  type CustomerStep,
  type ListEntry,
  type ListRating,
} from "./types";

/** The leader whose starting steps the whole demo team inherits. */
export const CUSTOMER_LEADER_ID = "1";

/** Maria's starting steps (stable ids). */
export const CUSTOMER_STEP_IDS = {
  sampled: "cs-sampled",
  meeting2: "cs-pm2",
  sampleBox: "cs-sbox",
} as const;

const STEP_ID: Record<string, string> = {
  "Sampled product": CUSTOMER_STEP_IDS.sampled,
  "Product meeting 2+": CUSTOMER_STEP_IDS.meeting2,
  "Sample box sale": CUSTOMER_STEP_IDS.sampleBox,
};

function makeRng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One name on a list: [name, how you know them, rating, final column, days
 * in that column, linked customer id?, booked next column?, booked in n days
 * (0 today, negative overdue)?, the card's note?].
 */
type Spec = [
  name: string,
  howKnown: string | null,
  rating: ListRating | null,
  column: string,
  days: number,
  customerId?: string,
  next?: string,
  nextIn?: number,
  note?: string,
];

/** Booked times ("HH:MM") by name. */
const TIMES: Record<string, string> = { "Lena Orr": "17:00", "Jay Holloway": "18:30" };

const nc = "not_contacted";
const ni = "not_interested";
const dnc = "do_not_contact";
const { sampled, meeting2, sampleBox } = CUSTOMER_STEP_IDS;

/** Lists per owner (person id). */
const LISTS: Record<string, Spec[]> = {
  // Maria: the desktop board in the MVP mockup.
  "1": [
    ["Dana Lee", "Work friend", "warm", nc, 20],
    ["Chris Moore", "Neighbor", null, nc, 20],
    ["Alexis Rivera", "College", "warm", nc, 18],
    ["Mia Parker", "Church", "hot", nc, 15],
    ["Owen Hughes", "Gym", null, nc, 15],
    ["Renee Castillo", "Kids' school", null, nc, 12],
    ["Gabe Santos", "Old coworker", "cold", nc, 12],
    ["Lucy Tran", "Book club", "warm", nc, 9],
    ["Marcy Dale", "Cousin", "warm", nc, 9],
    ["Frank Ibarra", "Neighbor", null, nc, 6],
    ["Ivy Chen", "Yoga class", null, nc, 6],
    ["Paul Okafor", "Barber", "cold", nc, 3],
    ["Rosa Delmar", "Coffee shop", null, "contact", 2, undefined, sampled, 3, "Text her first"],
    ["Trent Walsh", "Farmers market", null, "contact", 4],
    ["Nadia Bloom", "Kids' soccer", "warm", "contact", 6],
    ["Ben Fordham", "Gym", null, "contact", 4],
    ["Tia Adams", "Neighbor", null, "contact", 5],
    ["Noah Grant", "Old coworker", null, "contact", 8],
    ["Sasha Reid", "Church", "warm", "contact", 10],
    [
      "Lena Ortega",
      "Tried XS Energy",
      "hot",
      sampled,
      3,
      undefined,
      "first_meeting",
      0,
      "Loved the XS Energy",
    ],
    ["Carla Mendez", "Tried the skin care", null, sampled, 6],
    ["Kim Brady", "Skin care chat", null, "first_meeting", 1, undefined, meeting2, -1],
    ["Hal Porter", "Coffee chat", null, "first_meeting", 7],
    ["Jay Holloway", "Wants a water filter", null, meeting2, 6, undefined, "first_sale", 0],
    ["Grace Lin", "Old neighbor", null, "first_sale", 7, "c1", "on_ditto", 6, "Offer Ditto"],
    ["Hannah Boyd", "Kids' school", null, "first_sale", 12, "c3"],
    ["Omar Haddad", "Gym", null, sampleBox, 5, "c4"],
    ["Peter Vargas", "Church", null, "on_ditto", 4, "c2"],
    ["Sam Ruiz", "Gym", null, ni, 15],
    ["Joe Kessler", "Neighbor", null, ni, 30],
    ["Al Chen", "Old coworker", null, dnc, 31],
  ],
  // Anita: a smaller board, one customer on Ditto.
  "2": [
    ["Becca Holm", "Pilates", "warm", nc, 14],
    ["Raj Mehta", "College", null, nc, 11],
    ["Tess Arnold", "Neighbor", null, nc, 8],
    ["Elena Ruiz", "Work friend", "hot", nc, 5],
    ["Quinn Avery", "Dog park", null, "contact", 3],
    ["Gina Lowe", "Church", null, "contact", 6],
    [
      "Martin Cole",
      "Old coworker",
      null,
      sampled,
      4,
      undefined,
      "first_meeting",
      0,
      "Ask how it went",
    ],
    ["Lori Banks", "Book club", "warm", "first_meeting", 3, undefined, "first_sale", 1],
    ["Wes Carver", "Gym", null, "first_sale", 20, "c6", "on_ditto", -1],
    ["Julia Stern", "Book club", null, "on_ditto", 41, "c5"],
    ["Ned Fry", "Gym", null, ni, 22],
  ],
  // David: Anita's crossline (Maria sees both; Anita and Jamal never see David's).
  "3": [
    ["Carmen Diaz", "Neighbor", "cold", nc, 10],
    ["Hugo Brandt", "Gym", "warm", nc, 7],
    ["Iris Kemp", "Church", null, "contact", 5],
    ["Dana Pratt", "Neighbor", null, "first_sale", 30, "c7"],
  ],
  // Jamal (apprentice, Anita's): a few names of his own; Kofi is on Ditto.
  "4": [
    ["Derrick Lane", "Barbershop", "warm", nc, 9],
    ["Keisha Monroe", "College", "hot", nc, 7],
    ["Tony Banks", "Cousin", null, nc, 4],
    ["Lila Hart", "Coffee shop", null, "contact", 2, undefined, sampled, 2, "Text Fri"],
    ["Andre Mills", "Gym", null, "contact", 6],
    [
      "Fay Gordon",
      "Work friend",
      null,
      sampled,
      5,
      undefined,
      "first_meeting",
      0,
      "Follow up on the sample",
    ],
    ["Kofi Mensah", "Cousin", null, "on_ditto", 19, "c8"],
  ],
  // Marcus.
  "6": [
    ["Rita Moss", "Neighbor", null, nc, 8],
    ["Glen Ward", "Gym", null, "contact", 4],
    ["Opal Reyes", "Church", "warm", "first_meeting", 2],
  ],
  // Tasha (new apprentice under Jamal, MVP mockup): built her list with Jamal.
  "700": [
    ["Dana Lewis", "Work friend", "warm", nc, 10],
    ["Chris Mora", "Neighbor", null, nc, 10],
    ["Alex Romero", "College", null, nc, 9],
    ["Mia Patel", "Church", "hot", nc, 9],
    ["Jordan Kale", "Gym", null, nc, 8],
    ["Sienna Fox", "Old coworker", null, nc, 8],
    ["Marcus Vale", "Cousin", "warm", nc, 7],
    ["Ruby Ng", "Book club", null, nc, 7],
    ["Eli Shaw", "Neighbor", null, nc, 6],
    ["Nora Quinn", "Kids' school", null, nc, 6],
    ["Pete Lindgren", "Barber", "cold", nc, 5],
    ["Zoe Hart", "Yoga class", "warm", nc, 5],
    ["Rosa Delgadillo", "Coffee shop", null, "contact", 2, undefined, sampled, 3, "Text Fri"],
    ["Benny Cruz", "Farmers market", null, "contact", 3],
    ["Lucia Gomez", "Dog park", null, "contact", 4],
    ["Ben Forde", "Gym", null, "contact", 4],
    ["Tia Andrews", "Neighbor", null, "contact", 5],
    ["Lena Orr", "Tried XS Energy", "hot", sampled, 3, undefined, "first_meeting", 0],
    ["Kim Bray", "Skin care chat", null, "first_meeting", 1, undefined, "first_sale", -1],
    ["Lena Duarte", "Coworker", null, "first_sale", 7, "c11", "on_ditto", 7, "Offer Ditto"],
    ["Sam Rios", "Gym", null, ni, 6],
  ],
};

/**
 * Referral sources and the names they passed on (src/data/referrals), added
 * after the lists and the history so the rest of the seed stays as it was.
 * Maria's Wendy Shaw referred Kara and Leo (Joy came from Nina Alvarez, 570, a
 * referral source on Maria's recruiting board); Jamal's Ray Dunn has been in
 * the column 9 days without a name, so Jamal's Home says "Ask Ray for names".
 */
const REFERRAL_LISTS: Record<string, Spec[]> = {
  "1": [
    ["Wendy Shaw", "Old neighbor", null, REFERRAL_SOURCE, 12],
    ["Kara Bloom", "Wendy's sister", "warm", nc, 6],
    ["Leo Martin", "Wendy's coworker", null, "contact", 3],
    ["Joy Alvarez", "Nina's cousin", null, nc, 4],
  ],
  "4": [["Ray Dunn", "Barbershop", null, REFERRAL_SOURCE, 9]],
};
/** Who referred each name: another name on the same list, or a person id (`person:`). */
const REFERRED_BY: Record<string, string> = {
  "Kara Bloom": "Wendy Shaw",
  "Leo Martin": "Wendy Shaw",
  "Joy Alvarez": "person:570",
};

/** Names added by an upline helping (shown as "added by Jamal"). */
const ADDED_BY: Record<string, string> = { "Alex Romero": "4", "Marcy Dale": "2" };

/** History-only names per owner and month (oldest first, the last is this month so far). */
const HISTORY: Record<string, number[]> = {
  "1": [5, 6, 7, 8, 9, 6],
  "2": [4, 4, 5, 6, 6, 4],
  "3": [3, 3, 4, 3, 4, 2],
  "4": [1, 2, 2, 2, 3, 2],
  "6": [2, 2, 3, 3, 3, 2],
};

/** Milestone path to a column: which earlier bands a card passed through, and how long ago. */
function pathTo(column: string, bandOf: (c: string) => CustomerBand): CustomerBand[] {
  const band = bandOf(column);
  if (band === "start") return [];
  if (band === "out")
    return column === "do_not_contact" || column === REFERRAL_SOURCE
      ? ["contact"]
      : ["contact", "first_meeting"];
  const i = CUSTOMER_MILESTONES.indexOf(band as CustomerMilestone);
  // Milestones before the final band (the final band's milestone too when the column is a step).
  return CUSTOMER_MILESTONES.slice(0, column === band ? i : i + 1);
}

export function seedCustomerPipeline(people: CrmPerson[], now = new Date()): CustomerPipelineData {
  const rng = makeRng(20261014);
  const exists = new Set(people.map((p) => p.id));
  const stamp = (daysAgo: number, hour = 11) => {
    const d = addDays(now, -daysAgo);
    d.setHours(hour, Math.floor(rng() * 50), 0, 0);
    return d.getTime() > now.getTime() ? now.toISOString() : d.toISOString();
  };

  const created = stamp(150, 9);
  const pos: Record<string, number> = {};
  const steps: CustomerStep[] = STARTER_CUSTOMER_STEPS.map((s) => ({
    id: STEP_ID[s.label],
    ownerId: CUSTOMER_LEADER_ID,
    band: s.band,
    label: s.label,
    position: (pos[s.band] = (pos[s.band] ?? -1) + 1),
    createdAt: created,
  }));
  const stepBand = new Map(steps.map((s) => [s.id, s.band as CustomerBand]));
  const bandOf = (c: string): CustomerBand => {
    if (c === "not_contacted") return "start";
    if (c === "not_interested" || c === "do_not_contact" || c === REFERRAL_SOURCE) return "out";
    return stepBand.get(c) ?? (c as CustomerBand);
  };

  const entries: ListEntry[] = [];
  const cards: CustomerCard[] = [];
  const moves: CustomerMove[] = [];
  let n = 0;
  const addMove = (
    entryId: string,
    ownerId: string,
    from: string | null,
    to: string,
    at: string,
  ): void => {
    moves.push({
      id: `cm${++n}`,
      entryId,
      ownerId,
      from,
      to,
      band: bandOf(to),
      movedAt: at,
      movedBy: ownerId,
      createdCustomerId: null,
      setDitto: false,
    });
  };

  const addSpec = (ownerId: string, spec: Spec, i: number): void => {
    const [name, howKnown, rating, column, days, customerId, next, nextIn, note] = spec;
    const id = `le-${ownerId}-${i + 1}`;
    const path = pathTo(column, bandOf);
    // Each earlier milestone a few days before the next one.
    const gaps: number[] = [];
    let acc = days;
    for (let k = path.length - 1; k >= 0; k--) gaps[k] = acc += 3 + Math.floor(rng() * 4);
    const firstDay = (gaps[0] ?? days) + 2 + Math.floor(rng() * 5);
    const createdAt = stamp(firstDay, 8);
    entries.push({
      id,
      ownerId,
      name,
      howKnown,
      phone: rng() < 0.6 ? `555-01${String(10 + ((i * 7) % 90)).padStart(2, "0")}` : null,
      email: null,
      notes: null,
      rating,
      customerId: customerId && exists.has(customerId) ? customerId : null,
      prospectId: null,
      ...referredBy(ownerId, name),
      addedBy: ADDED_BY[name] ?? ownerId,
      createdAt,
      updatedAt: createdAt,
    });
    if (column === "not_contacted") return;
    let from: string | null = null;
    path.forEach((band, k) => {
      addMove(id, ownerId, from, band, stamp(gaps[k], 10));
      from = band;
    });
    const enteredAt = stamp(days, 15);
    addMove(id, ownerId, from, column, enteredAt);
    cards.push({
      entryId: id,
      column,
      enteredAt,
      nextColumn: next ?? null,
      nextStepDate: next && nextIn !== undefined ? localDate(addDays(now, nextIn)) : null,
      nextStepTime: (next && TIMES[name]) || null,
      note: note ?? null,
      updatedAt: enteredAt,
    });
  };
  /** The links of a name in REFERRED_BY (its referrer is earlier on the same list). */
  const referredBy = (ownerId: string, name: string) => {
    const by = REFERRED_BY[name];
    if (by?.startsWith("person:")) {
      const id = by.slice("person:".length);
      return { referredBy: exists.has(id) ? id : null, referredByEntry: null };
    }
    const entry = by ? entries.find((e) => e.ownerId === ownerId && e.name === by) : undefined;
    return { referredBy: null, referredByEntry: entry?.id ?? null };
  };

  for (const [ownerId, specs] of Object.entries(LISTS)) {
    if (!exists.has(ownerId)) continue;
    specs.forEach((spec, i) => addSpec(ownerId, spec, i));
  }

  // History: names worked and since removed from a list (counts only).
  const thisMonth = startOfMonth(now);
  for (const [ownerId, perMonth] of Object.entries(HISTORY)) {
    if (!exists.has(ownerId)) continue;
    perMonth.forEach((count, m) => {
      const start = subMonths(thisMonth, perMonth.length - 1 - m);
      const span = m === perMonth.length - 1 ? getDate(now) : 28;
      for (let k = 0; k < count; k++) {
        const id = `xl-${ownerId}-${m}-${k}`;
        const day0 = addDays(start, Math.floor(rng() * Math.max(1, span - 1)));
        const at = (d: Date) => {
          const t = new Date(d);
          t.setHours(10 + Math.floor(rng() * 8), Math.floor(rng() * 60), 0, 0);
          return t.getTime() > now.getTime() ? now.toISOString() : t.toISOString();
        };
        let day = day0;
        addMove(id, ownerId, null, "contact", at(day));
        let last = "contact";
        for (const next of ["first_meeting", "first_sale", "on_ditto"] as const) {
          const p = next === "first_meeting" ? 0.55 : next === "first_sale" ? 0.45 : 0.4;
          if (rng() > p) break;
          const later = addDays(day, 2 + Math.floor(rng() * 6));
          if (later > now) break;
          day = later;
          addMove(id, ownerId, last, next, at(day));
          last = next;
        }
      }
    });
  }

  for (const [ownerId, specs] of Object.entries(REFERRAL_LISTS)) {
    if (!exists.has(ownerId)) continue;
    const start = LISTS[ownerId]?.length ?? 0;
    specs.forEach((spec, i) => addSpec(ownerId, spec, start + i));
  }

  return { entries, steps, hides: [], cards, moves };
}
