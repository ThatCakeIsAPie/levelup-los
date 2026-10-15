/**
 * Pipeline rules (pure functions, no React, no stores). Unit-tested in
 * rules.test.ts. The database will mirror the ones that guard writes
 * (milestones locked, who may edit a step, who may see whose numbers).
 */
import { addMonths, differenceInCalendarDays, endOfMonth, format, startOfMonth } from "date-fns";
import { localDate, parseDate } from "@/lib/dates";
import type { CrmPerson } from "@/stores/peopleStore";
import { downlineIds, type Viewer } from "../access";
import {
  DEFAULT_MG1_GOAL,
  DO_NOT_CONTACT,
  DEFAULT_TARGETS,
  MILESTONES,
  MIN_SAMPLE,
  RECRUITING_BOARD,
  STALE_DAYS,
  TRANSITIONS,
  type BoardDef,
  type ConversionTargets,
  type MilestoneCode,
  type PipelineCard,
  type PipelineColumn,
  type PipelineMove,
  type PipelineStep,
  type RateTone,
  type RecruitingBand,
  type StatRequest,
  type StatShare,
  type StepBand,
  type StepHide,
  type TeamSetting,
  type TransitionKey,
} from "./types";

// ---------------------------------------------------------------------------
// Milestones, bands and columns
// ---------------------------------------------------------------------------

/** Position of a milestone (0 … 3); -1 for the start and outcome bands. */
export const bandIndex = (m: RecruitingBand): number => MILESTONES.indexOf(m as MilestoneCode);

export const isMilestone = (id: string): id is MilestoneCode =>
  (MILESTONES as readonly string[]).includes(id);

/** The milestone after `m`, or null after Registered. */
export const nextMilestone = (m: MilestoneCode): MilestoneCode | null =>
  MILESTONES[bandIndex(m) + 1] ?? null;

/**
 * Sponsor chain root-first, ending with `personId` itself (all people, no
 * visibility filter: inherited steps and settings come from the whole chain).
 * With real accounts the people list stops at your own team: pass your
 * uplines (root first) to complete it.
 */
export function chainOf(people: CrmPerson[], personId: string, uplines: string[] = []): string[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = [personId];
  const seen = new Set(out);
  let cur = byId.get(personId);
  while (cur?.sponsorId && !seen.has(cur.sponsorId)) {
    seen.add(cur.sponsorId);
    out.unshift(cur.sponsorId);
    cur = byId.get(cur.sponsorId);
  }
  return withUplines(out, uplines);
}

/**
 * Complete a chain whose top is missing from the people list (real accounts
 * only load your own team) with your uplines (`sponsor_chain(me)`, root first).
 */
export function withUplines(chain: string[], uplines: string[]): string[] {
  if (!uplines.length || !chain.length) return chain;
  const i = uplines.indexOf(chain[0]);
  return i > 0 ? [...uplines.slice(0, i), ...chain] : chain;
}

/**
 * The board's columns for the last person in `chain`: each milestone, then
 * the steps in its band defined by anyone in the chain (uplines first, each
 * owner's steps in their own order), minus steps hidden by anyone in the
 * chain. Registered has no steps after it. Another board layout (`def`, the
 * customer board) adds its fixed start and outcome columns in their bands.
 */
export function columnsFor<B extends string = MilestoneCode>(
  chain: string[],
  steps: readonly PipelineStep<string>[],
  hides: StepHide[],
  def: BoardDef<B> = RECRUITING_BOARD as unknown as BoardDef<B>,
): PipelineColumn<B>[] {
  const depth = new Map(chain.map((id, i) => [id, i]));
  const hidden = new Set(hides.filter((h) => depth.has(h.personId)).map((h) => h.stepId));
  const out: PipelineColumn<B>[] = [];
  for (const band of def.bands) {
    const m = band.id;
    if (band.kind !== "milestone") {
      for (const f of def.fixed.filter((x) => x.band === m))
        out.push({ id: f.id, band: m, kind: "fixed", label: f.label, hint: f.hint });
      continue;
    }
    out.push({
      id: m,
      band: m,
      kind: "milestone",
      label: def.milestoneColumnLabel[m] ?? band.label,
    });
    if (!def.stepBands.includes(m)) continue;
    steps
      .filter((s) => s.band === m && depth.has(s.ownerId) && !hidden.has(s.id))
      .sort(byChainOrder(depth))
      .forEach((s) =>
        out.push({ id: s.id, band: m, kind: "step", label: s.label, ownerId: s.ownerId }),
      );
  }
  return out;
}

