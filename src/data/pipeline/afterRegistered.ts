/**
 * Who is on the recruiting board after the Registered milestone (pure: no React, no stores). Unit-tested
 * in afterRegistered.test.ts; the database mirrors it in `pipeline_registered_card_column()` (migration
 * 20261112000100), and the steps editor and the board render from it.
 *
 * A leader may add steps after Registered (band `registered`). Registered people (apprentices and IBOs)
 * then have cards in Registered or in those steps. Rules:
 *
 *  - A board with NO step in that band behaves exactly as before: nobody registered is on it, nothing in
 *    this module returns anything (`enabled: false`).
 *  - A registered person whose card is in a step after Registered, and is not taken off the board, is in
 *    progress. A person with no stored card, or whose card is in Registered (or in a column the board does
 *    not have: a step that is hidden or deleted, which falls back to Registered), sits in Registered only
 *    if they registered on or after the CUTOFF: the first day, in the team's time zone, of the month in
 *    which the board's earliest step after Registered was created. Earlier registrations are finished and
 *    not on the board: nothing floods it the day a leader adds the first step.
 *  - The LAST column of the band is the finishing column: it lists the cards that entered it this calendar
 *    month; older ones are finished: counted in its total, not listed (as Registered presents a month).
 *  - Registered day: the day of the person's earliest move into the registered band, else their business
 *    start date.
 */
import type { CrmPerson } from "@/stores/peopleStore";
import { chainOf, columnsFor, isRegisteredPerson, localNoon } from "./rules";
import {
  POST_REGISTRATION_BAND,
  type BoardDef,
  type PipelineCard,
  type PipelineColumn,
  type PipelineMove,
  type PipelineStep,
  type RecruitingBand,
  type StepHide,
} from "./types";

/** The calendar day ("YYYY-MM-DD") of an ISO timestamp in a time zone (the team's). */
export function zonedDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export interface AfterRegisteredInput {
  /**
   * The board's columns (`columnsFor` for the board's leader: Registered then the steps after it, hidden
   * ones left out). A deleted or hidden step is simply not here.
   */
  columns: readonly PipelineColumn<string>[];
  /** Every pipeline step (their `createdAt` dates the cutoff). */
  steps: readonly Pick<PipelineStep<string>, "id" | "createdAt">[];
  /** The people to consider (the caller has already limited them to those on this board and visible); only registered ones count. */
  people: readonly Pick<
    CrmPerson,
    "id" | "bizClass" | "businessStartDate" | "sponsorId" | "lastUpdatedAt"
  >[];
  cards: readonly Pick<PipelineCard, "personId" | "column" | "enteredAt" | "droppedAt">[];
  moves: readonly Pick<PipelineMove, "personId" | "milestone" | "movedAt">[];
  /** Today in the team's calendar, "YYYY-MM-DD". */
  today: string;
  /** The team's time zone (IANA). */
  timeZone: string;
}

/** One registered person's card on the board. */
export interface AfterRegisteredCard {
  personId: string;
  /** The board column it shows in: "registered" or a step after it. */
  column: string;
  /** Its stored column when that is not the one shown (a hidden or deleted step), else null. */
  cardColumn: string | null;
  /** When it entered the column (the card's `enteredAt`; with no stored card, noon of the registered day). */
  enteredAt: string;
  /** The day they registered ("YYYY-MM-DD"), null when unknown. */
  registeredDay: string | null;
  /** The day to show next to the name: when they entered a step, or registered. */
  day: string;
  /** False when the card has no stored row (they sit in Registered by the cutoff rule). */
  stored: boolean;
}

export interface AfterRegisteredColumn {
  column: PipelineColumn<string>;
  /** The cards to list, newest first (the finishing column lists this month's only). */
  cards: AfterRegisteredCard[];
  /** Cards in the column: `cards.length`, and in the finishing column also the finished ones. */
  total: number;
  /** The last column of the band. */
  finishing: boolean;
}

export interface AfterRegistered {
  /** At least one step after Registered is on the board. False: nothing here, the board is as it was. */
  enabled: boolean;
  /** The first day ("YYYY-MM-DD") from which registrations are on the board; null when not enabled. */
  cutoff: string | null;
  /** Registered, then each step after it, in board order (empty when not enabled). */
  columns: AfterRegisteredColumn[];
  /** Every person in progress, with the column they show in (finished people are absent). */
  inProgress: ReadonlyMap<string, string>;
  /** People whose card is in the finishing column since before this month: finished, on the board only as a count. */
  finished: ReadonlySet<string>;
}

const NOTHING: AfterRegistered = {
  enabled: false,
  cutoff: null,
  columns: [],
  inProgress: new Map(),
  finished: new Set(),
};

