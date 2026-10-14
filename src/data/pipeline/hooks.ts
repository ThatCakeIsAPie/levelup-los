/**
 * Pipeline hooks (re-exported from "@/data"). Visibility rules already apply:
 * cards are visible prospects only, activity and conversions count the moves
 * of prospects owned by people in the chosen scope (always inside the
 * viewer's own team), and per-person rows follow canSeeStatsOf.
 */
import { useEffect, useMemo, useState } from "react";
import { IS_SUPABASE } from "@/lib/config";
import {
  usePeopleStore,
  effectiveBizClass,
  type BizClass,
  type CrmPerson,
} from "@/stores/peopleStore";
import { localDate } from "@/lib/dates";
import { subDays } from "date-fns";
import { downlineIds } from "../access";
import { useLastContactMap } from "../crm";
import { useVisibleIds } from "../people";
import { useViewer } from "../session";
import { useChatPeople, useWorkspaceMembers } from "../chat/hooks";
import { useRemoteStore } from "../remote/extras";
import { fetchPipelineCounts } from "../remote";
import { usePipelineStore } from "./store";
import {
  automaticViewers,
  bandBreakdown,
  biggestGap,
  boardCards,
  canSeeStatsOf,
  chainOf,
  chainSteps,
  countReaches,
  countReachesByOwner,
  daysInColumn,
  dayOf,
  effectiveSettings,
  gapTip,
  goalPace,
  isMilestoneBand,
  isStale,
  monthActivity,
  monthBounds,
  monthOf,
  monthlySeries,
  reachesOf,
  recruitingBand,
  shiftMonth,
  resolveColumn,
  transitionStats,
  type BandBreakdown,
  type ChainStep,
  type GoalPace,
  type MilestoneCounts,
  type Reach,
  type TransitionStat,
} from "./rules";
import {
  RECRUITING_BOARD,
  STEP_BANDS,
  type ConversionTargets,
  type MilestoneCode,
  type PipelineCard,
  type PipelineColumn,
  type PipelineMove,
  type PipelineScope,
  type RecruitingBand,
  type StatRequest,
  type StatShare,
  type StepBand,
} from "./types";
import { columnsFor } from "./rules";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const NO_UPLINES: string[] = [];
let uplineCache: { chain: unknown; ids: string[] } | null = null;
/** Real accounts: the signed-in person's sponsor line (root first); [] in the demo. */
function useUplines(): string[] {
  const chain = useRemoteStore((s) => s.chain);
  if (!chain.length) return NO_UPLINES;
  if (uplineCache?.chain !== chain) uplineCache = { chain, ids: chain.map((c) => c.personId) };
  return uplineCache.ids;
}

let reachCache: { moves: PipelineMove[]; reaches: Reach[] } | null = null;
/** Milestones reached, computed once per moves table. */
function reachesFor(moves: PipelineMove[]): Reach[] {
  if (reachCache?.moves !== moves) reachCache = { moves, reaches: reachesOf(moves) };
  return reachCache.reaches;
}

const firstName = (name: string): string => name.split(" ")[0] ?? name;

/** Real accounts: the signed-in person's sponsor line (root first); [] in the demo. */
export const usePipelineUplines = useUplines;

/** Who may use the pipeline: everyone but candidates. */
export function usePipelineAccess(): { enabled: boolean; personId: string | null } {
  const viewer = useViewer();
  return {
    enabled: !!viewer && viewer.role !== "candidate",
    personId: viewer?.personId ?? null,
  };
}

export interface ScopeOption {
  value: PipelineScope;
  label: string;
  /** The leader whose team (and steps) the scope shows. */
  leaderId: string;
  /** People whose prospects count. */
  owners: Set<string>;
}

