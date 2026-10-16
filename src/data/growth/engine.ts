/**
 * Milestone engine (pure: no React, no stores). Works out where a person is
 * on the growth path from the sponsor tree, logged sales (PV), monthly PV set
 * by uplines, milestones marked by hand and the history the app recorded.
 *
 * Rules (docs/plans/mvp-plan-2026-10-13.md, "Growth path"):
 *  - PV counts per calendar month. A person's PV for a month is the PV of the
 *    sales attributed to them that month (`saleSellerId`), unless an upline
 *    set that month's PV (`PvOverride`), which replaces the logged total.
 *  - Group PV for a month = your PV plus everyone's in your business downline
 *    (GROUP_PV_INCLUDES_OWN). A leg is one frontline person and their whole
 *    line; a leg's PV is that line's group PV.
 *  - People counts are registered people (apprentices and IBOs) in your
 *    downline, not counting you; personal sponsors are the registered people
 *    on your frontline.
 *  - Whether a milestone is held today depends on its class (`hold`):
 *    permanent ones (New apprentice, First sale, First sponsor) stay once
 *    reached; live ones (3/10, 6/25, 6/50, 12/100) are held only while the
 *    current numbers meet them; monthly ones (Core 150/300, Bronze
 *    foundation/builder, 7,500 Platinum, Ruby) are held when the rule was met
 *    this calendar month or last month (met in September: held through
 *    October 31, gone on November 1 unless met again in November).
 *  - History is kept apart from "held": the first day a milestone was ever
 *    reached (from the data, the history recorded for count rules, or a hand
 *    mark; the earliest wins) and, for live and monthly ones, the last time
 *    it was met. A hand mark makes a permanent milestone reached; for a live
 *    or monthly one it only adds history.
 *  - Dates (never before the person registered): PV rules use the day the
 *    month's running total first met the rule
 *    (an upline's monthly figure counts from the day it was set, or the last
 *    day of the month when set later). Count rules use the registration date
 *    of the person who completed them (`registeredOn`). First sale: the date
 *    of the first sale to a customer (personal orders don't count).
 *  - The path's "next" milestone is the first one not held now, in order;
 *    later ones held out of order still show as held.
 */
import { differenceInCalendarDays, getDaysInMonth } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";
import type { Sale } from "@/stores/crmStore";
import { GROUP_PV_INCLUDES_OWN, GROWTH_MILESTONES } from "./milestones";
import type {
  GrowthLeg,
  GrowthMilestoneCode,
  GrowthMilestoneDef,
  GrowthPath,
  MilestoneHistory,
  MilestoneMark,
  MilestoneProgress,
  MilestoneStatus,
  ProgressPart,
  PvOverride,
} from "./types";