const byChainOrder =
  (depth: Map<string, number>) =>
  (a: PipelineStep<string>, b: PipelineStep<string>): number =>
    (depth.get(a.ownerId) ?? 0) - (depth.get(b.ownerId) ?? 0) ||
    a.position - b.position ||
    a.createdAt.localeCompare(b.createdAt);

/** A step as the steps editor shows it to the last person in `chain`. */
export interface ChainStep<S extends PipelineStep<string> = PipelineStep> {
  step: S;
  own: boolean;
  /** Who in the chain hides it (the person themselves, or an upline). */
  hiddenBy: string | null;
}

/** Every step in the chain for one band, in board order, with hide state. */
export function chainSteps<S extends PipelineStep<string>>(
  chain: string[],
  steps: readonly S[],
  hides: StepHide[],
  band: S["band"],
): ChainStep<S>[] {
  const depth = new Map(chain.map((id, i) => [id, i]));
  const me = chain[chain.length - 1];
  return steps
    .filter((s) => s.band === band && depth.has(s.ownerId))
    .sort(byChainOrder(depth))
    .map((step) => {
      const hiders = hides.filter((h) => h.stepId === step.id && depth.has(h.personId));
      // An upline's hide wins over the person's own (they can't show it again).
      const up = hiders.find((h) => h.personId !== me);
      return {
        step,
        own: step.ownerId === me,
        hiddenBy: up?.personId ?? hiders[0]?.personId ?? null,
      };
    });
}

/**
 * Where a card (or a move's `to`) shows on a board with these columns: the
 * column itself, else its band's milestone (a step that is hidden for this
 * board, belongs to another leader's team, or was deleted).
 */
export function resolveColumn(
  columnId: string,
  band: string,
  columnIds: ReadonlySet<string>,
): string {
  return columnIds.has(columnId) ? columnId : band;
}

/** The band of a column id (a milestone, a fixed column or a step), or null for an unknown step. */
export function bandOf(columnId: string, steps: PipelineStep[]): RecruitingBand | null;
/** On another board layout: the band of a milestone, fixed column or step. */
export function bandOf<B extends string>(
  columnId: string,
  steps: readonly PipelineStep<string>[],
  def: BoardDef<B>,
): B | null;
export function bandOf(
  columnId: string,
  steps: readonly PipelineStep<string>[],
  def: BoardDef<string> = RECRUITING_BOARD,
): string | null {
  if (def.milestones.includes(columnId)) return columnId;
  const fixed = def.fixed.find((f) => f.id === columnId);
  if (fixed) return fixed.band;
  return steps.find((s) => s.id === columnId)?.band ?? null;
}

/** The band of a card's column on the recruiting board (a deleted or unknown step counts as Contact made). */
export const recruitingBand = (column: string, steps: PipelineStep[]): RecruitingBand =>
  bandOf(column, steps) ?? "contact";

/** Bands where a card can go quiet: the milestones (not "Not contacted yet" or the outcomes). */
export const isMilestoneBand = (b: RecruitingBand): b is MilestoneCode => bandIndex(b) >= 0;

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type MoveCheck<C = PipelineColumn> =
  { ok: true; to: C } | { ok: false; reason: "not-on-board" | "unknown-column" | "same-column" };

/** Can this card move to `to` on a board with these columns? */
export function validateMove<C extends PipelineColumn<string> = PipelineColumn>(
  card: Pick<PipelineCard, "column" | "droppedAt"> | undefined,
  to: string,
  columns: C[],
): MoveCheck<C> {
  if (!card || card.droppedAt) return { ok: false, reason: "not-on-board" };
  const col = columns.find((c) => c.id === to);
  if (!col) return { ok: false, reason: "unknown-column" };
  if (card.column === to) return { ok: false, reason: "same-column" };
  return { ok: true, to: col };
}