/** The scopes the viewer can pick: whole team, own prospects, each downline leader's team. */
export function usePipelineScopes(): ScopeOption[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate") return [];
    const me = viewer.personId;
    const within = (root: string) => {
      const out = new Set<string>();
      for (const id of downlineIds(people, root)) if (ids.has(id)) out.add(id);
      return out;
    };
    const team = within(me);
    const out: ScopeOption[] = [
      { value: "team", label: "Whole team", leaderId: me, owners: team },
      { value: "mine", label: "My prospects", leaderId: me, owners: new Set([me]) },
    ];
    const leaders = people
      .filter(
        (p) =>
          p.id !== me &&
          ids.has(p.id) &&
          (p.bizClass === "apprentice" || p.bizClass === "ibo") &&
          people.some((c) => c.sponsorId === p.id && c.bizClass !== "customer"),
      )
      .map((p) => ({ p, owners: within(p.id) }))
      .filter((l) => l.owners.size > 1)
      .sort((a, b) => b.owners.size - a.owners.size || a.p.name.localeCompare(b.p.name));
    for (const { p, owners } of leaders) {
      out.push({ value: `leader:${p.id}`, label: `${p.name}'s team`, leaderId: p.id, owners });
    }
    return out;
  }, [people, ids, viewer]);
}

/** The chosen scope, falling back to the whole team when it isn't available. */
export function useScope(scope: PipelineScope): ScopeOption | undefined {
  const scopes = usePipelineScopes();
  return scopes.find((s) => s.value === scope) ?? scopes[0];
}

/** The board's columns for a person (their chain's steps, minus hidden ones). */
export function usePipelineColumns(personId: string | undefined): PipelineColumn[] {
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const steps = usePipelineStore((s) => s.steps);
  const hides = usePipelineStore((s) => s.hides);
  const chatPeople = useChatPeople();
  const viewer = useViewer();
  return useMemo(() => {
    if (!personId) return [];
    return columnsFor(chainOf(people, personId, uplines), steps, hides).map((c) =>
      c.ownerId
        ? {
            ...c,
            ownerName:
              c.ownerId === viewer?.personId
                ? "You"
                : firstName(chatPeople.get(c.ownerId)?.name ?? "A leader"),
          }
        : c,
    );
  }, [people, personId, steps, hides, chatPeople, viewer, uplines]);
}