export interface GrowthInput {
  people: CrmPerson[];
  sales: Sale[];
  overrides: PvOverride[];
  marks: MilestoneMark[];
  /** History the app recorded for count milestones (left out = nothing recorded). */
  history?: MilestoneHistory[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM" of a "YYYY-MM-DD" date. */
export const monthOfDate = (date: string): string => date.slice(0, 7);

/** Number of days in a "YYYY-MM" month. */
export function daysInMonth(month: string): number {
  return getDaysInMonth(parseDate(`${month}-01`));
}

/** The calendar month `n` months after (before, for a negative `n`) a "YYYY-MM" month. */
export function addMonths(month: string, n: number): string {
  const total = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** The last day of a "YYYY-MM" month, "YYYY-MM-DD". */
export const lastDayOf = (month: string): string =>
  `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;

const dayOf = (date: string): number => Number(date.slice(8, 10));
const dateIn = (month: string, day: number): string => `${month}-${String(day).padStart(2, "0")}`;
const daysBetween = (from: string, to: string): number =>
  differenceInCalendarDays(parseDate(to), parseDate(from));
const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");
const earliest = (...dates: (string | null | undefined)[]): string | null =>
  dates.reduce<string | null>((a, d) => (d && (!a || d < a) ? d : a), null);

/** Apprentices and IBOs (registered businesses). */
export function isRegistered(p: CrmPerson): boolean {
  return p.bizClass === "apprentice" || p.bizClass === "ibo";
}

/**
 * The day a person registered: their business start date (moving a card to
 * Registered sets it), else the first apprentice/IBO entry in their stage
 * history, else the day they joined. Null for anyone not registered.
 */
export function registeredOn(p: CrmPerson): string | null {
  if (!isRegistered(p)) return null;
  if (p.businessStartDate) return p.businessStartDate.slice(0, 10);
  const h = p.stageHistory?.find((s) => s.stage === "apprentice" || s.stage === "ibo");
  if (h) return h.at.slice(0, 10);
  return p.joinedDate?.slice(0, 10) ?? null;
}

/**
 * Whose PV a sale counts toward: its `personId` when set; otherwise the
 * customer's owner, or the buyer themselves when they're a business person
 * (a personal order).
 */
export function saleSellerId(sale: Sale, byId: Map<string, CrmPerson>): string | undefined {
  if (sale.personId) return sale.personId;
  const buyer = byId.get(sale.customerId);
  if (!buyer) return undefined;
  return buyer.bizClass === "customer" ? (buyer.ownerId ?? undefined) : buyer.id;
}

/** A personal order: the buyer is the seller. */
export function isPersonalOrder(sale: Sale, byId: Map<string, CrmPerson>): boolean {
  return saleSellerId(sale, byId) === sale.customerId;
}

/**
 * The day an upline's monthly figure starts counting: the day it was set when
 * that's inside the month, else the month's last day (or first, if set before).
 */
function overrideDay(o: PvOverride): number {
  const last = daysInMonth(o.month);
  const set = o.setAt ? o.setAt.slice(0, 10) : "";
  if (!set || monthOfDate(set) > o.month) return last;
  if (monthOfDate(set) < o.month) return 1;
  return Math.min(last, Math.max(1, dayOf(set)));
}

// ---------------------------------------------------------------------------
// Index (built once per input and day, then memoised per person)
// ---------------------------------------------------------------------------

interface Index {
  today: string;
  month: string;
  byId: Map<string, CrmPerson>;
  /** Business-path children (no customers) by sponsor id. */
  kids: Map<string, string[]>;
  /** person -> month -> PV logged per day (index 0 = the 1st). */
  daily: Map<string, Map<string, number[]>>;
  overrides: Map<string, Map<string, PvOverride>>;
  marks: Map<string, Map<GrowthMilestoneCode, MilestoneMark>>;
  history: Map<string, Map<GrowthMilestoneCode, MilestoneHistory>>;
  /** person -> date of their first sale to a customer. */
  firstSale: Map<string, string>;
  ownCum: Map<string, number[]>;
  groupCum: Map<string, number[]>;
  months: Map<string, string[]>;
  ownMonths: Map<string, string[]>;
  descendants: Map<string, string[]>;
  paths: Map<string, GrowthPath>;
}

function byPersonAndCode<T extends { personId: string; code: GrowthMilestoneCode }>(
  rows: T[],
): Map<string, Map<GrowthMilestoneCode, T>> {
  const out = new Map<string, Map<GrowthMilestoneCode, T>>();
  for (const r of rows) {
    let m = out.get(r.personId);
    if (!m) out.set(r.personId, (m = new Map()));
    m.set(r.code, r);
  }
  return out;
}

/** Business-path children by sponsor id (customers never count toward a team). */
function businessKids(people: CrmPerson[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  for (const p of people) {
    if (p.bizClass === "customer" || !p.sponsorId || p.sponsorId === p.id) continue;
    const arr = kids.get(p.sponsorId) ?? [];
    arr.push(p.id);
    kids.set(p.sponsorId, arr);
  }
  return kids;
}

function buildIndex(input: GrowthInput, today: string): Index {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const kids = businessKids(input.people);
  const daily = new Map<string, Map<string, number[]>>();
  const firstSale = new Map<string, string>();
  for (const s of input.sales) {
    if (!s.date || s.date > today) continue;
    const seller = saleSellerId(s, byId);
    if (!seller) continue;
    if (s.customerId !== seller) {
      const prev = firstSale.get(seller);
      if (!prev || s.date < prev) firstSale.set(seller, s.date);
    }
    const pv = Number(s.pv ?? 0);
    if (!(pv > 0)) continue;
    const month = monthOfDate(s.date);
    let byMonth = daily.get(seller);
    if (!byMonth) daily.set(seller, (byMonth = new Map()));
    let days = byMonth.get(month);
    if (!days) byMonth.set(month, (days = new Array(daysInMonth(month)).fill(0)));
    days[dayOf(s.date) - 1] += pv;
  }
  const overrides = new Map<string, Map<string, PvOverride>>();
  for (const o of input.overrides) {
    if (o.month > monthOfDate(today)) continue;
    let m = overrides.get(o.personId);
    if (!m) overrides.set(o.personId, (m = new Map()));
    m.set(o.month, o);
  }
  return {
    today,
    month: monthOfDate(today),
    byId,
    kids,
    daily,
    overrides,
    marks: byPersonAndCode(input.marks),
    history: byPersonAndCode(input.history ?? []),
    firstSale,
    ownCum: new Map(),
    groupCum: new Map(),
    months: new Map(),
    ownMonths: new Map(),
    descendants: new Map(),
    paths: new Map(),
  };
}

let cached: { input: GrowthInput; today: string; index: Index } | null = null;

function indexFor(input: GrowthInput, today: string): Index {
  const c = cached;
  if (
    c &&
    c.today === today &&
    c.input.people === input.people &&
    c.input.sales === input.sales &&
    c.input.overrides === input.overrides &&
    c.input.marks === input.marks &&
    c.input.history === input.history
  ) {
    return c.index;
  }
  const index = buildIndex(input, today);
  cached = { input, today, index };
  return index;
}

/** Running total of a person's own PV through each day of a month. */
function ownCum(ix: Index, id: string, month: string): number[] {
  const key = `${id}|${month}`;
  const hit = ix.ownCum.get(key);
  if (hit) return hit;
  const n = daysInMonth(month);
  const out = new Array<number>(n).fill(0);
  const o = ix.overrides.get(id)?.get(month);
  if (o) {
    const d = overrideDay(o);
    for (let i = d - 1; i < n; i++) out[i] = o.pv;
  } else {
    const days = ix.daily.get(id)?.get(month);
    let run = 0;
    for (let i = 0; i < n; i++) {
      run += days?.[i] ?? 0;
      out[i] = run;
    }
  }
  ix.ownCum.set(key, out);
  return out;
}

/** Running group PV (the person and their whole line) through each day of a month. */
function groupCum(ix: Index, id: string, month: string, seen = new Set<string>()): number[] {
  const key = `${id}|${month}`;
  const hit = ix.groupCum.get(key);
  if (hit) return hit;
  seen.add(id);
  const out = [...ownCum(ix, id, month)];
  for (const k of ix.kids.get(id) ?? []) {
    if (seen.has(k)) continue;
    const sub = groupCum(ix, k, month, seen);
    for (let i = 0; i < out.length; i++) out[i] += sub[i];
  }
  ix.groupCum.set(key, out);
  return out;
}

/** Everyone in a person's business downline (not them), depth-first. */
function descendants(ix: Index, id: string): string[] {
  const hit = ix.descendants.get(id);
  if (hit) return hit;
  const out: string[] = [];
  const seen = new Set([id]);
  const stack = [...(ix.kids.get(id) ?? [])];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    stack.push(...(ix.kids.get(c) ?? []));
  }
  ix.descendants.set(id, out);
  return out;
}

function monthsOf(ix: Index, id: string): string[] {
  const set = new Set<string>();
  for (const m of ix.daily.get(id)?.keys() ?? []) set.add(m);
  for (const m of ix.overrides.get(id)?.keys() ?? []) set.add(m);
  return [...set];
}

/** Months with any PV on record for the person (own only), oldest first. */
function ownMonths(ix: Index, id: string): string[] {
  const hit = ix.ownMonths.get(id);
  if (hit) return hit;
  const out = monthsOf(ix, id)
    .filter((m) => m <= ix.month)
    .sort();
  ix.ownMonths.set(id, out);
  return out;
}

/** Months with any PV on record in the person's group, oldest first. */
function groupMonths(ix: Index, id: string): string[] {
  const hit = ix.months.get(id);
  if (hit) return hit;
  const set = new Set(monthsOf(ix, id));
  for (const d of descendants(ix, id)) for (const m of monthsOf(ix, d)) set.add(m);
  const out = [...set].filter((m) => m <= ix.month).sort();
  ix.months.set(id, out);
  return out;
}

/** Group PV total line used by the rules (with or without your own PV). */
function totalCum(ix: Index, id: string, month: string): number[] {
  const group = groupCum(ix, id, month);
  if (GROUP_PV_INCLUDES_OWN) return group;
  const own = ownCum(ix, id, month);
  return group.map((v, i) => v - own[i]);
}

const lastOf = (arr: number[]): number => arr[arr.length - 1] ?? 0;

/** Registration dates of the person's personal sponsors and whole group, oldest first. */
function teamDates(ix: Index, id: string): { sponsors: string[]; people: string[] } {
  const reg = (pid: string) => {
    const p = ix.byId.get(pid);
    return p && isRegistered(p) ? (registeredOn(p) ?? ix.today) : null;
  };
  const sponsors = (ix.kids.get(id) ?? [])
    .map(reg)
    .filter((d): d is string => d !== null)
    .sort();
  const people = descendants(ix, id)
    .map(reg)
    .filter((d): d is string => d !== null)
    .sort();
  return { sponsors, people };
}

/** A person's structure: "4/27" = 4 frontline, 27 in the whole group (not them). */
export interface TeamStructure {
  /** People they personally sponsored. */
  frontline: number;
  /** Everyone in their downline, at any depth. */
  total: number;
}

/**
 * The team-map structure in the milestone notation (3/10, 6/25): registered
 * personal sponsors / registered people in the whole group, not counting the
 * person, counted exactly like the headcount milestones (`teamDates`).
 * `includeProspects` also counts prospects (the map's "Include prospects";
 * those numbers are not milestone numbers).
 */
export function teamStructure(
  people: CrmPerson[],
  personId: string,
  opts: { includeProspects?: boolean } = {},
): TeamStructure {
  const byId = new Map(people.map((p) => [p.id, p]));
  const kids = businessKids(people);
  const counts = (id: string) => {
    const p = byId.get(id);
    return !!p && (isRegistered(p) || (!!opts.includeProspects && p.bizClass === "prospect"));
  };
  const frontline = (kids.get(personId) ?? []).filter(counts).length;
  let total = 0;
  const seen = new Set([personId]);
  const stack = [...(kids.get(personId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    if (counts(id)) total++;
    stack.push(...(kids.get(id) ?? []));
  }
  return { frontline, total };
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** First day in a month the condition holds, as "YYYY-MM-DD", or null. */
function firstDay(month: string, holds: (dayIndex: number) => boolean): string | null {
  const n = daysInMonth(month);
  for (let i = 0; i < n; i++) if (holds(i)) return dateIn(month, i + 1);
  return null;
}

/** A month in which a monthly (PV) rule was met, and the day it was first met in it. */
interface MetMonth {
  month: string;
  on: string;
}

/**
 * Every month on record in which a monthly (PV) rule was met, oldest first,
 * with the day the month's running total first met it (not after today).
 */
function metMonths(ix: Index, id: string, def: GrowthMilestoneDef): MetMonth[] {
  const c = def.check;
  const out: MetMonth[] = [];
  const push = (month: string, on: string | null) => {
    if (on && on <= ix.today) out.push({ month, on });
  };
  switch (c.kind) {
    case "personal_pv":
      for (const m of ownMonths(ix, id)) {
        const own = ownCum(ix, id, m);
        push(
          m,
          firstDay(m, (i) => own[i] >= c.pv),
        );
      }
      break;
    case "group_pv":
      for (const m of groupMonths(ix, id)) {
        const total = totalCum(ix, id, m);
        push(
          m,
          firstDay(m, (i) => total[i] >= c.pv),
        );
      }
      break;
    case "legs_pv": {
      const legs = ix.kids.get(id) ?? [];
      if (legs.length < c.legs) break;
      for (const m of groupMonths(ix, id)) {
        const total = totalCum(ix, id, m);
        if (lastOf(total) < c.groupPv) continue;
        const legCums = legs.map((k) => groupCum(ix, k, m));
        push(
          m,
          firstDay(
            m,
            (i) => total[i] >= c.groupPv && legCums.filter((l) => l[i] >= c.legPv).length >= c.legs,
          ),
        );
      }
      break;
    }
    default:
      break;
  }
  return out;
}

/**
 * When the data shows the rule met, or null. Count rules look at the current
 * sponsor tree (met right now or not); PV rules at the first month that met it.
 */
function autoReached(ix: Index, id: string, def: GrowthMilestoneDef): string | null {
  const person = ix.byId.get(id);
  if (!person) return null;
  const c = def.check;
  switch (c.kind) {
    case "registered":
      return registeredOn(person);
    case "first_sale":
      return ix.firstSale.get(id) ?? null;
    case "count": {
      const { sponsors, people } = teamDates(ix, id);
      if (sponsors.length < c.sponsors || people.length < c.people) return null;
      const a = c.sponsors > 0 ? sponsors[c.sponsors - 1] : "";
      const b = c.people > 0 ? people[c.people - 1] : "";
      return (a > b ? a : b) || null;
    }
    default:
      return metMonths(ix, id, def)[0]?.on ?? null;
  }
}

function part(
  key: ProgressPart["key"],
  label: string,
  current: number,
  target: number,
): ProgressPart {
  return { key, label, current, target };
}

const ratioOf = (parts: ProgressPart[]): number =>
  parts.length
    ? parts.reduce((s, p) => s + (p.target > 0 ? Math.min(1, p.current / p.target) : 1), 0) /
      parts.length
    : 0;

function bestMonth(
  months: string[],
  value: (m: string) => number,
): { month: string; value: number } | null {
  let best: { month: string; value: number } | null = null;
  for (const m of months) {
    const v = value(m);
    if (v > 0 && (!best || v > best.value)) best = { month: m, value: v };
  }
  return best;
}

/** Live progress toward a milestone, as of today. */
function progressFor(ix: Index, id: string, def: GrowthMilestoneDef): MilestoneProgress {
  const c = def.check;
  const month = ix.month;
  switch (c.kind) {
    case "registered": {
      const parts = [part("registered", "Registered", 0, 1)];
      return { parts, ratio: 0, summary: "Not registered yet" };
    }
    case "first_sale": {
      const parts = [part("sales", "Sales to customers", 0, 1)];
      return { parts, ratio: 0, summary: "No sales to customers logged yet" };
    }
    case "personal_pv": {
      const pv = lastOf(ownCum(ix, id, month));
      const parts = [part("pv", "Your PV this month", pv, c.pv)];
      return {
        parts,
        ratio: ratioOf(parts),
        summary: `${fmt(pv)} / ${fmt(c.pv)} PV this month`,
        month,
        best: bestMonth(ownMonths(ix, id), (m) => lastOf(ownCum(ix, id, m))),
      };
    }
    case "group_pv": {
      const pv = lastOf(totalCum(ix, id, month));
      const parts = [part("group_pv", "Group PV this month", pv, c.pv)];
      return {
        parts,
        ratio: ratioOf(parts),
        summary: `${fmt(pv)} / ${fmt(c.pv)} group PV this month`,
        month,
        best: bestMonth(groupMonths(ix, id), (m) => lastOf(totalCum(ix, id, m))),
      };
    }
    case "legs_pv": {
      const legs: GrowthLeg[] = (ix.kids.get(id) ?? [])
        .map((k) => ({
          personId: k,
          name: ix.byId.get(k)?.name ?? "",
          pv: lastOf(groupCum(ix, k, month)),
        }))
        .filter((l) => l.pv > 0 || isRegistered(ix.byId.get(l.personId)!))
        .sort((a, b) => b.pv - a.pv || a.name.localeCompare(b.name));
      const qualified = legs.filter((l) => l.pv >= c.legPv).length;
      const total = lastOf(totalCum(ix, id, month));
      const parts = [
        part("legs", `Legs at ${fmt(c.legPv)}+ PV`, qualified, c.legs),
        part("group_pv", "Group PV this month", total, c.groupPv),
      ];
      return {
        parts,
        ratio: ratioOf(parts),
        summary: `${Math.min(qualified, c.legs)}/${c.legs} legs at ${fmt(c.legPv)}+ PV, ${fmt(total)} / ${fmt(c.groupPv)} group PV this month`,
        month,
        best: bestMonth(groupMonths(ix, id), (m) => lastOf(totalCum(ix, id, m))),
        legs,
      };
    }
    case "count": {
      const { sponsors, people } = teamDates(ix, id);
      const parts = [part("sponsors", "Registered personal sponsors", sponsors.length, c.sponsors)];
      if (c.people > 0)
        parts.push(part("people", "Registered people in total", people.length, c.people));
      const s = Math.min(sponsors.length, c.sponsors);
      const n = Math.min(people.length, c.people);
      const summary =
        c.people > 0
          ? `${s}/${c.sponsors} personal sponsors, ${n}/${c.people} people`
          : sponsors.length === 0
            ? "Nobody you sponsored has registered yet"
            : `${s}/${c.sponsors} personal sponsors`;
      return { parts, ratio: ratioOf(parts), summary };
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function statusFor(
  ix: Index,
  personId: string,
  def: GrowthMilestoneDef,
  index: number,
): MilestoneStatus {
  const person = ix.byId.get(personId);
  const registered = person ? registeredOn(person) : null;
  // Nothing is reached before registering (people moved under you keep
  // their own, older registration dates).
  const clamp = (d: string | null): string | null =>
    d && registered && d < registered ? registered : d;
  const mark = ix.marks.get(personId)?.get(def.code) ?? null;
  const recorded = ix.history.get(personId)?.get(def.code) ?? null;
  const lastMonth = addMonths(ix.month, -1);

  let held: boolean;
  let dataOn: string | null;
  let lastMetOn: string | null = null;
  let heldVia: MilestoneStatus["heldVia"] = null;
  let heldUntil: string | null = null;

  if (def.hold === "monthly") {
    // Held when met this calendar month or last month; a hand mark is history only.
    const months = person ? metMonths(ix, personId, def) : [];
    dataOn = clamp(months[0]?.on ?? null);
    const last = months[months.length - 1];
    lastMetOn = last ? clamp(last.on) : null;
    if (months.some((m) => m.month === ix.month)) heldVia = "this_month";
    else if (months.some((m) => m.month === lastMonth)) heldVia = "last_month";
    held = heldVia !== null;
    if (heldVia)
      heldUntil = lastDayOf(addMonths(heldVia === "this_month" ? ix.month : lastMonth, 1));
  } else {
    const now = person ? clamp(autoReached(ix, personId, def)) : null;
    // Recorded history (count rules) keeps what the tree may no longer show.
    dataOn = earliest(now, recorded?.firstReachedOn);
    if (def.hold === "live") {
      // Held only while the numbers meet it now; a hand mark is history only.
      held = now !== null;
      lastMetOn = held ? ix.today : (recorded?.lastMetOn ?? null);
    } else {
      // Permanent: reached once (data, recorded history or a hand mark) is reached.
      held = dataOn !== null || mark !== null;
    }
  }

  const firstReachedOn = earliest(dataOn, mark?.reachedOn);
  const source: MilestoneStatus["source"] = !firstReachedOn
    ? null
    : dataOn === firstReachedOn
      ? "auto"
      : "manual";
  return {
    code: def.code,
    label: def.label,
    rule: def.rule,
    index,
    hold: def.hold,
    state: held ? "held" : firstReachedOn ? "lost" : "never",
    held,
    firstReachedOn,
    source,
    autoOn: dataOn,
    mark,
    lastMetOn,
    heldVia,
    heldUntil,
    daysTaken: null,
    progress: !held || heldVia === "last_month" ? progressFor(ix, personId, def) : null,
  };
}

function computePath(ix: Index, personId: string): GrowthPath {
  const person = ix.byId.get(personId);
  const statuses = GROWTH_MILESTONES.map((def, index) => statusFor(ix, personId, def, index));
  let prev: string | null = null;
  for (const s of statuses) {
    if (!s.firstReachedOn) continue;
    if (prev) {
      const d = daysBetween(prev, s.firstReachedOn);
      s.daysTaken = d >= 0 ? d : null;
    }
    prev = s.firstReachedOn;
  }
  const nextIndex = statuses.findIndex((s) => !s.held);
  const next = nextIndex === -1 ? null : statuses[nextIndex];
  const held = statuses.filter((s) => s.held);
  const latest = held.length ? held[held.length - 1] : null;
  // "Working on it since…" only for a milestone never reached before.
  const before =
    nextIndex > 0 && next?.state === "never" ? statuses[nextIndex - 1].firstReachedOn : null;
  const month = ix.month;
  return {
    personId,
    registered: !!person && isRegistered(person),
    milestones: statuses,
    nextIndex,
    next,
    latest,
    workingDays: before ? Math.max(0, daysBetween(before, ix.today)) : null,
    keepUp: statuses.filter((s) => s.heldVia === "last_month"),
    thisMonth: {
      month,
      pv: lastOf(ownCum(ix, personId, month)),
      groupPv: lastOf(totalCum(ix, personId, month)),
      override: ix.overrides.get(personId)?.get(month) ?? null,
      daysLeft: daysInMonth(month) - dayOf(ix.today),
    },
  };
}

/**
 * A person's growth path as of `today` ("YYYY-MM-DD"). Pass the whole data
 * set the viewer may see; only the person and their downline are used.
 */
export function growthPath(input: GrowthInput, personId: string, today: string): GrowthPath {
  const ix = indexFor(input, today);
  let path = ix.paths.get(personId);
  if (!path) {
    path = computePath(ix, personId);
    ix.paths.set(personId, path);
  }
  return path;
}

const statusIn = (
  input: GrowthInput,
  personId: string,
  code: GrowthMilestoneCode,
  today: string,
): MilestoneStatus | undefined =>
  growthPath(input, personId, today).milestones.find((m) => m.code === code);

/**
 * True once the person has ever reached the milestone (from the data,
 * recorded history or a hand mark), whether it's held now or not. Unlocks go
 * by this: dropping below 3/10 keeps event planning.
 */
export function hasEverReachedMilestone(
  input: GrowthInput,
  personId: string,
  code: GrowthMilestoneCode,
  today: string,
): boolean {
  return !!statusIn(input, personId, code, today)?.firstReachedOn;
}

/** True when the milestone is held today (checked on the path). */
export function isMilestoneHeld(
  input: GrowthInput,
  personId: string,
  code: GrowthMilestoneCode,
  today: string,
): boolean {
  return !!statusIn(input, personId, code, today)?.held;
}

/** A history row to write (who and when are added by the caller / database). */
export type HistoryUpdate = Omit<MilestoneHistory, "recordedBy" | "recordedAt">;

/**
 * History rows to write so the count milestones (First sponsor and the
 * headcount ones) the data shows met right now are remembered when the tree
 * later changes: a row when there is none, when the data shows an earlier
 * first day, or when the last-met day is from an earlier month (refreshed at
 * most once a month). Only rows that change, merged with what's recorded.
 */
export function historyUpdates(
  input: GrowthInput,
  personIds: Iterable<string>,
  today: string,
): HistoryUpdate[] {
  const ix = indexFor(input, today);
  const out: HistoryUpdate[] = [];
  for (const personId of personIds) {
    const person = ix.byId.get(personId);
    if (!person || !isRegistered(person)) continue;
    const registered = registeredOn(person);
    for (const def of GROWTH_MILESTONES) {
      if (def.check.kind !== "count") continue;
      let now = autoReached(ix, personId, def);
      if (!now) continue;
      if (registered && now < registered) now = registered;
      const rec = ix.history.get(personId)?.get(def.code);
      if (rec && rec.firstReachedOn <= now && monthOfDate(rec.lastMetOn) >= ix.month) continue;
      out.push({
        personId,
        code: def.code,
        firstReachedOn: rec && rec.firstReachedOn < now ? rec.firstReachedOn : now,
        lastMetOn: rec && rec.lastMetOn > today ? rec.lastMetOn : today,
      });
    }
  }
  return out;
}

/** A person's PV for one month: the logged total, the upline's figure if any, and what counts. */
export function monthPv(
  input: GrowthInput,
  personId: string,
  month: string,
  today: string,
): { logged: number; override: PvOverride | null; pv: number } {
  const ix = indexFor(input, today);
  const days = ix.daily.get(personId)?.get(month);
  const logged = days ? days.reduce((s, v) => s + v, 0) : 0;
  const override = input.overrides.find((o) => o.personId === personId && o.month === month);
  return { logged, override: override ?? null, pv: override ? override.pv : logged };
}
