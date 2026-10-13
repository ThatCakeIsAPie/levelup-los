/**
 * Demo seed data. Every date is relative to "today" (via src/lib/dates.ts) so
 * the demo always looks alive: an upcoming conference ~26 days out, a team
 * meeting ~10 days out, recent check-ins, learning streaks, and so on.
 *
 * Each `seed*()` returns fresh objects; stores call them on first load and in
 * their persist `migrate` (bump SEED_VERSION to force everyone onto a new seed).
 * Ids are stable so links and tests can rely on them:
 *   people "1".."21" (named), "100".."114" / "200".."214" / "300".."314"
 *   (generated downlines), customers "c1".."c10"; events "e1".."e6".
 * Prospects never have a downline: every sponsor is an apprentice or IBO.
 */
import { addDays, addYears, differenceInCalendarDays, subYears } from "date-fns";
import { daysFromToday, localDate, parseDate } from "@/lib/dates";
import type { BizClass, CrmPerson, PipelineStage } from "@/stores/peopleStore";
import type { CrmEvent } from "@/stores/eventsStore";
import type { Attendance } from "@/stores/attendanceStore";
import type { Contact, Learning, LearningGoal, Sale } from "@/stores/crmStore";
import type { ActivityEvent } from "@/stores/activityStore";
import type { Logistics, SharedCost } from "@/stores/opsStore";
import { pipelineSeedPeople } from "./pipeline/seedPeople";

/** Bump to reset every persisted store to a fresh seed on next load. */
export const SEED_VERSION = 4;