/** "Maria" or "You". */
function useNamer(): (id: string | undefined) => string {
  const chatPeople = useChatPeople();
  const viewer = useViewer();
  return useMemo(
    () => (id) => {
      if (!id) return "";
      if (id === viewer?.personId) return "You";
      return chatPeople.get(id)?.name ?? "Someone";
    },
    [chatPeople, viewer],
  );
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

export interface BoardCard {
  /** The card's id: a prospect's person id (on the customer board, a list entry id). */
  personId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerStage: BizClass | undefined;
  /** Column on this board. */
  column: string;
  /** The card's own column when this board shows it under its milestone. */
  elsewhere: { label: string; ownerName: string } | null;
  days: number;
  stale: boolean;
  hot: boolean;
  nextStep: string | null;
  nextStepDate: string | null;
  source: string | null;
  enteredAt: string;
  /** Customer board: a warm name on the list. */
  warm?: boolean;
  /** Customer board: still on the list (not contacted yet), so no age. */
  listed?: boolean;
  /** An outcome (Not interested, Do not contact), shown dimmed. */
  dim?: boolean;
}

export interface BoardColumn<B extends string = RecruitingBand> {
  column: PipelineColumn<B>;
  cards: BoardCard[];
  /** Milestones: reached in the chosen month. */
  reached: number | null;
}

export interface BoardBand<B extends string = RecruitingBand> {
  milestone: B;
  columns: BoardColumn<B>[];
  /** Cards in the band now (Registered: registered in the month). */
  count: number;
}

export interface RegisteredCard {
  personId: string;
  name: string;
  ownerId: string;
  ownerName: string;
  ownerStage: BizClass | undefined;
  day: string;
}

export interface PipelineBoard<B extends string = RecruitingBand> {
  columns: PipelineColumn<B>[];
  bands: BoardBand<B>[];
  /** Recruiting: the month's registrations (the customer board has none). */
  registered: { cards: RegisteredCard[]; total: number };
  inProgress: number;
}

/** The board for a scope: current cards, plus the month's registrations. */
export function usePipelineBoard(scope: PipelineScope, month: string): PipelineBoard | null {
  const opt = useScope(scope);
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const data = usePipelineStore();
  const lastContact = useLastContactMap();
  const columns = usePipelineColumns(opt?.leaderId);
  const today = localDate();
  return useMemo(() => {
    if (!opt) return null;
    const byId = new Map(people.map((p) => [p.id, p]));
    const colIds = new Set(columns.map((c) => c.id));
    const stepById = new Map(data.steps.map((s) => [s.id, s]));
    const owner = (p: CrmPerson) => (p.sponsorId ? byId.get(p.sponsorId) : undefined);
    const prospects = people.filter(
      (p) => ids.has(p.id) && p.sponsorId && opt.owners.has(p.sponsorId),
    );
    const byColumn = new Map<string, BoardCard[]>(columns.map((c) => [c.id, []]));
    for (const { person, card } of boardCards(prospects, data.cards)) {
      const step = stepById.get(card.column);
      const band = recruitingBand(card.column, data.steps);
      const col = resolveColumn(card.column, band, colIds);
      const o = owner(person);
      byColumn.get(col)?.push({
        personId: person.id,
        name: person.name,
        ownerId: person.sponsorId!,
        ownerName: o ? firstName(o.name) : "",
        ownerStage: o ? effectiveBizClass(o) : undefined,
        column: col,
        elsewhere:
          col !== card.column && step
            ? { label: step.label, ownerName: firstName(byId.get(step.ownerId)?.name ?? "") }
            : null,
        days: daysInColumn(card.enteredAt, today),
        stale: isMilestoneBand(band) && isStale(card.enteredAt, lastContact.get(person.id), today),
        hot: card.hot,
        dim: band === "out",
        nextStep: card.nextStep,
        nextStepDate: card.nextStepDate,
        source: card.source,
        enteredAt: card.enteredAt,
      });
    }
    for (const list of byColumn.values()) {
      list.sort(
        (a, b) => Number(b.hot) - Number(a.hot) || a.days - b.days || a.name.localeCompare(b.name),
      );
    }
    const reaches = reachesFor(data.moves);
    const { from, to } = monthBounds(month);
    const reached = countReaches(reaches, opt.owners, from, to);

    // Registered in the month: people still in the CRM get a card.
    const regReaches = reaches.filter(
      (r) =>
        r.milestone === "registered" && r.day >= from && r.day <= to && opt.owners.has(r.ownerId),
    );
    const regCards: RegisteredCard[] = [];
    for (const r of regReaches) {
      const p = byId.get(r.personId);
      if (!p || !ids.has(p.id)) continue;
      const o = byId.get(r.ownerId);
      regCards.push({
        personId: p.id,
        name: p.name,
        ownerId: r.ownerId,
        ownerName: o ? firstName(o.name) : "",
        ownerStage: o ? effectiveBizClass(o) : undefined,
        day: r.day,
      });
    }
    regCards.sort((a, b) => b.day.localeCompare(a.day));

    let inProgress = 0;
    const bands: BoardBand[] = RECRUITING_BOARD.bands.map(({ id: m }) => {
      const cols = columns
        .filter((c) => c.band === m)
        .map((column) => ({
          column,
          cards: m === "registered" ? [] : (byColumn.get(column.id) ?? []),
          reached: column.kind === "milestone" && isMilestoneBand(m) ? reached[m] : null,
        }));
      const count =
        m === "registered" ? regReaches.length : cols.reduce((s, c) => s + c.cards.length, 0);
      if (m !== "registered" && m !== "out") inProgress += count;
      return { milestone: m, columns: cols, count };
    });
    return {
      columns,
      bands,
      registered: { cards: regCards, total: regReaches.length },
      inProgress,
    };
  }, [opt, people, ids, data, lastContact, columns, month, today]);
}

// ---------------------------------------------------------------------------
// Activity (milestones reached) and the first-meeting goal
// ---------------------------------------------------------------------------

export interface PipelineActivity {
  counts: MilestoneCounts;
  previous: MilestoneCounts;
  partial: boolean;
  series: { key: string; count: number }[];
  /** null for "My prospects" (the goal is a team goal). */
  goal: number | null;
  /** Who set the goal ("You", "Maria Reyes"), null for the default. */
  goalFrom: string | null;
  /** Current month only. */
  pace: GoalPace | null;
}

export function usePipelineActivity(scope: PipelineScope, month: string): PipelineActivity | null {
  const opt = useScope(scope);
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const moves = usePipelineStore((s) => s.moves);
  const settings = usePipelineStore((s) => s.settings);
  const name = useNamer();
  const today = localDate();
  return useMemo(() => {
    if (!opt) return null;
    const reaches = reachesFor(moves);
    const act = monthActivity(reaches, opt.owners, month, today);
    const eff = effectiveSettings(chainOf(people, opt.leaderId, uplines), settings);
    const goal = scope === "mine" ? null : eff.mg1Goal;
    return {
      ...act,
      series: monthlySeries(reaches, opt.owners, "first_meeting", month, 6),
      goal,
      goalFrom: eff.goalFrom ? name(eff.goalFrom) : null,
      pace:
        goal !== null && monthOf(today) === month
          ? goalPace(act.counts.first_meeting, goal, today)
          : null,
    };
  }, [opt, people, moves, settings, name, month, today, scope, uplines]);
}

/** Months that have activity (oldest first, up to 12), always including this one. */
export function usePipelineMonths(): string[] {
  const moves = usePipelineStore((s) => s.moves);
  const today = localDate();
  return useMemo(() => {
    const cur = monthOf(today);
    let first = cur;
    for (const m of moves) {
      const k = monthOf(dayOf(m.movedAt));
      if (k < first) first = k;
    }
    const out: string[] = [];
    for (let k = cur; out.length < 12 && k >= first; k = shiftMonth(k, -1)) out.unshift(k);
    return out;
  }, [moves, today]);
}

/** Numbers for the My business tile: this month's first meetings and the board by band. */
export function usePipelineSummary(): {
  mg1: number;
  goal: number;
  bands: Record<RecruitingBand, number>;
} | null {
  const month = monthOf(localDate());
  const board = usePipelineBoard("team", month);
  const act = usePipelineActivity("team", month);
  return useMemo(() => {
    if (!board || !act) return null;
    const bands = Object.fromEntries(board.bands.map((b) => [b.milestone, b.count])) as Record<
      RecruitingBand,
      number
    >;
    return { mg1: act.counts.first_meeting, goal: act.goal ?? 0, bands };
  }, [board, act]);
}

// ---------------------------------------------------------------------------
// Team settings
// ---------------------------------------------------------------------------

export interface TeamSettingsView {
  /** The leader whose settings these are. */
  personId: string;
  mg1Goal: number;
  goalFrom: string | null;
  goalFromId: string | null;
  targets: ConversionTargets;
  targetsFrom: string | null;
  targetsFromId: string | null;
  /** The viewer's own team: they may change it. */
  canEdit: boolean;
  /** What the viewer would inherit if they cleared their own values. */
  inherited: { mg1Goal: number; targets: ConversionTargets; from: string | null };
}

export function useTeamSettings(scope: PipelineScope): TeamSettingsView | null {
  const opt = useScope(scope);
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const settings = usePipelineStore((s) => s.settings);
  const viewer = useViewer();
  const name = useNamer();
  return useMemo(() => {
    if (!opt || !viewer) return null;
    const chain = chainOf(people, opt.leaderId, uplines);
    const eff = effectiveSettings(chain, settings);
    const up = effectiveSettings(chain.slice(0, -1), settings);
    return {
      personId: opt.leaderId,
      mg1Goal: eff.mg1Goal,
      goalFrom: eff.goalFrom ? name(eff.goalFrom) : null,
      goalFromId: eff.goalFrom,
      targets: eff.targets,
      targetsFrom: eff.targetsFrom ? name(eff.targetsFrom) : null,
      targetsFromId: eff.targetsFrom,
      canEdit: opt.leaderId === viewer.personId && viewer.role !== "candidate",
      inherited: {
        mg1Goal: up.mg1Goal,
        targets: up.targets,
        from: up.goalFrom ? name(up.goalFrom) : null,
      },
    };
  }, [opt, people, settings, viewer, name, uplines]);
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export interface HotspotRow {
  personId: string;
  name: string;
  stage: BizClass | undefined;
  counts: MilestoneCounts;
  stats: TransitionStat[];
  /** Shared with the viewer (outside their team). */
  shared: boolean;
}

export interface PipelineConversions {
  from: string;
  to: string;
  counts: MilestoneCounts;
  stats: TransitionStat[];
  gap: TransitionStat | null;
  tip: string | null;
  breakdowns: BandBreakdown[];
  targets: ConversionTargets;
  rows: HotspotRow[];
  sharedRows: HotspotRow[];
}

/**
 * Real accounts: milestone totals of people who shared their numbers with you
 * (their prospects and moves aren't loaded; pipeline_person_counts() returns
 * totals only). Null while loading; the demo computes them from its moves.
 */
function useSharedCounts(
  ownerIds: string[],
  from: string,
  to: string,
): Map<string, MilestoneCounts> | null {
  const key = `${ownerIds.join(",")}|${from}|${to}`;
  const [state, setState] = useState<{ key: string; counts: Map<string, MilestoneCounts> } | null>(
    null,
  );
  useEffect(() => {
    if (!IS_SUPABASE || !ownerIds.length) return;
    let alive = true;
    fetchPipelineCounts(ownerIds, from, to)
      .then((c) => {
        if (alive && c) setState({ key, counts: new Map(Object.entries(c)) });
      })
      .catch((e) => console.warn("[pipeline] shared counts", e));
    return () => {
      alive = false;
    };
    // `key` covers ownerIds, from and to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state?.key === key ? state.counts : null;
}

export const PERIODS = [30, 90, 180, 365] as const;
export type PeriodDays = (typeof PERIODS)[number];

export function usePipelineConversions(
  scope: PipelineScope,
  periodDays: PeriodDays,
): PipelineConversions | null {
  const opt = useScope(scope);
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const moves = usePipelineStore((s) => s.moves);
  const settings = usePipelineStore((s) => s.settings);
  const shares = usePipelineStore((s) => s.shares);
  const viewer = useViewer();
  const columns = usePipelineColumns(opt?.leaderId);
  const chatPeople = useChatPeople();
  const today = localDate();
  const from = localDate(subDays(new Date(), periodDays - 1));
  const to = today;
  // People outside the scope who shared their numbers with you.
  const sharers = useMemo(
    () =>
      viewer && opt
        ? shares
            .filter((s) => s.viewerId === viewer.personId && !opt.owners.has(s.ownerId))
            .map((s) => s.ownerId)
        : [],
    [shares, viewer, opt],
  );
  const remoteShared = useSharedCounts(IS_SUPABASE ? sharers : [], from, to);
  return useMemo(() => {
    if (!opt || !viewer) return null;
    const reaches = reachesFor(moves);
    const counts = countReaches(reaches, opt.owners, from, to);
    const { targets } = effectiveSettings(chainOf(people, opt.leaderId, uplines), settings);
    const stats = transitionStats(counts, targets);
    const gap = biggestGap(stats);
    const breakdowns = STEP_BANDS.map((b) =>
      bandBreakdown(moves, reaches, columns, opt.owners, b, from, to),
    );
    const byId = new Map(people.map((p) => [p.id, p]));
    const rowFor = (id: string, c: MilestoneCounts, shared: boolean): HotspotRow => {
      const p = byId.get(id);
      const cp = chatPeople.get(id);
      return {
        personId: id,
        name: p?.name ?? cp?.name ?? "Someone",
        stage: p ? effectiveBizClass(p) : cp?.stage,
        counts: c,
        stats: transitionStats(c, targets),
        shared,
      };
    };
    const own = [...opt.owners].filter((id) => canSeeStatsOf(people, viewer, id, shares));
    const perOwner = countReachesByOwner(reaches, own, from, to);
    const rows = own
      .map((id) => rowFor(id, perOwner.get(id)!, false))
      .filter((r) => r.counts.contact > 0 || r.personId === viewer.personId)
      .sort(
        (a, b) =>
          Number(b.personId === viewer.personId) - Number(a.personId === viewer.personId) ||
          b.counts.contact - a.counts.contact,
      );
    const perSharer = IS_SUPABASE
      ? (remoteShared ?? new Map<string, MilestoneCounts>())
      : countReachesByOwner(reaches, sharers, from, to);
    const sharedRows = sharers
      .filter((id) => perSharer.has(id))
      .map((id) => rowFor(id, perSharer.get(id)!, true));
    const stall = gap ? breakdowns.find((b) => b.band === gap.from) : undefined;
    return {
      from,
      to,
      counts,
      stats,
      gap,
      tip: gap ? gapTip(gap, stall) : null,
      breakdowns,
      targets,
      rows,
      sharedRows,
    };
  }, [
    opt,
    viewer,
    from,
    to,
    moves,
    people,
    settings,
    columns,
    shares,
    sharers,
    remoteShared,
    chatPeople,
    uplines,
  ]);
}

// ---------------------------------------------------------------------------
// One prospect (profile card)
// ---------------------------------------------------------------------------

export interface ProspectPipeline {
  /** On the board now (a prospect whose card isn't dropped). */
  onBoard: boolean;
  dropped: boolean;
  card: PipelineCard | null;
  /** The card's column as the viewer's board shows it. */
  column: PipelineColumn | null;
  /** The card's own step, when the viewer's board shows it under its milestone. */
  ownStep: string | null;
  days: number;
  stale: boolean;
  history: {
    id: string;
    to: string;
    toLabel: string;
    milestone: RecruitingBand;
    at: string;
    by: string;
  }[];
  /** The viewer's board columns (for "Move to…"). */
  columns: PipelineColumn[];
}

export function useProspectPipeline(personId: string | undefined): ProspectPipeline | null {
  const viewer = useViewer();
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const data = usePipelineStore();
  const lastContact = useLastContactMap();
  const columns = usePipelineColumns(viewer?.personId);
  const name = useNamer();
  const today = localDate();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate" || !personId || !ids.has(personId)) return null;
    const person = people.find((p) => p.id === personId);
    if (!person || person.bizClass === "customer") return null;
    const moves = data.moves
      .filter((m) => m.personId === personId)
      .sort((a, b) => b.movedAt.localeCompare(a.movedAt));
    const prospect = person.bizClass === "prospect";
    if (!prospect && moves.length === 0) return null;
    const stored = data.cards.find((c) => c.personId === personId) ?? null;
    const card = prospect
      ? (boardCards([person], stored ? [stored] : [])[0]?.card ?? stored)
      : stored;
    const colIds = new Set(columns.map((c) => c.id));
    const stepById = new Map(data.steps.map((s) => [s.id, s]));
    const labelOf = (id: string, band: RecruitingBand) =>
      columns.find((c) => c.id === id)?.label ??
      stepById.get(id)?.label ??
      columns.find((c) => c.id === band)?.label ??
      id;
    let column: PipelineColumn | null = null;
    let ownStep: string | null = null;
    if (card) {
      const id = resolveColumn(card.column, recruitingBand(card.column, data.steps), colIds);
      column = columns.find((c) => c.id === id) ?? null;
      if (id !== card.column) ownStep = stepById.get(card.column)?.label ?? null;
    }
    return {
      onBoard: prospect && !!card && !card.droppedAt,
      dropped: prospect && !!card?.droppedAt,
      card,
      column,
      ownStep,
      days: card ? daysInColumn(card.enteredAt, today) : 0,
      stale:
        card && isMilestoneBand(recruitingBand(card.column, data.steps))
          ? isStale(card.enteredAt, lastContact.get(personId), today)
          : false,
      history: moves.map((m) => ({
        id: m.id,
        to: m.to,
        toLabel: labelOf(m.to, m.milestone),
        milestone: m.milestone,
        at: m.movedAt,
        by: name(m.movedBy),
      })),
      columns,
    };
  }, [viewer, personId, ids, people, data, columns, lastContact, today, name]);
}

// ---------------------------------------------------------------------------
// Steps editor
// ---------------------------------------------------------------------------

export interface StepsEditorBand {
  band: StepBand;
  steps: (ChainStep & { ownerName: string; hiddenByName: string | null; cards: number })[];
}

/** The viewer's steps per band: inherited (hide/show) and their own (edit). */
export function useStepsEditor(): StepsEditorBand[] {
  const viewer = useViewer();
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const steps = usePipelineStore((s) => s.steps);
  const hides = usePipelineStore((s) => s.hides);
  const cards = usePipelineStore((s) => s.cards);
  const name = useNamer();
  return useMemo(() => {
    if (!viewer) return [];
    const chain = chainOf(people, viewer.personId, uplines);
    const counts = new Map<string, number>();
    for (const c of cards) if (!c.droppedAt) counts.set(c.column, (counts.get(c.column) ?? 0) + 1);
    return STEP_BANDS.map((band) => ({
      band,
      steps: chainSteps(chain, steps, hides, band).map((s) => ({
        ...s,
        ownerName: s.own ? "You" : firstName(name(s.step.ownerId)),
        hiddenByName: s.hiddenBy ? name(s.hiddenBy) : null,
        cards: counts.get(s.step.id) ?? 0,
      })),
    }));
  }, [viewer, people, steps, hides, cards, name, uplines]);
}

// ---------------------------------------------------------------------------
// Sharing per-person numbers
// ---------------------------------------------------------------------------

export interface NamedPerson {
  id: string;
  name: string;
  stage: BizClass | undefined;
}

export interface StatSharing {
  /** People you shared your numbers with. */
  sharesOut: (StatShare & { person: NamedPerson })[];
  /** People who shared theirs with you. */
  sharesIn: (StatShare & { person: NamedPerson })[];
  /** Requests waiting for your answer. */
  incoming: (StatRequest & { person: NamedPerson })[];
  /** Your requests still waiting. */
  outgoing: (StatRequest & { person: NamedPerson })[];
  /** Uplines: they see your numbers without asking. */
  automatic: NamedPerson[];
  /** Who you could share with (not you, not your uplines, not already). */
  shareCandidates: NamedPerson[];
  /** Whose numbers you could ask for (crosslines and uplines you can't see yet). */
  requestCandidates: NamedPerson[];
}

export function useStatSharing(): StatSharing | null {
  const viewer = useViewer();
  const people = usePeopleStore((s) => s.people);
  const uplines = useUplines();
  const shares = usePipelineStore((s) => s.shares);
  const requests = usePipelineStore((s) => s.requests);
  const members = useWorkspaceMembers();
  const chatPeople = useChatPeople();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate") return null;
    const me = viewer.personId;
    const named = (id: string): NamedPerson => {
      const p = chatPeople.get(id);
      return { id, name: p?.name ?? "Someone", stage: p?.stage };
    };
    const auto = new Set(automaticViewers(people, me, uplines));
    const sharesOut = shares.filter((s) => s.ownerId === me);
    const sharesIn = shares.filter((s) => s.viewerId === me);
    const pendingOut = requests.filter((r) => r.requesterId === me && r.status === "pending");
    const team = downlineIds(people, me);
    const pool = members.filter((m) => m.id !== me);
    return {
      sharesOut: sharesOut.map((s) => ({ ...s, person: named(s.viewerId) })),
      sharesIn: sharesIn.map((s) => ({ ...s, person: named(s.ownerId) })),
      incoming: requests
        .filter((r) => r.ownerId === me && r.status === "pending")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r, person: named(r.requesterId) })),
      outgoing: pendingOut.map((r) => ({ ...r, person: named(r.ownerId) })),
      automatic: [...auto].map(named),
      shareCandidates: pool
        .filter((m) => !auto.has(m.id) && !sharesOut.some((s) => s.viewerId === m.id))
        .map((m) => ({ id: m.id, name: m.name, stage: m.stage })),
      requestCandidates: pool
        .filter(
          (m) =>
            !team.has(m.id) &&
            !sharesIn.some((s) => s.ownerId === m.id) &&
            !pendingOut.some((r) => r.ownerId === m.id),
        )
        .map((m) => ({ id: m.id, name: m.name, stage: m.stage })),
    };
  }, [viewer, people, shares, requests, members, chatPeople, uplines]);
}