/** What `registeredInProgressIds` reads: the stores' tables, as plain values. */
export interface InProgressState {
  /** Everyone (the sponsor chains come from it). */
  people: readonly CrmPerson[];
  steps: readonly PipelineStep<string>[];
  hides: readonly StepHide[];
  cards: readonly PipelineCard[];
  moves: readonly PipelineMove[];
  /** Real accounts: your uplines, root first (the people list stops at your team). */
  uplines: string[];
  def: BoardDef<RecruitingBand>;
  timeZone: string;
  now: Date;
}

/**
 * Of these people, who is a registered person whose card is in progress on THEIR SPONSOR'S board (the
 * board the database judges them by). One pass per sponsor; a team with no step after Registered costs
 * nothing (empty set). Used for tasks and notes on the card and for Home's due tasks.
 */
export function registeredInProgressIds(
  candidates: readonly CrmPerson[],
  s: InProgressState,
): Set<string> {
  const out = new Set<string>();
  if (!s.steps.some((x) => x.band === POST_REGISTRATION_BAND)) return out;
  const today = zonedDay(s.now.toISOString(), s.timeZone);
  const bySponsor = new Map<string, CrmPerson[]>();
  for (const p of candidates) {
    if (!isRegisteredPerson(p) || !p.sponsorId) continue;
    bySponsor.set(p.sponsorId, [...(bySponsor.get(p.sponsorId) ?? []), p]);
  }
  for (const [sponsor, people] of bySponsor) {
    const columns = columnsFor(
      chainOf(s.people as CrmPerson[], sponsor, s.uplines),
      s.steps,
      s.hides as StepHide[],
      s.def,
    );
    const r = afterRegistered({
      columns,
      steps: s.steps,
      people,
      cards: s.cards,
      moves: s.moves,
      today,
      timeZone: s.timeZone,
    });
    for (const id of r.inProgress.keys()) out.add(id);
  }
  return out;
}

/** THE rule for who is on the board after Registered, and where. */
export function afterRegistered(input: AfterRegisteredInput): AfterRegistered {
  const post = input.columns.filter((c) => c.band === POST_REGISTRATION_BAND);
  const registeredCol = post.find((c) => c.kind === "milestone");
  const stepCols = post.filter((c) => c.kind === "step");
  if (!registeredCol || !stepCols.length) return NOTHING;
  const { timeZone, today } = input;
  const stepIds = new Set(stepCols.map((c) => c.id));
  const finishingId = stepCols[stepCols.length - 1].id;
  const created = input.steps
    .filter((s) => stepIds.has(s.id))
    .map((s) => s.createdAt)
    .sort()[0];
  const cutoff = created ? `${zonedDay(created, timeZone).slice(0, 7)}-01` : null;
  const thisMonth = today.slice(0, 7);

  const cardOf = new Map(input.cards.map((c) => [c.personId, c]));
  const firstRegistered = new Map<string, string>();
  for (const m of input.moves) {
    if (m.milestone !== POST_REGISTRATION_BAND) continue;
    const prev = firstRegistered.get(m.personId);
    if (prev === undefined || m.movedAt < prev) firstRegistered.set(m.personId, m.movedAt);
  }

  const byColumn = new Map<string, AfterRegisteredCard[]>(post.map((c) => [c.id, []]));
  const inProgress = new Map<string, string>();
  const finished = new Set<string>();
  let finishedCount = 0;
  for (const p of input.people) {
    if (!isRegisteredPerson(p)) continue;
    const card = cardOf.get(p.id);
    if (card?.droppedAt) continue;
    const at = firstRegistered.get(p.id);
    const registeredDay = at ? zonedDay(at, timeZone) : (p.businessStartDate ?? null);
    const inStep = !!card && stepIds.has(card.column);
    const column = inStep ? card.column : registeredCol.id;
    let enteredAt: string;
    if (card) enteredAt = card.enteredAt;
    else if (at) enteredAt = at;
    else
      enteredAt = registeredDay
        ? localNoon(registeredDay)
        : (p.lastUpdatedAt ?? new Date(0).toISOString());
    if (!inStep && !(registeredDay && cutoff && registeredDay >= cutoff)) continue;
    if (
      inStep &&
      column === finishingId &&
      zonedDay(enteredAt, timeZone).slice(0, 7) !== thisMonth
    ) {
      finished.add(p.id);
      finishedCount++;
      continue;
    }
    inProgress.set(p.id, column);
    byColumn.get(column)!.push({
      personId: p.id,
      column,
      cardColumn: card && card.column !== column ? card.column : null,
      enteredAt,
      registeredDay,
      day: inStep
        ? zonedDay(enteredAt, timeZone)
        : (registeredDay ?? zonedDay(enteredAt, timeZone)),
      stored: !!card,
    });
  }
  const columns = post.map((column): AfterRegisteredColumn => {
    const cards = (byColumn.get(column.id) ?? []).sort(
      (a, b) => b.day.localeCompare(a.day) || a.personId.localeCompare(b.personId),
    );
    const finishing = column.id === finishingId;
    return { column, cards, total: cards.length + (finishing ? finishedCount : 0), finishing };
  });
  return { enabled: true, cutoff, columns, inProgress, finished };
}