/** The people patch that registering applies: an apprentice from today. */
export function registrationPatch(today: string): Partial<CrmPerson> {
  return { bizClass: "apprentice", pipelineStage: "apprentice", businessStartDate: today };
}

/** The column after `columnId` on this board (null at the end). */
export function nextColumn<C extends PipelineColumn<string>>(
  columns: C[],
  columnId: string,
): C | null {
  const i = columns.findIndex((c) => c.id === columnId);
  return i >= 0 ? (columns[i + 1] ?? null) : (columns[0] ?? null);
}

// ---------------------------------------------------------------------------
// Activity: milestones reached
// ---------------------------------------------------------------------------

/** A person reaching a milestone for the first time. */
export interface Reach<B extends string = MilestoneCode> {
  personId: string;
  ownerId: string;
  milestone: B;
  at: string;
  /** Local "YYYY-MM-DD" of `at`. */
  day: string;
}

/** Local calendar day of an ISO timestamp. */
export const dayOf = (iso: string): string => localDate(parseDate(iso));

/** ISO timestamp for local noon on a "YYYY-MM-DD" day. */
export function localNoon(day: string): string {
  const d = parseDate(day);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

/**
 * First time each person reached each milestone. Moving forward past a
 * milestone (Contact made straight to First plan) reaches the ones in
 * between on the same date; moving back and forward again never counts
 * twice, so the board and the Log sheet can't double count.
 */
export function reachesOf<B extends string = MilestoneCode>(
  moves: readonly MoveLike[],
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): Reach<B>[] {
  const sorted = [...moves].sort((a, b) => a.movedAt.localeCompare(b.movedAt));
  const best = new Map<string, number>();
  const out: Reach<B>[] = [];
  for (const m of sorted) {
    // Start and outcome columns (index -1) reach nothing.
    const idx = milestones.indexOf(m.milestone as B);
    const prev = best.get(m.personId) ?? -1;
    if (idx <= prev) continue;
    const day = dayOf(m.movedAt);
    for (let k = prev + 1; k <= idx; k++) {
      out.push({
        personId: m.personId,
        ownerId: m.ownerId,
        milestone: milestones[k],
        at: m.movedAt,
        day,
      });
    }
    best.set(m.personId, idx);
  }
  return out;
}

/** What reachesOf needs of a move (recruiting and customer moves both fit). */
export interface MoveLike {
  /** Whose card: a prospect's person id, or a list entry id on the customer board. */
  personId: string;
  ownerId: string;
  milestone: string;
  movedAt: string;
}

export type MilestoneCounts<B extends string = MilestoneCode> = Record<B, number>;
const zero = <B extends string = MilestoneCode>(
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): MilestoneCounts<B> => Object.fromEntries(milestones.map((m) => [m, 0])) as MilestoneCounts<B>;

/** Milestones reached between two days (inclusive) by these owners' prospects. */
export function countReaches<B extends string = MilestoneCode>(
  reaches: Reach<B>[],
  owners: ReadonlySet<string> | null,
  from: string,
  to: string,
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): MilestoneCounts<B> {
  const out = zero(milestones);
  for (const r of reaches) {
    if (r.day < from || r.day > to) continue;
    if (owners && !owners.has(r.ownerId)) continue;
    out[r.milestone]++;
  }
  return out;
}

/** The same counts per owner (only the owners listed). */
export function countReachesByOwner<B extends string = MilestoneCode>(
  reaches: Reach<B>[],
  owners: string[],
  from: string,
  to: string,
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): Map<string, MilestoneCounts<B>> {
  const out = new Map(owners.map((o) => [o, zero(milestones)]));
  for (const r of reaches) {
    if (r.day < from || r.day > to) continue;
    const c = out.get(r.ownerId);
    if (c) c[r.milestone]++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

/** "YYYY-MM" of a day. */
export const monthOf = (day: string): string => day.slice(0, 7);

export function monthBounds(key: string): { from: string; to: string } {
  const d = parseDate(`${key}-01`);
  return { from: localDate(startOfMonth(d)), to: localDate(endOfMonth(d)) };
}

export const shiftMonth = (key: string, n: number): string =>
  format(addMonths(parseDate(`${key}-01`), n), "yyyy-MM");

export const monthName = (key: string, style: "short" | "long" = "long"): string =>
  format(parseDate(`${key}-01`), style === "short" ? "MMM" : "MMMM");

/**
 * The period a month's activity is compared with. Now: the whole previous
 * month, also while the current month is still running (as the design shows,
 * "62 · −13% vs Sep"). Kept on its own so it can switch to "the same days of
 * last month" in one place.
 */
export function comparisonPeriod(key: string, today: string): { from: string; to: string } {
  void today;
  return monthBounds(shiftMonth(key, -1));
}

export interface MonthActivity<B extends string = MilestoneCode> {
  counts: MilestoneCounts<B>;
  /** The whole previous month. */
  previous: MilestoneCounts<B>;
  /** True when `key` is the current month (counts so far). */
  partial: boolean;
}

/**
 * One month's milestone activity and the whole previous month's (the
 * current month counts so far, as the design shows: "62 · −13% vs Sep").
 */
export function monthActivity<B extends string = MilestoneCode>(
  reaches: Reach<B>[],
  owners: ReadonlySet<string> | null,
  key: string,
  today: string,
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): MonthActivity<B> {
  const { from, to } = monthBounds(key);
  const partial = monthOf(today) === key;
  const prev = comparisonPeriod(key, today);
  return {
    counts: countReaches(reaches, owners, from, partial ? today : to, milestones),
    previous: countReaches(reaches, owners, prev.from, prev.to, milestones),
    partial,
  };
}

/** `n` months of one milestone ending with `endKey`, oldest first. */
export function monthlySeries<B extends string = MilestoneCode>(
  reaches: Reach<B>[],
  owners: ReadonlySet<string> | null,
  milestone: B,
  endKey: string,
  n = 6,
  milestones: readonly B[] = MILESTONES as unknown as readonly B[],
): { key: string; count: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const key = shiftMonth(endKey, i - n + 1);
    const { from, to } = monthBounds(key);
    return { key, count: countReaches(reaches, owners, from, to, milestones)[milestone] };
  });
}

/** Percent change, or null when there is nothing to compare with. */
export function percentChange(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return Math.round(((now - before) / before) * 100);
}

export interface GoalPace {
  remaining: number;
  /** Days left in the month, today included. */
  daysLeft: number;
  /** Needed per day to make it. */
  perDay: number;
  reached: boolean;
}

export function goalPace(count: number, goal: number, today: string): GoalPace {
  const end = endOfMonth(parseDate(today));
  const daysLeft = differenceInCalendarDays(end, parseDate(today)) + 1;
  const remaining = Math.max(0, goal - count);
  return { remaining, daysLeft, perDay: remaining / daysLeft, reached: count >= goal };
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/** Tone of a rate against its target: at/above good, 1–4 points below warn, 5+ bad. */
export function rateTone(pct: number, target: number): RateTone {
  const gap = pct - target;
  if (gap >= 0) return "good";
  if (gap > -5) return "warn";
  return "bad";
}

export interface TransitionStat {
  key: TransitionKey;
  from: MilestoneCode;
  to: MilestoneCode;
  fromCount: number;
  toCount: number;
  /** Whole percent, or null when fewer than MIN_SAMPLE people reached `from`. */
  pct: number | null;
  target: number;
  tone: RateTone | null;
  /** Points against target (negative = below), null without a rate. */
  gap: number | null;
  /** People who reached `from` but not `to` in the period (never negative). */
  lost: number;
}

/**
 * Milestone-to-milestone rates over a period: of the people who reached one
 * milestone in the period, how many reached the next one in it (`to` / `from`).
 */
export function transitionStats(
  counts: MilestoneCounts,
  targets: ConversionTargets,
  minSample = MIN_SAMPLE,
): TransitionStat[] {
  return TRANSITIONS.map(({ key, from, to }) => {
    const a = counts[from];
    const b = counts[to];
    const target = targets[key];
    const pct = a >= minSample ? Math.min(100, Math.round((b / a) * 100)) : null;
    return {
      key,
      from,
      to,
      fromCount: a,
      toCount: b,
      pct,
      target,
      tone: pct === null ? null : rateTone(pct, target),
      gap: pct === null ? null : pct - target,
      lost: Math.max(0, a - b),
    };
  });
}

/** The transition furthest below its target, or null when none is below. */
export function biggestGap(stats: TransitionStat[]): TransitionStat | null {
  let worst: TransitionStat | null = null;
  for (const s of stats) {
    if (s.gap === null || s.gap >= 0) continue;
    if (!worst || s.gap < (worst.gap ?? 0)) worst = s;
  }
  return worst;
}

export interface BandBreakdown {
  band: StepBand;
  /** People who reached the band's milestone in the period. */
  cohort: number;
  /** Each column of the band, with how many of the cohort got that far (or further). */
  items: { column: PipelineColumn; count: number }[];
  next: { milestone: MilestoneCode; count: number };
  /** The biggest drop inside the band, including into the next milestone. */
  worst: { column: PipelineColumn; stalled: number; of: number } | null;
}

/**
 * "Inside your steps": of the people who reached `band`'s milestone in the
 * period (and belong to `owners`), how far each got through the band's
 * columns on this board, ever (a step that isn't on this board counts as its
 * milestone).
 */
export function bandBreakdown(
  moves: PipelineMove[],
  reaches: Reach[],
  columns: PipelineColumn[],
  owners: ReadonlySet<string> | null,
  band: StepBand,
  from: string,
  to: string,
): BandBreakdown {
  const ids = new Set(columns.map((c) => c.id));
  // "Not contacted yet" and the outcomes are not progress through a band.
  const pos = new Map(columns.flatMap((c, i) => (c.kind === "fixed" ? [] : [[c.id, i] as const])));
  const cohort = new Set(
    reaches
      .filter(
        (r) =>
          r.milestone === band &&
          r.day >= from &&
          r.day <= to &&
          (!owners || owners.has(r.ownerId)),
      )
      .map((r) => r.personId),
  );
  const maxPos = new Map<string, number>();
  for (const m of moves) {
    if (!cohort.has(m.personId)) continue;
    const p = pos.get(resolveColumn(m.to, m.milestone, ids)) ?? -1;
    if (p > (maxPos.get(m.personId) ?? -1)) maxPos.set(m.personId, p);
  }
  const reachedAt = (i: number) => {
    let n = 0;
    for (const p of maxPos.values()) if (p >= i) n++;
    return n;
  };
  const bandCols = columns.filter((c) => c.band === band);
  const items = bandCols.map((column) => ({ column, count: reachedAt(pos.get(column.id)!) }));
  const nextM = nextMilestone(band)!;
  const next = { milestone: nextM, count: reachedAt(pos.get(nextM)!) };
  let worst: BandBreakdown["worst"] = null;
  items.forEach((it, i) => {
    const after = i + 1 < items.length ? items[i + 1].count : next.count;
    const stalled = it.count - after;
    if (stalled > 0 && (!worst || stalled > worst.stalled)) {
      worst = { column: it.column, stalled, of: it.count };
    }
  });
  return { band, cohort: cohort.size, items, next, worst };
}

/** A plain coaching tip for the biggest gap. */
export function gapTip(gap: TransitionStat, stall: BandBreakdown | undefined): string {
  const at = stall?.worst && stall.worst.column.kind === "step" ? stall.worst.column.label : null;
  switch (gap.key) {
    case "contactToMeeting":
      return at
        ? `Most contacts never get to a first meeting, and most of them stop at ${at}. Set the meeting date while you're still talking.`
        : "Most contacts never get to a first meeting. Set the meeting date while you're still talking.";
    case "meetingToPlan":
      return at
        ? `People stall after the first meeting, mostly at ${at}. Book the plan before you leave the first meeting.`
        : "People stall after the first meeting. Book the plan before you leave the first meeting.";
    case "planToRegistered":
      return at
        ? `Most people stall at ${at}, right after the plan. Booking the next step before leaving the first plan would close much of this gap.`
        : "People stall after the plan. Booking the next step before leaving the first plan would close much of this gap.";
  }
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/**
 * Prospects hidden from every reminder: those whose card is in "Do not
 * contact" (and still on the board).
 */
export function prospectDoNotContactIds(cards: PipelineCard[]): Set<string> {
  return new Set(
    cards.filter((c) => c.column === DO_NOT_CONTACT && !c.droppedAt).map((c) => c.personId),
  );
}

/** True for people who belong on the board (business path, prospect). */
export const isPipelineProspect = (p: CrmPerson): boolean => p.bizClass === "prospect";

/**
 * A prospect with no card yet (added from the People page or the mind map)
 * sits in Contact made from the day they were added.
 */
export function implicitCard(p: CrmPerson): PipelineCard {
  const at = p.joinedDate
    ? localNoon(p.joinedDate)
    : (p.lastUpdatedAt ?? new Date(0).toISOString());
  return {
    personId: p.id,
    column: "contact",
    enteredAt: at,
    nextColumn: null,
    nextStepDate: null,
    nextStepTime: null,
    note: null,
    hot: false,
    source: null,
    droppedAt: null,
    updatedAt: at,
  };
}

/** The card for each prospect still on the board (dropped cards left out). */
export function boardCards(
  prospects: CrmPerson[],
  cards: PipelineCard[],
): { person: CrmPerson; card: PipelineCard }[] {
  const byId = new Map(cards.map((c) => [c.personId, c]));
  const out: { person: CrmPerson; card: PipelineCard }[] = [];
  for (const person of prospects) {
    if (!isPipelineProspect(person)) continue;
    const card = byId.get(person.id) ?? implicitCard(person);
    if (card.droppedAt) continue;
    out.push({ person, card });
  }
  return out;
}

/** Whole days a card has been in its column. */
export const daysInColumn = (enteredAt: string, today: string): number =>
  Math.max(0, differenceInCalendarDays(parseDate(today), parseDate(dayOf(enteredAt))));

/** No movement and no contact for STALE_DAYS days or more. */
export function isStale(
  enteredAt: string,
  lastContact: string | undefined,
  today: string,
  days = STALE_DAYS,
): boolean {
  const moved = dayOf(enteredAt);
  const last = lastContact && lastContact > moved ? lastContact : moved;
  return differenceInCalendarDays(parseDate(today), parseDate(last)) >= days;
}

// ---------------------------------------------------------------------------
// Steps editor
// ---------------------------------------------------------------------------

export const canEditStep = (step: PipelineStep<string>, personId: string): boolean =>
  step.ownerId === personId;

/** Inherited steps (an upline's) can be hidden; your own you delete instead. */
export const canHideStep = (
  step: PipelineStep<string>,
  chain: string[],
  personId: string,
): boolean => step.ownerId !== personId && chain.includes(step.ownerId);

export const MAX_STEP_LABEL = 24;

/** Why a step name can't be used, or null when it's fine. */
export function stepLabelError(
  label: string,
  bandLabels: string[],
  current?: string,
  reserved: readonly string[] = RECRUITING_BOARD.reserved,
): string | null {
  const t = label.trim();
  if (!t) return "Give the step a name.";
  if (t.length > MAX_STEP_LABEL) return `Keep it to ${MAX_STEP_LABEL} characters.`;
  const lower = t.toLowerCase();
  if (reserved.some((m) => m.toLowerCase() === lower)) return "That's a milestone's name.";
  if (bandLabels.some((l) => l.toLowerCase() === lower && l !== current))
    return "There's already a step with that name here.";
  return null;
}

/** Position for a new step at the end of the owner's steps in a band. */
export function nextPosition(
  steps: readonly PipelineStep<string>[],
  ownerId: string,
  band: string,
): number {
  const own = steps.filter((s) => s.ownerId === ownerId && s.band === band);
  return own.length ? Math.max(...own.map((s) => s.position)) + 1 : 0;
}

/**
 * Move one of the owner's steps up (-1) or down (+1) among their own steps in
 * its band. Returns the owner's steps in that band with positions renumbered
 * 0..n-1, or [] when it can't move.
 */
export function reorderOwnSteps<S extends PipelineStep<string>>(
  steps: readonly S[],
  ownerId: string,
  stepId: string,
  dir: -1 | 1,
): S[] {
  const step = steps.find((s) => s.id === stepId);
  if (!step || step.ownerId !== ownerId) return [];
  const own = steps
    .filter((s) => s.ownerId === ownerId && s.band === step.band)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
  const i = own.findIndex((s) => s.id === stepId);
  const j = i + dir;
  if (j < 0 || j >= own.length) return [];
  [own[i], own[j]] = [own[j], own[i]];
  return own.map((s, k) => ({ ...s, position: k }));
}

// ---------------------------------------------------------------------------
// Team settings (goal and targets), inherited down the chain
// ---------------------------------------------------------------------------

export interface EffectiveSettings {
  mg1Goal: number;
  /** Who set the goal (null = the app default). */
  goalFrom: string | null;
  targets: ConversionTargets;
  targetsFrom: string | null;
}

/** The nearest setting up the chain (the person's own first), else the defaults. */
export function effectiveSettings(chain: string[], settings: TeamSetting[]): EffectiveSettings {
  const byId = new Map(settings.map((s) => [s.personId, s]));
  let mg1Goal = DEFAULT_MG1_GOAL;
  let goalFrom: string | null = null;
  let targets = DEFAULT_TARGETS;
  let targetsFrom: string | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = byId.get(chain[i]);
    if (!s) continue;
    if (goalFrom === null && s.mg1Goal !== null) {
      mg1Goal = s.mg1Goal;
      goalFrom = s.personId;
    }
    if (targetsFrom === null && s.targets !== null) {
      targets = s.targets;
      targetsFrom = s.personId;
    }
  }
  return { mg1Goal, goalFrom, targets, targetsFrom };
}

export const MAX_GOAL = 9999;

/** A whole percent between 1 and 100. */
export const validTarget = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 100;
export const validGoal = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_GOAL;

// ---------------------------------------------------------------------------
// Who sees whose per-person numbers
// ---------------------------------------------------------------------------

/**
 * Per-person conversions: yourself and your downline; anyone else only if
 * they shared with you. Crosslines and uplines never otherwise. Candidates
 * have no pipeline.
 */
export function canSeeStatsOf(
  people: CrmPerson[],
  viewer: Viewer,
  targetId: string,
  shares: StatShare[],
): boolean {
  if (!viewer || viewer.role === "candidate") return false;
  if (targetId === viewer.personId) return true;
  if (downlineIds(people, viewer.personId).has(targetId)) return true;
  return shares.some((s) => s.ownerId === targetId && s.viewerId === viewer.personId);
}

/** Ids of the people who shared their numbers with the viewer. */
export const sharedWith = (shares: StatShare[], viewerId: string): string[] =>
  shares.filter((s) => s.viewerId === viewerId).map((s) => s.ownerId);

export type RequestCheck =
  { ok: true } | { ok: false; reason: "candidate" | "self" | "already" | "pending" };

/** Can the viewer ask `ownerId` to see their numbers? */
export function canRequestStats(
  people: CrmPerson[],
  viewer: Viewer,
  ownerId: string,
  shares: StatShare[],
  requests: StatRequest[],
): RequestCheck {
  if (!viewer || viewer.role === "candidate") return { ok: false, reason: "candidate" };
  if (ownerId === viewer.personId) return { ok: false, reason: "self" };
  if (canSeeStatsOf(people, viewer, ownerId, shares)) return { ok: false, reason: "already" };
  if (
    requests.some(
      (r) => r.status === "pending" && r.requesterId === viewer.personId && r.ownerId === ownerId,
    )
  )
    return { ok: false, reason: "pending" };
  return { ok: true };
}

/**
 * People who already see `ownerId`'s numbers without a share: everyone above
 * them in the sponsor chain (uplines never need to ask).
 */
export function automaticViewers(
  people: CrmPerson[],
  ownerId: string,
  uplines: string[] = [],
): string[] {
  return chainOf(people, ownerId, uplines).slice(0, -1);
}

/** Can `ownerId` share with `viewerId`? (Not themselves, not twice, not an upline.) */
export function canShareWith(
  people: CrmPerson[],
  ownerId: string,
  viewerId: string,
  shares: StatShare[],
  uplines: string[] = [],
): boolean {
  if (ownerId === viewerId) return false;
  if (automaticViewers(people, ownerId, uplines).includes(viewerId)) return false;
  return !shares.some((s) => s.ownerId === ownerId && s.viewerId === viewerId);
}