/** Requests to and from the viewer (for the inbox rows). */
export function useStatRequests(): StatRequest[] {
  const viewer = useViewer();
  const requests = usePipelineStore((s) => s.requests);
  return useMemo(
    () =>
      viewer
        ? requests.filter((r) => r.ownerId === viewer.personId || r.requesterId === viewer.personId)
        : [],
    [viewer, requests],
  );
}

/** Requests waiting for the viewer's answer. */
export function usePendingStatRequests(): StatRequest[] {
  const viewer = useViewer();
  const requests = usePipelineStore((s) => s.requests);
  return useMemo(
    () =>
      viewer ? requests.filter((r) => r.ownerId === viewer.personId && r.status === "pending") : [],
    [viewer, requests],
  );
}

/** Stat requests waiting for the viewer's answer (for an inbox badge). */
export function usePendingStatRequestCount(): number {
  const viewer = useViewer();
  const requests = usePipelineStore((s) => s.requests);
  return useMemo(
    () =>
      viewer
        ? requests.filter((r) => r.ownerId === viewer.personId && r.status === "pending").length
        : 0,
    [viewer, requests],
  );
}

/** Can the viewer see this person's per-person numbers? */
export function useCanSeeStats(personId: string | undefined): boolean {
  const viewer = useViewer();
  const people = usePeopleStore((s) => s.people);
  const shares = usePipelineStore((s) => s.shares);
  return useMemo(
    () => !!personId && canSeeStatsOf(people, viewer, personId, shares),
    [people, viewer, personId, shares],
  );
}
