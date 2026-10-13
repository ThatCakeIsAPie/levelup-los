/**
 * Pipeline demo seed (browser-storage demo only). Every date is relative to
 * today, and the numbers are tuned so Maria's whole team shows about 62 first
 * meetings by the 13th of the month (scaled for other days), a rising
 * six-month trend (36 → 71) and conversion rates near the targets, with the
 * biggest gap after the plan and most people stalling at F1.
 *
 *  - Steps: Maria's defaults; Anita adds "3-way call"; David hides Info 3.
 *  - Cards: every demo prospect, placed by ./seedPeople.ts.
 *  - Moves: each prospect's path to their column, the five recent
 *    registrations, and about six months of history for prospects who have
 *    since left the CRM (their ids start with "x" and match no person).
 *  - Settings, shares and stat requests to show inheritance and sharing.
 */
import { addDays, endOfMonth, getDate, startOfMonth, subDays, subMonths } from "date-fns";
import { localDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";
import { chainOf, columnsFor, isMilestone, reachesOf } from "./rules";
import {
  ANITA_STEP,
  DAVID_HIDES,
  DEFAULT_STEPS,
  PARTNER_LEADER_ID,
  pipelineSeedPlan,
} from "./seedPeople";
import {
  DEFAULT_TARGETS,
  type MilestoneCode,
  type PipelineCard,
  type PipelineColumn,
  type PipelineData,
  type PipelineMove,
  type PipelineStep,
  type StatRequest,
  type StatShare,
  type StepBand,
  type StepHide,
  type TeamSetting,
} from "./types";

function makeRng(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Conversion profile per owner: share of first meetings and their three rates. */
const PROFILE: Record<string, { w: number; c2m: number; m2p: number; p2r: number }> = {
  "1": { w: 16, c2m: 0.33, m2p: 0.55, p2r: 0.36 },
  "2": { w: 13, c2m: 0.31, m2p: 0.52, p2r: 0.31 },
  "6": { w: 10, c2m: 0.27, m2p: 0.51, p2r: 0.28 },
  "8": { w: 10, c2m: 0.3, m2p: 0.49, p2r: 0.26 },
  "3": { w: 10, c2m: 0.24, m2p: 0.45, p2r: 0.22 },
  "7": { w: 7, c2m: 0.31, m2p: 0.47, p2r: 0.2 },
  "4": { w: 7, c2m: 0.21, m2p: 0.4, p2r: 0.14 },
  "17": { w: 5, c2m: 0.29, m2p: 0.5, p2r: 0.26 },
  "13": { w: 4, c2m: 0.28, m2p: 0.48, p2r: 0.24 },
  "14": { w: 3, c2m: 0.3, m2p: 0.49, p2r: 0.22 },
};
const OTHER = { w: 0.6, c2m: 0.28, m2p: 0.49, p2r: 0.25 };
/** Contacts that never meet are spread a little wider than the rate alone. */
const CONTACT_SPREAD = 1.25;

/** First meetings per month, oldest first, ending last month (the trend). */
const MG1_HISTORY = [36, 41, 48, 55, 60, 71];
/** First meetings so far this month: 62 by the 13th, slower later on. */
export const mg1ThisMonth = (dayOfMonth: number): number =>
  Math.min(92, Math.round(62 * Math.sqrt(dayOfMonth / 13)));

export function seedSteps(): PipelineStep[] {
  const created = subDays(new Date(), 400).toISOString();
  const pos: Record<string, number> = {};
  const steps: PipelineStep[] = DEFAULT_STEPS.map((s) => {
    const position = (pos[s.band] = (pos[s.band] ?? -1) + 1);
    return {
      id: s.id,
      ownerId: PARTNER_LEADER_ID,
      band: s.band as StepBand,
      label: s.label,
      position,
      createdAt: created,
    };
  });
  steps.push({
    ...ANITA_STEP,
    band: ANITA_STEP.band as StepBand,
    position: 0,
    createdAt: subDays(new Date(), 120).toISOString(),
  });
  return steps;
}

export function seedHides(): StepHide[] {
  return [{ ...DAVID_HIDES, createdAt: subDays(new Date(), 60).toISOString() }];
}

export function seedSettings(): TeamSetting[] {
  const at = subDays(new Date(), 90).toISOString();
  const s = (personId: string, mg1Goal: number | null, targets = null as TeamSetting["targets"]) =>
    ({ personId, mg1Goal, targets, updatedAt: at }) satisfies TeamSetting;
  return [
    s("1", 80, { ...DEFAULT_TARGETS }),
    s("2", 35),
    s("3", 30),
    s("6", 15),
    s("8", 15),
    s("4", 12, { contactToMeeting: 25, meetingToPlan: 40, planToRegistered: 25 }),
  ];
}

export function seedShares(): StatShare[] {
  // Marcus mentors Anita's leg and shares his numbers with her (a crossline).
  return [
    {
      id: "share-6-2",
      ownerId: "6",
      viewerId: "2",
      createdAt: subDays(new Date(), 21).toISOString(),
    },
  ];
}

export function seedRequests(): StatRequest[] {
  const at = (n: number) => subDays(new Date(), n).toISOString();
  return [
    // Priya (a crossline) asks Anita; Jamal asks Maria (his upline's upline).
    { id: "req-8-2", requesterId: "8", ownerId: "2", status: "pending", createdAt: at(1), decidedAt: null },
    { id: "req-4-1", requesterId: "4", ownerId: "1", status: "pending", createdAt: at(2), decidedAt: null },
    { id: "req-7-6", requesterId: "7", ownerId: "6", status: "declined", createdAt: at(30), decidedAt: at(29) },
  ]; // prettier-ignore
}

/** Local time `daysAgo` days back at a given hour (minutes keep same-day moves ordered). */
function stamp(now: Date, daysAgo: number, hour: number, minute = 0): string {
  const d = subDays(now, daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * The whole pipeline seed for these people (the CRM seed, which already
 * includes ./seedPeople.ts). `now` is for tests.
 */
export function seedPipeline(people: CrmPerson[], now: Date = new Date()): PipelineData {
  const rng = makeRng(77);
  const steps = seedSteps();
  const hides = seedHides();
  const byId = new Map(people.map((p) => [p.id, p]));
  const monthStart = startOfMonth(now);
  const daysAgoOf = (d: Date) =>
    Math.round((subDays(now, 0).setHours(12, 0, 0, 0) - new Date(d).setHours(12, 0, 0, 0)) / 864e5);
  const agoOfDay = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return daysAgoOf(new Date(y, m - 1, d));
  };

  const colCache = new Map<string, PipelineColumn[]>();
  const columnsOf = (ownerId: string) => {
    let c = colCache.get(ownerId);
    if (!c) {
      c = columnsFor(chainOf(people, ownerId), steps, hides);
      colCache.set(ownerId, c);
    }
    return c;
  };

  const moves: PipelineMove[] = [];
  let n = 0;
  /** Record a path of [column, daysAgo] stops (already in order). */
  const record = (personId: string, ownerId: string, stops: [string, number][]) => {
    let prev: string | null = null;
    let lastDay = Infinity;
    let minute = 0;
    let todayCount = stops.filter(([, d]) => d === 0).length;
    for (const [col, d] of stops) {
      if (d < 0) break; // in the future: the path stops here for now
      minute = d === lastDay ? minute + 25 : Math.floor(rng() * 20);
      lastDay = d;
      // Today's moves happened in the last hours, never later than now.
      const movedAt =
        d === 0
          ? new Date(now.getTime() - todayCount-- * 17 * 60_000).toISOString()
          : stamp(now, d, 10 + Math.floor(minute / 60), minute % 60);
      const band = isMilestone(col) ? col : steps.find((s) => s.id === col)!.band;
      moves.push({
        id: `pm${n++}`,
        personId,
        ownerId,
        from: prev,
        to: col,
        milestone: band as MilestoneCode,
        movedAt,
        movedBy: ownerId,
      });
      prev = col;
    }
    return prev;
  };

  /** Stops from `fromAgo` (first column) to the column at `targetIdx`, skipping some steps. */
  const pathTo = (cols: PipelineColumn[], targetIdx: number, fromAgo: number, toAgo: number) => {
    const chosen = cols.slice(0, targetIdx + 1).filter((c, i) => {
      if (i === 0 || i === targetIdx || c.kind === "milestone") return true;
      return rng() < 0.75;
    });
    const span = Math.max(0, fromAgo - toAgo);
    return chosen.map((c, i): [string, number] => {
      if (i === chosen.length - 1) return [c.id, toAgo];
      if (i === 0) return [c.id, fromAgo];
      const t = i / (chosen.length - 1);
      return [c.id, Math.round(fromAgo - span * t)];
    });
  };

  // --- Real prospects: a path to where they are now -----------------------
  const { placements, registrations } = pipelineSeedPlan();
  const cards: PipelineCard[] = [];
  for (const pl of placements) {
    const person = byId.get(pl.personId);
    if (!person || person.bizClass !== "prospect" || !person.sponsorId) continue;
    const cols = columnsOf(person.sponsorId);
    let idx = cols.findIndex((c) => c.id === pl.column);
    if (idx < 0) idx = cols.findIndex((c) => c.id === (bandOfSeed(pl.column, steps) ?? "contact"));
    const joined = person.joinedDate ? agoOfDay(person.joinedDate) : pl.enteredDaysAgo;
    const contactAgo = Math.max(pl.contactDaysAgo ?? joined, pl.enteredDaysAgo);
    record(person.id, person.sponsorId, pathTo(cols, idx, contactAgo, pl.enteredDaysAgo));
    const enteredAt = moves[moves.length - 1].movedAt;
    cards.push({
      personId: person.id,
      column: cols[idx].id,
      enteredAt,
      nextStep: pl.next?.text ?? null,
      nextStepDate: pl.next ? localDate(addDays(now, pl.next.inDays)) : null,
      hot: !!pl.hot,
      source: pl.source ?? null,
      droppedAt: null,
      updatedAt: enteredAt,
    });
  }
  // Registered lately: their whole path, ending in Registered.
  for (const r of registrations) {
    const person = byId.get(r.personId);
    if (!person?.sponsorId) continue;
    const cols = columnsOf(person.sponsorId);
    record(
      person.id,
      person.sponsorId,
      pathTo(cols, cols.length - 1, r.contactDaysAgo, r.regDaysAgo),
    );
  }

  // --- History: prospects who have since left the CRM ----------------------
  const realMg1 = new Map<string, number>();
  for (const r of reachesOf(moves)) {
    if (r.milestone !== "first_meeting") continue;
    const key = r.day.slice(0, 7);
    realMg1.set(key, (realMg1.get(key) ?? 0) + 1);
  }

  const owners = people
    .filter(
      (p) =>
        (p.bizClass === "apprentice" || p.bizClass === "ibo") &&
        !!p.businessStartDate &&
        agoOfDay(p.businessStartDate) > 60,
    )
    .map((p) => ({ id: p.id, ...(PROFILE[p.id] ?? OTHER) }));
  const totalW = owners.reduce((s, o) => s + o.w, 0);
  const pickOwner = () => {
    let r = rng() * totalW;
    for (const o of owners) {
      r -= o.w;
      if (r < 0) return o;
    }
    return owners[owners.length - 1];
  };

  let x = 0;
  const contactDebt = new Map<string, number>();
  // Error diffusion per owner, so each owner's rates track their profile.
  const planAcc = new Map<string, number>();
  const regAcc = new Map<string, number>();
  const take = (acc: Map<string, number>, id: string, p: number, commit = true) => {
    const v = (acc.get(id) ?? rng() * 0.5) + p;
    if (v >= 1) {
      if (commit) acc.set(id, v - 1);
      return true;
    }
    if (commit) acc.set(id, v);
    return false;
  };
  const range = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
  const stepsIn = (cols: PipelineColumn[], band: MilestoneCode) =>
    cols.filter((c) => c.band === band && c.kind === "step");

  const monthKeys: { start: Date; end: Date; target: number }[] = [];
  MG1_HISTORY.forEach((target, i) => {
    const start = startOfMonth(subMonths(now, MG1_HISTORY.length - i));
    monthKeys.push({ start, end: endOfMonth(start), target });
  });
  monthKeys.push({ start: monthStart, end: now, target: mg1ThisMonth(getDate(now)) });

  for (const mk of monthKeys) {
    const key = localDate(mk.start).slice(0, 7);
    const need = Math.max(0, mk.target - (realMg1.get(key) ?? 0));
    const firstAgo = daysAgoOf(mk.start);
    const lastAgo = Math.max(0, daysAgoOf(mk.end));
    for (let i = 0; i < need; i++) {
      const o = pickOwner();
      const cols = columnsOf(o.id);
      const mg1 = range(lastAgo, firstAgo);
      const contact = mg1 + range(3, 18);
      const stops: [string, number][] = [["contact", contact]];
      const pre = stepsIn(cols, "contact").filter(() => rng() < 0.85);
      pre.forEach((c, k) =>
        stops.push([c.id, contact - Math.round(((k + 1) * (contact - mg1)) / (pre.length + 1))]),
      );
      stops.push(["first_meeting", mg1]);
      const mgSteps = stepsIn(cols, "first_meeting");
      let at = mg1;
      if (take(planAcc, o.id, o.m2p)) {
        const plan = mg1 - range(6, 20);
        const used = mgSteps.filter(() => rng() < 0.7);
        used.forEach((c, k) =>
          stops.push([c.id, mg1 - Math.round(((k + 1) * (mg1 - plan)) / (used.length + 1))]),
        );
        stops.push(["first_plan", plan]);
        at = plan;
        const planSteps = stepsIn(cols, "first_plan");
        const reg = plan - range(12, 35);
        const regThisMonth = reg >= 0 && reg <= daysAgoOf(monthStart);
        if (!regThisMonth && take(regAcc, o.id, o.p2r)) {
          const used2 = planSteps.filter((_, k) => rng() < (k === 0 ? 0.9 : 0.65));
          used2.forEach((c, k) =>
            stops.push([c.id, plan - Math.round(((k + 1) * (plan - reg)) / (used2.length + 1))]),
          );
          stops.push(["registered", reg]);
        } else {
          // Stall inside the band: mostly at F1, right after the plan.
          const r = rng();
          const upto = r < 0.22 ? 0 : r < 0.72 ? 1 : r < 0.84 ? 2 : r < 0.92 ? 3 : planSteps.length;
          planSteps.slice(0, upto).forEach((c) => {
            at -= range(2, 6);
            stops.push([c.id, at]);
          });
        }
      } else {
        const upto = Math.floor(rng() * (mgSteps.length + 1));
        mgSteps.slice(0, upto).forEach((c) => {
          at -= range(1, 5);
          stops.push([c.id, at]);
        });
      }
      record(`x${x++}`, o.id, stops);

      // Contacts that never became a first meeting, at this owner's rate.
      const debt = (contactDebt.get(o.id) ?? 0) + (1 / o.c2m - 1) * CONTACT_SPREAD;
      let whole = Math.floor(debt);
      contactDebt.set(o.id, debt - whole);
      while (whole-- > 0) {
        const c = range(lastAgo, firstAgo);
        const s2: [string, number][] = [["contact", c]];
        const cs = stepsIn(cols, "contact");
        let d = c;
        if (cs[0] && rng() < 0.35) {
          d -= range(1, 5);
          s2.push([cs[0].id, d]);
          if (cs[1] && rng() < 0.45) s2.push([cs[1].id, d - range(1, 5)]);
        }
        record(`x${x++}`, o.id, s2);
      }
    }
  }

  return {
    steps,
    hides,
    cards,
    moves,
    settings: seedSettings(),
    shares: seedShares(),
    requests: seedRequests(),
  };
}

function bandOfSeed(col: string, steps: PipelineStep[]): string | null {
  return isMilestone(col) ? col : (steps.find((s) => s.id === col)?.band ?? null);
}
