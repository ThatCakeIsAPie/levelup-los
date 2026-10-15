/**
 * Your list and the customer pipeline: hooks (re-exported from "@/data").
 * Visibility rules already apply: lists, cards and moves are the viewer's own
 * and their downline's, never a crossline's; customers stay private to their
 * owner (an upline sees the name on the list and the board, not the customer
 * record).
 */
import { useMemo } from "react";
import { subDays } from "date-fns";
import { localDate } from "@/lib/dates";
import { effectiveBizClass, usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { useVisibleIds } from "../people";
import { useMe, useViewer } from "../session";
import { useChatPeople } from "../chat/hooks";
import { useScope as usePipelineScope, usePipelineUplines } from "../pipeline/hooks";
import type { BoardBand, BoardCard, PipelineBoard } from "../pipeline/hooks";
import {
  chainOf,
  chainSteps,
  columnsFor,
  countReaches,
  countReachesByOwner,
  daysInColumn,
  monthActivity,
  monthBounds,
  monthlySeries,
  prospectDoNotContactIds,
  resolveColumn,
  type ChainStep,
  type MilestoneCounts,
  type MonthActivity,
  type Reach,
} from "../pipeline/rules";
import { MIN_SAMPLE, type PipelineColumn, type PipelineScope } from "../pipeline/types";
import { usePipelineStore } from "../pipeline/store";
import { bookingOf, bookingView } from "../pipeline/booking";
import { useCustomerPipelineStore } from "./store";
import {
  canEditListOf,
  canOwnList,
  cardBand,
  customerReaches,
  doNotContactIds,
  entryCards,
  isCustomerStale,
  visibleEntries,
} from "./rules";
import {
  CUSTOMER_BOARD,
  CUSTOMER_MILESTONES,
  CUSTOMER_STEP_BANDS,
  NOT_CONTACTED,
  type CustomerBand,
  type CustomerCard,
  type CustomerMilestone,
  type CustomerMove,
  type CustomerStep,
  type CustomerStepBand,
  type ListEntry,
} from "./types";

const firstName = (name: string): string => name.split(" ")[0] ?? name;

let reachCache: { moves: CustomerMove[]; reaches: Reach<CustomerMilestone>[] } | null = null;
/** Customer milestones reached, computed once per moves table. */
function reachesFor(moves: CustomerMove[]): Reach<CustomerMilestone>[] {
  if (reachCache?.moves !== moves) reachCache = { moves, reaches: customerReaches(moves) };
  return reachCache.reaches;
}

/** Who has a list and a customer board: everyone but candidates. */
export function useCustomerPipelineAccess(): { enabled: boolean; personId: string | null } {
  const viewer = useViewer();
  return {
    enabled: !!viewer && viewer.role !== "candidate",
    personId: viewer?.personId ?? null,
  };
}

/** List entries the viewer may see (their own and their downline's). */
function useEntries(): ListEntry[] {
  const entries = useCustomerPipelineStore((s) => s.entries);
  const people = usePeopleStore((s) => s.people);
  const viewer = useViewer();
  return useMemo(() => visibleEntries(entries, people, viewer), [entries, people, viewer]);
}

/** The customer board's columns for a person (their chain's steps, minus hidden ones). */
export function useCustomerColumns(personId: string | undefined): PipelineColumn<CustomerBand>[] {
  const people = usePeopleStore((s) => s.people);
  const uplines = usePipelineUplines();
  const steps = useCustomerPipelineStore((s) => s.steps);
  const hides = useCustomerPipelineStore((s) => s.hides);
  const chatPeople = useChatPeople();
  const viewer = useViewer();
  return useMemo(() => {
    if (!personId) return [];
    return columnsFor(chainOf(people, personId, uplines), steps, hides, CUSTOMER_BOARD).map((c) =>
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

// ---------------------------------------------------------------------------
// Your list
// ---------------------------------------------------------------------------

export interface ListOwner {
  id: string;
  name: string;
  isMe: boolean;
}

/** Whose list the viewer can open: their own, then each downline apprentice and IBO. */
export function useListOwners(): ListOwner[] {
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate") return [];
    return people
      .filter((p) => ids.has(p.id) && canOwnList(p))
      .map((p) => ({ id: p.id, name: p.name, isMe: p.id === viewer.personId }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
  }, [people, ids, viewer]);
}

export interface ListRow {
  entry: ListEntry;
  card: CustomerCard;
  /** The card's column as the owner's board shows it. */
  column: PipelineColumn<CustomerBand> | null;
  band: CustomerBand;
  /** Still in "Not contacted yet" ("Start" shows). */
  notContacted: boolean;
  /** "Jamal" when an upline added it, else null. */
  addedByName: string | null;
  /** The customer it became, when the viewer may see them (their own). */
  customer: CrmPerson | undefined;
}

export interface YourList {
  owner: ListOwner | null;
  /** May the viewer add to and edit this list? */
  canEdit: boolean;
  rows: ListRow[];
  notContacted: number;
}

/** One person's list: names not contacted yet first (hot, then warm), then the rest by stage. */
export function useYourList(ownerId: string | undefined): YourList {
  const entries = useEntries();
  const cards = useCustomerPipelineStore((s) => s.cards);
  const steps = useCustomerPipelineStore((s) => s.steps);
  const people = usePeopleStore((s) => s.people);
  const ids = useVisibleIds();
  const viewer = useViewer();
  const owners = useListOwners();
  const columns = useCustomerColumns(ownerId);
  const chatPeople = useChatPeople();
  return useMemo(() => {
    const owner = owners.find((o) => o.id === ownerId) ?? null;
    if (!owner) return { owner: null, canEdit: false, rows: [], notContacted: 0 };
    const byId = new Map(people.map((p) => [p.id, p]));
    const colIds = new Set(columns.map((c) => c.id));
    const order = new Map(columns.map((c, i) => [c.id, i]));
    const rank = (e: ListEntry) => (e.rating === "hot" ? 0 : e.rating === "warm" ? 1 : 2);
    const rows = entryCards(
      entries.filter((e) => e.ownerId === owner.id),
      cards,
    ).map(({ entry, card }): ListRow => {
      const band = cardBand(card.column, steps);
      const id = resolveColumn(card.column, band, colIds);
      const by = entry.addedBy !== entry.ownerId ? entry.addedBy : null;
      return {
        entry,
        card,
        column: columns.find((c) => c.id === id) ?? null,
        band,
        notContacted: card.column === NOT_CONTACTED,
        addedByName: by
          ? by === viewer?.personId
            ? "you"
            : firstName(byId.get(by)?.name ?? chatPeople.get(by)?.name ?? "your upline")
          : null,
        customer:
          entry.customerId && ids.has(entry.customerId) ? byId.get(entry.customerId) : undefined,
      };
    });
    rows.sort(
      (a, b) =>
        Number(b.notContacted) - Number(a.notContacted) ||
        (a.notContacted
          ? rank(a.entry) - rank(b.entry)
          : (order.get(a.column?.id ?? "") ?? 99) - (order.get(b.column?.id ?? "") ?? 99)) ||
        a.entry.name.localeCompare(b.entry.name),
    );
    return {
      owner,
      canEdit: canEditListOf(people, viewer, owner.id),
      rows,
      notContacted: rows.filter((r) => r.notContacted).length,
    };
  }, [owners, ownerId, entries, cards, steps, people, ids, viewer, columns, chatPeople]);
}

/** Names not contacted yet on the viewer's own list (the tab badge, the Home nudge). */
export function useNotContactedCount(): number {
  const entries = useCustomerPipelineStore((s) => s.entries);
  const cards = useCustomerPipelineStore((s) => s.cards);
  const viewer = useViewer();
  return useMemo(() => {
    if (!viewer || viewer.role === "candidate") return 0;
    const carded = new Set(cards.filter((c) => c.column !== NOT_CONTACTED).map((c) => c.entryId));
    return entries.filter((e) => e.ownerId === viewer.personId && !carded.has(e.id)).length;
  }, [entries, cards, viewer]);
}

/** One entry, when the viewer may see it (the card sheet). */
export function useListEntry(entryId: string | null | undefined): ListEntry | undefined {
  const entries = useEntries();
  return useMemo(() => entries.find((e) => e.id === entryId), [entries, entryId]);
}

/** Your upline's first name, for "Jamal (your upline) can see and add to your list". */
export function useListUpline(): string | null {
  const me = useMe();
  const chatPeople = useChatPeople();
  const people = usePeopleStore((s) => s.people);
  const sponsorId = me?.sponsorId;
  if (!sponsorId) return null;
  const name = chatPeople.get(sponsorId)?.name ?? people.find((p) => p.id === sponsorId)?.name;
  return name ? firstName(name) : null;
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** The customer board for a scope (whole team, your own list, a downline leader's team). */
export function useCustomerBoard(
  scope: PipelineScope,
  month: string,
): PipelineBoard<CustomerBand> | null {
  const opt = usePipelineScope(scope);
  const entries = useEntries();
  const data = useCustomerPipelineStore();
  const people = usePeopleStore((s) => s.people);
  const columns = useCustomerColumns(opt?.leaderId);
  const uplines = usePipelineUplines();
  const today = localDate();
  return useMemo(() => {
    if (!opt) return null;
    const byId = new Map(people.map((p) => [p.id, p]));
    const colIds = new Set(columns.map((c) => c.id));
    const ownerCols = new Map<string, PipelineColumn<CustomerBand>[]>();
    const boardOf = (ownerId: string) => {
      let c = ownerCols.get(ownerId);
      if (!c) {
        c =
          ownerId === opt.leaderId
            ? columns
            : columnsFor(chainOf(people, ownerId, uplines), data.steps, data.hides, CUSTOMER_BOARD);
        ownerCols.set(ownerId, c);
      }
      return c;
    };
    const stepById = new Map(data.steps.map((s) => [s.id, s]));
    const byColumn = new Map<string, BoardCard[]>(columns.map((c) => [c.id, []]));
    const mine = entries.filter((e) => opt.owners.has(e.ownerId));
    for (const { entry, card, stored } of entryCards(mine, data.cards)) {
      const band = cardBand(card.column, data.steps);
      const col = resolveColumn(card.column, band, colIds);
      const step = stepById.get(card.column);
      const o = byId.get(entry.ownerId);
      byColumn.get(col)?.push({
        personId: entry.id,
        name: entry.name,
        ownerId: entry.ownerId,
        ownerName: o ? firstName(o.name) : "",
        ownerStage: o ? effectiveBizClass(o) : undefined,
        column: col,
        cardColumn: card.column,
        band,
        elsewhere:
          col !== card.column && step
            ? { label: step.label, ownerName: firstName(byId.get(step.ownerId)?.name ?? "") }
            : null,
        days: daysInColumn(card.enteredAt, today),
        stale: isCustomerStale(card.enteredAt, band, today),
        hot: entry.rating === "hot",
        warm: entry.rating === "warm",
        listed: !stored || card.column === NOT_CONTACTED,
        dim: band === "out",
        booking: bookingView(bookingOf(card), boardOf(entry.ownerId), today),
        note: card.note,
        source: entry.howKnown,
        enteredAt: card.enteredAt,
      });
    }
    for (const list of byColumn.values()) {
      list.sort(
        (a, b) =>
          Number(b.hot) - Number(a.hot) ||
          Number(!!b.warm) - Number(!!a.warm) ||
          a.days - b.days ||
          a.name.localeCompare(b.name),
      );
    }
    const reaches = reachesFor(data.moves);
    const { from, to } = monthBounds(month);
    const reached = countReaches(reaches, opt.owners, from, to, CUSTOMER_MILESTONES);
    let inProgress = 0;
    const bands: BoardBand<CustomerBand>[] = CUSTOMER_BOARD.bands.map(({ id: b }) => {
      const cols = columns
        .filter((c) => c.band === b)
        .map((column) => ({
          column,
          cards: byColumn.get(column.id) ?? [],
          reached:
            column.kind === "milestone" ? (reached[column.band as CustomerMilestone] ?? 0) : null,
        }));
      const count = cols.reduce((s, c) => s + c.cards.length, 0);
      if (b !== "out" && b !== "on_ditto") inProgress += count;
      return { milestone: b, columns: cols, count };
    });
    return { columns, bands, registered: { cards: [], total: 0 }, inProgress };
  }, [opt, entries, data, people, columns, month, today, uplines]);
}

/**
 * Header numbers for a scope: people being worked toward a first sale (new
 * contacts, Contact and First meeting bands), customers, on Ditto.
 */
export function useCustomerSummary(scope: PipelineScope): {
  inProgress: number;
  customers: number;
  onDitto: number;
} {
  const board = useCustomerBoard(scope, localDate().slice(0, 7));
  return useMemo(() => {
    if (!board) return { inProgress: 0, customers: 0, onDitto: 0 };
    const band = (b: CustomerBand) => board.bands.find((x) => x.milestone === b)?.count ?? 0;
    return {
      inProgress: band("contact") + band("first_meeting"),
      customers: band("first_sale") + band("on_ditto"),
      onDitto: band("on_ditto"),
    };
  }, [board]);
}

export interface CustomerActivity extends MonthActivity<CustomerMilestone> {
  /** First sales per month, six months ending with the chosen one. */
  series: { key: string; count: number }[];
}

/** One month's customer milestones (and the previous month's) for a scope. */
export function useCustomerActivity(scope: PipelineScope, month: string): CustomerActivity | null {
  const opt = usePipelineScope(scope);
  const moves = useCustomerPipelineStore((s) => s.moves);
  const today = localDate();
  return useMemo(() => {
    if (!opt) return null;
    const reaches = reachesFor(moves);
    return {
      ...monthActivity(reaches, opt.owners, month, today, CUSTOMER_MILESTONES),
      series: monthlySeries(reaches, opt.owners, "first_sale", month, 6, CUSTOMER_MILESTONES),
    };
  }, [opt, moves, month, today]);
}

export interface CustomerRate {
  from: CustomerMilestone;
  to: CustomerMilestone;
  fromCount: number;
  toCount: number;
  /** Whole percent, or null with fewer than MIN_SAMPLE names. */
  pct: number | null;
}

export interface CustomerFunnel {
  from: string;
  to: string;
  counts: MilestoneCounts<CustomerMilestone>;
  rates: CustomerRate[];
  /** Per person (the viewer first, then their downline with activity). */
  rows: { personId: string; name: string; counts: MilestoneCounts<CustomerMilestone> }[];
}

/** Milestone-to-milestone conversions over the last `periodDays` days. */
export function useCustomerFunnel(scope: PipelineScope, periodDays: number): CustomerFunnel | null {
  const opt = usePipelineScope(scope);
  const moves = useCustomerPipelineStore((s) => s.moves);
  const people = usePeopleStore((s) => s.people);
  const viewer = useViewer();
  const today = localDate();
  const from = localDate(subDays(new Date(), periodDays - 1));
  return useMemo(() => {
    if (!opt || !viewer) return null;
    const reaches = reachesFor(moves);
    const counts = countReaches(reaches, opt.owners, from, today, CUSTOMER_MILESTONES);
    const rates = CUSTOMER_MILESTONES.slice(0, -1).map((m, i): CustomerRate => {
      const next = CUSTOMER_MILESTONES[i + 1];
      const a = counts[m];
      const b = counts[next];
      return {
        from: m,
        to: next,
        fromCount: a,
        toCount: b,
        pct: a >= MIN_SAMPLE ? Math.min(100, Math.round((b / a) * 100)) : null,
      };
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const owners = [...opt.owners];
    const per = countReachesByOwner(reaches, owners, from, today, CUSTOMER_MILESTONES);
    const rows = owners
      .map((id) => ({ personId: id, name: byId.get(id)?.name ?? "Someone", counts: per.get(id)! }))
      .filter((r) => r.counts.contact > 0 || r.personId === viewer.personId)
      .sort(
        (a, b) =>
          Number(b.personId === viewer.personId) - Number(a.personId === viewer.personId) ||
          b.counts.contact - a.counts.contact,
      );
    return { from, to: today, counts, rates, rows };
  }, [opt, viewer, moves, people, from, today]);
}

// ---------------------------------------------------------------------------
// Steps editor
// ---------------------------------------------------------------------------

export interface CustomerStepsEditorBand {
  band: CustomerStepBand;
  steps: (ChainStep<CustomerStep> & {
    ownerName: string;
    hiddenByName: string | null;
    cards: number;
  })[];
}

/** The viewer's customer-board steps per band: inherited (hide/show) and their own (edit). */
export function useCustomerStepsEditor(): CustomerStepsEditorBand[] {
  const viewer = useViewer();
  const people = usePeopleStore((s) => s.people);
  const uplines = usePipelineUplines();
  const steps = useCustomerPipelineStore((s) => s.steps);
  const hides = useCustomerPipelineStore((s) => s.hides);
  const cards = useCustomerPipelineStore((s) => s.cards);
  const chatPeople = useChatPeople();
  return useMemo(() => {
    if (!viewer) return [];
    const chain = chainOf(people, viewer.personId, uplines);
    const counts = new Map<string, number>();
    for (const c of cards) counts.set(c.column, (counts.get(c.column) ?? 0) + 1);
    const name = (id: string) =>
      id === viewer.personId ? "You" : (chatPeople.get(id)?.name ?? "Someone");
    return CUSTOMER_STEP_BANDS.map((band) => ({
      band,
      steps: chainSteps(chain, steps, hides, band).map((s) => ({
        ...s,
        ownerName: s.own ? "You" : firstName(name(s.step.ownerId)),
        hiddenByName: s.hiddenBy ? name(s.hiddenBy) : null,
        cards: counts.get(s.step.id) ?? 0,
      })),
    }));
  }, [viewer, people, steps, hides, cards, chatPeople, uplines]);
}

// ---------------------------------------------------------------------------
// Do not contact
// ---------------------------------------------------------------------------

const NO_IDS: ReadonlySet<string> = new Set();

/**
 * People hidden from every reminder (the Today list, event follow-ups): the
 * customers and prospects behind names in "Do not contact" on the customer
 * board, and the prospects in "Do not contact" on the recruiting board.
 */
export function useDoNotContactIds(): ReadonlySet<string> {
  const entries = useCustomerPipelineStore((s) => s.entries);
  const cards = useCustomerPipelineStore((s) => s.cards);
  const prospectCards = usePipelineStore((s) => s.cards);
  return useMemo(() => {
    const ids = doNotContactIds(entries, cards);
    for (const id of prospectDoNotContactIds(prospectCards)) ids.add(id);
    return ids.size ? ids : NO_IDS;
  }, [entries, cards, prospectCards]);
}