const ago = (n: number) => daysFromToday(-n);
const ahead = (n: number) => daysFromToday(n);
/** ISO timestamp `n` days ago at a given local hour. */
const tsAgo = (n: number, hour = 10) => {
  const d = addDays(new Date(), -n);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

/** Start date that puts an apprentice's 1-year anniversary `n` days from today. */
const anniversaryIn = (n: number) => localDate(subYears(addDays(new Date(), n), 1));

// Small deterministic PRNG so generated people/contacts are stable across loads.
function makeRng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

type P = Omit<CrmPerson, "stageHistory">;

const biz = (
  id: string,
  name: string,
  bizClass: Exclude<BizClass, "customer">,
  sponsorId: string | null,
  extra: Partial<CrmPerson> = {},
): P => ({
  id,
  name,
  bizClass,
  sponsorId,
  pipelineStage: bizClass,
  ...(bizClass !== "prospect"
    ? { iboNumber: `IBO-${1000 + Number(id)}`, ltdNumber: "LTD-501" }
    : {}),
  ...extra,
});

export function seedPeople(): CrmPerson[] {
  const people: P[] = [
    biz("1", "Maria Reyes", "ibo", null, {
      location: "Dallas, TX",
      businessStartDate: ago(2770),
      joinedDate: ago(2770),
      email: "maria@example.com",
      phone: "214-555-0101",
      tags: ["leader"],
    }),
    biz("2", "Anita Patel", "ibo", "1", {
      location: "Austin, TX",
      businessStartDate: ago(2325),
      joinedDate: ago(2325),
      email: "anita@example.com",
      phone: "512-555-0102",
    }),
    biz("3", "David Chen", "ibo", "1", {
      location: "Houston, TX",
      businessStartDate: ago(2250),
      joinedDate: ago(2250),
      phone: "713-555-0103",
    }),
    // Jamal: apprentice whose IBO anniversary is ~53 days away.
    biz("4", "Jamal Brown", "apprentice", "2", {
      location: "Atlanta, GA",
      businessStartDate: anniversaryIn(53),
      joinedDate: anniversaryIn(53),
      email: "jamal@example.com",
      phone: "404-555-0104",
    }),
    biz("5", "Linh Nguyen", "prospect", "2", { location: "San Jose, CA", joinedDate: ago(120) }),
    biz("6", "Marcus Hill", "ibo", "1", {
      location: "Phoenix, AZ",
      businessStartDate: ago(1999),
      joinedDate: ago(1999),
      email: "marcus@example.com",
    }),
    biz("7", "Sarah Kim", "apprentice", "3", {
      location: "Seattle, WA",
      businessStartDate: ago(240),
      joinedDate: ago(240),
      phone: "206-555-0107",
    }),
    biz("8", "Priya Singh", "ibo", "1", {
      location: "Chicago, IL",
      businessStartDate: ago(1494),
      joinedDate: ago(1494),
      email: "priya@example.com",
    }),
    biz("9", "Carlos Rivera", "prospect", "4", {
      location: "Miami, FL",
      joinedDate: ago(45),
      phone: "305-555-0109",
    }),
    biz("10", "Emily Foster", "prospect", "6", { location: "Denver, CO", joinedDate: ago(90) }),
    biz("11", "Tom Walker", "apprentice", "7", {
      location: "Portland, OR",
      businessStartDate: anniversaryIn(65),
      joinedDate: anniversaryIn(65),
    }),
    biz("12", "Nia Owens", "prospect", "8", { location: "Boston, MA", joinedDate: ago(60) }),
    biz("13", "Felix Wong", "ibo", "3", {
      location: "San Diego, CA",
      businessStartDate: ago(1777),
      joinedDate: ago(1777),
    }),
    biz("14", "Layla Hassan", "apprentice", "8", {
      location: "Detroit, MI",
      businessStartDate: ago(280),
      joinedDate: ago(280),
      email: "layla@example.com",
    }),
    biz("15", "Marco Diaz", "prospect", "13", { location: "Las Vegas, NV", joinedDate: ago(30) }),
    biz("16", "June Park", "prospect", "13", { location: "Nashville, TN", joinedDate: ago(75) }),
    biz("17", "Ed Miller", "ibo", "2", {
      location: "Charlotte, NC",
      businessStartDate: ago(2130),
      joinedDate: ago(2130),
    }),
    biz("18", "Joy Reed", "prospect", "11", { location: "Minneapolis, MN", joinedDate: ago(20) }),
    // Sky: anniversary inside 30 days, so the "30d" alert shows somewhere.
    biz("19", "Sky Ortiz", "apprentice", "6", {
      location: "Salt Lake City, UT",
      businessStartDate: anniversaryIn(24),
      joinedDate: anniversaryIn(24),
    }),
    // Beau is the demo candidate, sponsored by Marcus (an IBO).
    biz("20", "Beau Foster", "prospect", "6", {
      location: "Kansas City, MO",
      joinedDate: ago(14),
      email: "beau@example.com",
    }),
    biz("21", "Andre Lewis", "prospect", "4", {
      location: "Decatur, GA",
      joinedDate: ago(9),
      phone: "404-555-0121",
    }),

    // Customer path: always owned by an apprentice or IBO, never a downline.
    cust("c1", "Grace Lin", "1", "Dallas, TX", 180, 890, "grace@example.com"),
    cust("c2", "Peter Vargas", "1", "Plano, TX", 120, 760),
    cust("c3", "Hannah Boyd", "1", "Irving, TX", 95, 630),
    cust("c4", "Omar Haddad", "1", "Dallas, TX", 60, 500),
    cust("c5", "Julia Stern", "2", "Austin, TX", 210, 1065),
    cust("c6", "Wes Carver", "2", "Round Rock, TX", 75, 585),
    cust("c7", "Dana Pratt", "3", "Houston, TX", 140, 965),
    cust("c8", "Kofi Mensah", "4", "Atlanta, GA", 55, 160),
    cust("c9", "Rosa Iglesias", "8", "Chicago, IL", 165, 805),
    cust("c10", "Ben Tucker", "13", "San Diego, CA", 88, 425),
  ];

  // Deterministic downlines under David Chen (3), Jamal Brown (4) and Ed Miller (17,
  // Anita's branch). Sponsors are only ever drawn from the root and the
  // apprentices/IBOs generated so far, so no prospect ends up with a downline.
  const FIRST = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Avery", "Quinn", "Sage", "Drew", "Reese", "Skylar", "Rowan", "Emerson", "Hayden", "Parker", "Logan", "Cameron", "Devon", "Finley", "Harper", "Jamie", "Kai", "Lane", "Micah", "Noa", "Owen", "Remy", "Sasha", "Tatum", "Val", "Wren", "Zane", "Blair", "Cody", "Dana", "Eli", "Frankie", "Gray"]; // prettier-ignore
  const LAST = ["Stone", "Rivers", "Walker", "Hayes", "Bennett", "Cruz", "Ford", "Hughes", "Iverson", "Jenkins", "Knox", "Lopez", "Marsh", "Nash", "Pierce", "Quincy", "Reyes", "Sutton", "Tate", "Underwood", "Vance", "Ward", "Xiong", "Young", "Zimmer", "Abbott", "Bishop", "Carter", "Doyle"]; // prettier-ignore
  const rng = makeRng(42);
  const used = new Set(people.map((p) => p.name));
  for (const [root, start] of [
    ["3", 100],
    ["4", 200],
    ["17", 300],
  ] as const) {
    const pool: string[] = [root];
    for (let i = 0; i < 15; i++) {
      const id = String(start + i);
      let name = "";
      do {
        name = `${FIRST[Math.floor(rng() * FIRST.length)]} ${LAST[Math.floor(rng() * LAST.length)]}`;
      } while (used.has(name));
      used.add(name);
      const r = rng();
      const bizClass: Exclude<BizClass, "customer"> =
        r < 0.35 ? "ibo" : r < 0.6 ? "apprentice" : "prospect";
      const sponsorId = pool[Math.floor(rng() * pool.length)];
      const startDate =
        bizClass === "apprentice"
          ? ago(150 + Math.floor(rng() * 150))
          : bizClass === "ibo"
            ? ago(800 + Math.floor(rng() * 600))
            : undefined;
      people.push({
        id,
        name,
        bizClass,
        sponsorId,
        pipelineStage: bizClass,
        iboNumber: bizClass !== "prospect" ? `IBO-${id}` : undefined,
        ltdNumber: bizClass !== "prospect" ? "LTD-501" : undefined,
        businessStartDate: startDate,
        joinedDate: startDate ?? ago(10 + Math.floor(rng() * 120)),
      });
      if (bizClass !== "prospect") pool.push(id);
    }
  }

  // Pipeline demo: more prospects across the team and five recent registrations.
  people.push(...pipelineSeedPeople());

  return people.map((p) => ({
    ...p,
    stageHistory: p.pipelineStage ? stageHistoryFor(p) : undefined,
  }));
}

function cust(
  id: string,
  name: string,
  ownerId: string,
  location: string,
  monthlyVolume: number,
  joinedDaysAgo: number,
  email?: string,
): P {
  return {
    id,
    name,
    bizClass: "customer",
    ownerId,
    location,
    monthlyVolume,
    joinedDate: ago(joinedDaysAgo),
    ...(email ? { email } : {}),
  };
}

function stageHistoryFor(p: P): CrmPerson["stageHistory"] {
  const at = (d?: string) => `${d ?? ago(365)}T15:00:00.000Z`;
  const joined = p.joinedDate;
  const started = p.businessStartDate;
  const h: { stage: PipelineStage; at: string }[] = [];
  if (p.pipelineStage === "prospect") h.push({ stage: "prospect", at: at(joined) });
  if (p.pipelineStage === "apprentice" || p.pipelineStage === "ibo") {
    if (started) h.push({ stage: "prospect", at: at(localDate(addDays(parseDate(started), -60))) });
    h.push({ stage: "apprentice", at: at(started) });
  }
  if (p.pipelineStage === "ibo" && started) {
    h.push({ stage: "ibo", at: at(localDate(addYears(parseDate(started), 1))) });
  }
  return h;
}

// ---------------------------------------------------------------------------
// Events + attendance
// ---------------------------------------------------------------------------

const yearOf = (iso: string) => iso.slice(0, 4);

export function seedEvents(): CrmEvent[] {
  const fall = ahead(26);
  const lastFall = ago(364 - 26);
  return [
    {
      id: "e1",
      name: "Fall Leadership Weekend",
      type: "conference",
      date: fall,
      endDate: localDate(addDays(parseDate(fall), 1)),
      location: "Dallas, TX",
      notes: "Two-day leadership conference. Team van leaves Friday 7am.",
    },
    {
      id: "e5",
      name: "Monthly Team Meeting",
      type: "team_meeting",
      date: ahead(10),
      location: "Zoom",
      notes: "Recognition, new apprentices, Fall Weekend ticket push.",
    },
    {
      id: "e2",
      name: `Fall Leadership Weekend ${yearOf(lastFall)}`,
      type: "conference",
      date: lastFall,
      endDate: localDate(addDays(parseDate(lastFall), 1)),
      location: "Dallas, TX",
    },
    {
      id: "e3",
      name: "Summer Conference",
      type: "conference",
      date: ago(91),
      endDate: ago(90),
      location: "Orlando, FL",
    },
    {
      id: "e4",
      name: "September Team Meeting",
      type: "team_meeting",
      date: ago(20),
      location: "Zoom",
    },
    {
      id: "e6",
      name: "August Team Meeting",
      type: "team_meeting",
      date: ago(48),
      location: "Zoom",
    },
  ];
}

export function seedAttendances(): Attendance[] {
  const mk = (
    id: string,
    eventId: string,
    personId: string,
    o: Partial<Attendance> = {},
  ): Attendance => ({
    id,
    eventId,
    personId,
    hasTicket: false,
    leadershipQualified: false,
    specialEventQualified: false,
    ...o,
  });
  const tix = (type: Attendance["ticketType"] = "in_person"): Partial<Attendance> => ({
    desireToAttend: "yes",
    hasTicket: true,
    ticketType: type,
  });
  const went = (o: Partial<Attendance> = {}): Partial<Attendance> => ({
    ...tix(),
    attended: true,
    ...o,
  });
  const missed: Partial<Attendance> = { ...tix(), attended: false };

  return [
    // e1 Fall Leadership Weekend (+26d): 20 invited, 12 tickets, 4 planned dates (1 passed).
    mk("a1", "e1", "1", { ...tix(), leadershipQualified: true }),
    mk("a2", "e1", "2", { ...tix(), leadershipQualified: true }),
    mk("a3", "e1", "3", tix()),
    mk("a4", "e1", "4", {
      desireToAttend: "yes",
      plannedPurchaseDate: ahead(3),
      followUpDate: ahead(3),
      helperId: "2",
    }),
    mk("a5", "e1", "5", { desireToAttend: "maybe", followUpDate: ahead(2), helperId: "2" }),
    mk("a6", "e1", "6", tix("stream")),
    mk("a7", "e1", "7", { desireToAttend: "yes", plannedPurchaseDate: ago(2), helperId: "3" }),
    mk("a8", "e1", "8", { ...tix(), specialEventQualified: true }),
    mk("a9", "e1", "9", {
      desireToAttend: "yes",
      plannedPurchaseDate: ahead(1),
      followUpDate: ahead(1),
      helperId: "4",
    }),
    mk("a10", "e1", "11", { desireToAttend: "yes", plannedPurchaseDate: ahead(5), helperId: "7" }),
    mk("a11", "e1", "13", tix()),
    mk("a12", "e1", "14", tix()),
    mk("a13", "e1", "17", tix()),
    mk("a14", "e1", "19", tix()),
    mk("a15", "e1", "12", tix()),
    mk("a16", "e1", "10", { desireToAttend: "maybe", followUpDate: ahead(6) }),
    mk("a17", "e1", "16", { desireToAttend: "no", notes: "Out of town that weekend" }),
    mk("a18", "e1", "100", tix()),
    mk("a19", "e1", "101", tix("stream")),
    mk("a20", "e1", "200", { desireToAttend: "yes", helperId: "4" }),

    // e5 Monthly Team Meeting (+10d)
    mk("m1", "e5", "1", tix()),
    mk("m2", "e5", "2", tix()),
    mk("m3", "e5", "4", { desireToAttend: "yes", followUpDate: ahead(4) }),
    mk("m4", "e5", "7", { desireToAttend: "yes" }),
    mk("m5", "e5", "9", { desireToAttend: "maybe", followUpDate: ahead(7), helperId: "4" }),
    mk("m6", "e5", "14", tix()),
    mk("m7", "e5", "20", { desireToAttend: "maybe", followUpDate: ahead(8), helperId: "1" }),
    mk("m8", "e5", "21", { desireToAttend: "yes", helperId: "4" }),

    // e2 last year's Fall Leadership Weekend: 14 tracked, 11 tickets, 9 attended.
    mk("b1", "e2", "1", went({ leadershipQualified: true })),
    mk("b2", "e2", "2", went()),
    mk("b3", "e2", "3", missed),
    mk("b4", "e2", "6", went({ ticketType: "stream" })),
    mk("b5", "e2", "8", went()),
    mk("b6", "e2", "13", went()),
    mk("b7", "e2", "17", missed),
    mk("b8", "e2", "14", went()),
    mk("b9", "e2", "19", went()),
    mk("b10", "e2", "7", went()),
    mk("b11", "e2", "100", went()),
    mk("b12", "e2", "5", { desireToAttend: "maybe" }),
    mk("b13", "e2", "10", { desireToAttend: "no" }),
    mk("b14", "e2", "12", { desireToAttend: "yes" }),

    // e3 Summer Conference (-90d): 10 tracked, 8 tickets, 7 attended.
    mk("c1", "e3", "1", went()),
    mk("c2", "e3", "2", went()),
    mk("c3", "e3", "4", went()),
    mk("c4", "e3", "8", missed),
    mk("c5", "e3", "3", went()),
    mk("c6", "e3", "6", went()),
    mk("c7", "e3", "7", went()),
    mk("c8", "e3", "13", went({ ticketType: "stream" })),
    mk("c9", "e3", "11", { desireToAttend: "maybe" }),
    mk("c10", "e3", "9", { desireToAttend: "yes" }),

    // e4 September Team Meeting (-20d): 12 tracked, 9 attended.
    ...["1", "2", "3", "4", "6", "7", "8", "9", "14"].map((pid, i) =>
      mk(`d${i + 1}`, "e4", pid, went()),
    ),
    mk("d10", "e4", "11", missed),
    mk("d11", "e4", "17", missed),
    mk("d12", "e4", "5", { desireToAttend: "maybe" }),

    // e6 August Team Meeting (-48d)
    ...["1", "2", "4", "6", "8", "13", "19"].map((pid, i) => mk(`f${i + 1}`, "e6", pid, went())),
    mk("f8", "e6", "3", missed),
  ];
}

// ---------------------------------------------------------------------------
// CRM: contacts, sales, learning, goals
// ---------------------------------------------------------------------------

export function seedSales(): Sale[] {
  const rows: [string, string, number, number][] = [
    ["c1", "Nutrilite Double X", 5, 89],
    ["c1", "XS Energy (case)", 33, 42],
    ["c2", "Artistry Skin Set", 20, 120],
    ["c3", "XS Energy (case)", 40, 42],
    ["c4", "eSpring Filter", 70, 210],
    ["c5", "Nutrilite Daily", 3, 32],
    ["c6", "SA8 Laundry", 45, 28],
    ["c7", "Protein Powder", 12, 54],
    ["c8", "XS Energy (case)", 33, 42],
    ["c9", "Artistry Serum", 8, 76],
    ["c10", "Glister Toothpaste", 60, 14],
  ];
  return rows.map(([customerId, product, d, amount], i) => ({
    id: `s${i}`,
    customerId,
    product,
    date: ago(d),
    amount,
  }));
}

/**
 * Contacts: almost everyone was checked in on within the last ~12 days so the
 * "due" lists only show a handful of people. Overdue on purpose:
 * team David Chen (20d), Tom Walker (17d), Emily Foster (16d), "103" (22d);
 * customers Peter Vargas (36d), Omar Haddad (52d), Wes Carver (41d), Kofi Mensah (31d).
 */
export function seedContacts(people: CrmPerson[] = seedPeople()): Contact[] {
  const overdueTeam: Record<string, number> = { "3": 20, "11": 17, "10": 16, "103": 22 };
  const customerAge: Record<string, number> = {
    c1: 4,
    c2: 36,
    c3: 12,
    c4: 52,
    c5: 9,
    c6: 41,
    c7: 18,
    c8: 31,
    c9: 6,
    c10: 24,
  };
  const rng = makeRng(7);
  const out: Contact[] = [];
  for (const p of people) {
    if (p.bizClass === "customer") {
      const age = customerAge[p.id];
      if (age !== undefined) {
        out.push({ id: `k-${p.id}`, personId: p.id, byId: p.ownerId ?? "1", date: ago(age) });
      }
      continue;
    }
    if (p.id === "1") continue; // Maria is the root; nobody checks in on her.
    const age = overdueTeam[p.id] ?? Math.floor(rng() * 12);
    out.push({ id: `t-${p.id}`, personId: p.id, byId: p.sponsorId ?? "1", date: ago(age) });
    // A second, older touch for a bit of history.
    out.push({
      id: `t2-${p.id}`,
      personId: p.id,
      byId: "1",
      date: ago(age + 14 + Math.floor(rng() * 20)),
    });
  }
  return out;
}

export function seedLearning(): Learning[] {
  const rows: Omit<Learning, "id">[] = [
    // Maria: 3-day streak ending yesterday; 45 pages + 1 podcast this week (75% of goal).
    { personId: "1", kind: "pages", title: "Go-Givers Sell More", amount: 25, date: ago(1) },
    { personId: "1", kind: "pages", title: "Go-Givers Sell More", amount: 20, date: ago(2) },
    { personId: "1", kind: "podcast", title: "Leadership Hour #42", amount: 1, date: ago(3) },
    {
      personId: "1",
      kind: "workshop",
      title: "Spring Leadership Workshop",
      amount: 1,
      date: ago(12),
    },
    // ...and an 11-day personal-best run a month ago.
    ...Array.from({ length: 11 }, (_, i) => ({
      personId: "1",
      kind: (i % 3 === 0 ? "podcast" : "pages") as Learning["kind"],
      title: i % 3 === 0 ? `Leadership Hour #${30 + i}` : "The Compound Effect",
      amount: i % 3 === 0 ? 1 : 15,
      date: ago(22 + i),
    })),
    // Anita: streak 2 (today + yesterday).
    { personId: "2", kind: "podcast", title: "Momentum Daily", amount: 1, date: ago(0) },
    { personId: "2", kind: "pages", title: "The Slight Edge", amount: 15, date: ago(1) },
    { personId: "2", kind: "pages", title: "The Slight Edge", amount: 10, date: ago(4) },
    // Jamal: streak 1.
    { personId: "4", kind: "podcast", title: "Momentum Daily", amount: 1, date: ago(1) },
    { personId: "4", kind: "pages", title: "Rich Dad Poor Dad", amount: 12, date: ago(5) },
    { personId: "4", kind: "workshop", title: "New Apprentice Workshop", amount: 1, date: ago(9) },
    // David: nothing this week.
    { personId: "3", kind: "conference", title: "Summer Conference", amount: 1, date: ago(90) },
    { personId: "3", kind: "pages", title: "Think and Grow Rich", amount: 20, date: ago(16) },
    // A few more team members.
    { personId: "6", kind: "pages", title: "Atomic Habits", amount: 30, date: ago(0) },
    { personId: "6", kind: "podcast", title: "Momentum Daily", amount: 1, date: ago(1) },
    { personId: "7", kind: "pages", title: "The 5 AM Club", amount: 18, date: ago(2) },
    { personId: "8", kind: "podcast", title: "Leadership Hour #44", amount: 1, date: ago(0) },
    { personId: "8", kind: "pages", title: "Go-Givers Sell More", amount: 22, date: ago(1) },
    { personId: "8", kind: "pages", title: "Go-Givers Sell More", amount: 18, date: ago(2) },
    { personId: "14", kind: "workshop", title: "Product Night", amount: 1, date: ago(3) },
    { personId: "20", kind: "podcast", title: "Why This Business", amount: 1, date: ago(2) },
  ];
  return rows.map((l, i) => ({ ...l, id: `l${i}` }));
}

/** Per-person weekly goals that differ from the default (60 pages / 3 podcasts / 1 workshop). */
export function seedLearningGoals(): Record<string, LearningGoal> {
  return {
    "2": { pages: 70, podcasts: 5, workshops: 1 },
    "4": { pages: 40, podcasts: 3, workshops: 1 },
  };
}

// ---------------------------------------------------------------------------
// Ops (travel + shared costs)
// ---------------------------------------------------------------------------

export function seedOps(): { logistics: Record<string, Logistics>; costs: SharedCost[] } {
  return {
    logistics: {
      "e1:1": { ticket: "bought", mode: "drive", carpool: "van", vanPaid: "yes" },
      "e1:2": { ticket: "bought", mode: "fly", flightBooked: true, carpool: "solo" },
      "e1:4": {
        ticket: "planned",
        planDate: ahead(3),
        mode: "drive",
        carpool: "van",
        vanPaid: "planned",
        vanPayDate: ahead(8),
      },
      "e1:7": {
        ticket: "planned",
        planDate: ago(2),
        mode: "fly",
        flightBooked: false,
        carpool: "teammate",
      },
    },
    costs: [
      {
        id: "sc1",
        eventId: "e1",
        name: "Team van rental",
        total: 600,
        ownerId: "1",
        members: ["1", "2", "4"],
        overrides: {},
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Activity timeline
// ---------------------------------------------------------------------------

export function seedActivity(
  people: CrmPerson[] = seedPeople(),
  attendances: Attendance[] = seedAttendances(),
): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  let n = 0;
  const push = (e: Omit<ActivityEvent, "id" | "actorName"> & { actorName?: string }) =>
    out.push({ actorName: "Maria Reyes", ...e, id: `act${n++}` });

  for (const p of people) {
    if (p.bizClass === "customer" || Number(p.id) >= 100) continue;
    for (const h of p.stageHistory ?? []) {
      if (h.at > new Date().toISOString()) continue;
      push({
        timestamp: h.at,
        entityType: "person",
        entityId: p.id,
        relatedPersonId: p.id,
        kind: "stage_changed",
        summary: `Pipeline → ${h.stage}`,
        meta: { to: h.stage },
      });
    }
  }
  const events = seedEvents();
  attendances.forEach((a, i) => {
    const ev = events.find((e) => e.id === a.eventId);
    if (!ev) return;
    const evPast = ev.date < localDate();
    if (a.hasTicket) {
      const daysBefore = 6 + (i % 20);
      const when = evPast ? ago(Math.max(0, -diffDays(ev.date) + daysBefore)) : ago(1 + (i % 25));
      push({
        timestamp: `${when}T16:00:00.000Z`,
        entityType: "attendance",
        entityId: a.id,
        relatedPersonId: a.personId,
        relatedEventId: a.eventId,
        kind: "ticket_purchased",
        summary: "Ticket purchased",
      });
    }
    if (evPast && a.attended !== undefined) {
      push({
        timestamp: `${ev.date}T23:00:00.000Z`,
        entityType: "attendance",
        entityId: a.id,
        relatedPersonId: a.personId,
        relatedEventId: a.eventId,
        kind: a.attended ? "marked_attended" : "marked_no_show",
        summary: a.attended ? "Attended" : "No-show",
      });
    }
  });
  push({
    timestamp: tsAgo(3, 19),
    entityType: "person",
    entityId: "4",
    relatedPersonId: "4",
    kind: "note",
    summary: "Talked through the IBO checklist; IBO# and LTD# on file.",
  });
  return out.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Days from today to `iso` (negative = past). */
function diffDays(iso: string): number {
  return differenceInCalendarDays(parseDate(iso), new Date());
}
