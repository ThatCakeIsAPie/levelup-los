/**
 * Pipeline writes (re-exported from "@/data"). Plain functions: they apply at
 * once to the store. Each write that the user may want to take back returns
 * an `undo` for the toast.
 *
 * The board and the Log sheet write the same moves through movePipelineCard,
 * so a first meeting is counted once whichever way it was recorded.
 */
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { serverSide } from "../remote";
import { useRemoteStore } from "../remote/extras";
import { updateChat } from "../chat/store";
import type { Notification } from "../chat/types";
import { addPerson, removePerson, updatePerson } from "../people";
import { logContact, removeContact } from "../crm";
import { getViewer } from "../session";
import { visibleIdSet } from "../access";
import { customerPipeline, updateCustomerPipeline } from "../customerPipeline/store";
import {
  CUSTOMER_BOARD,
  type CustomerPipelineData,
  type CustomerStepBand,
} from "../customerPipeline/types";
import { pipeline, updatePipeline } from "./store";
import {
  bandIndex,
  bandOf,
  canEditStep,
  canHideStep,
  canRequestStats,
  canShareWith,
  chainOf,
  columnsFor,
  implicitCard,
  isMilestone,
  nextPosition,
  registrationPatch,
  reorderOwnSteps,
  stepLabelError,
  validGoal,
  validTarget,
  validateMove,
} from "./rules";
import {
  RECRUITING_BOARD,
  type BoardDef,
  type BoardKind,
  type ConversionTargets,
  type MilestoneCode,
  type PipelineCard,
  type PipelineColumn,
  type PipelineMove,
  type PipelineStep,
  type StepBand,
  type StepHide,
} from "./types";

const now = () => new Date().toISOString();

/** Real accounts: your uplines (root first), which the people list doesn't hold. */
const uplines = () => useRemoteStore.getState().chain.map((c) => c.personId);
const chainFor = (id: string) => chainOf(usePeopleStore.getState().people, id, uplines());

/**
 * Browser demo only: write an inbox notification. With real accounts the
 * database writes them (stat_requests trigger, answer_stat_request()).
 */
function notifyLocal(
  n: Omit<Notification, "id" | "createdAt" | "readAt" | "conversationId" | "messageId">,
) {
  if (IS_SUPABASE || n.recipientId === n.actorId) return;
  const note: Notification = {
    ...n,
    id: crypto.randomUUID(),
    conversationId: null,
    messageId: null,
    createdAt: now(),
    readAt: null,
  };
  updateChat((c) => ({ notifications: [note, ...c.notifications] }));
}

/** The current user, when they may use the pipeline. */
function actor(): string | null {
  const v = getViewer();
  return v && v.role !== "candidate" ? v.personId : null;
}

function visiblePerson(id: string): CrmPerson | undefined {
  const people = usePeopleStore.getState().people;
  if (!visibleIdSet(people, getViewer()).has(id)) return undefined;
  return people.find((p) => p.id === id);
}

/** Columns a card may move to: its owner's board and the viewer's board. */
function columnsForMove(person: CrmPerson, me: string): PipelineColumn[] {
  const { steps, hides } = pipeline();
  const people = usePeopleStore.getState().people;
  const mine = columnsFor(chainOf(people, me, uplines()), steps, hides);
  if (!person.sponsorId || person.sponsorId === me) return mine;
  const theirs = columnsFor(chainOf(people, person.sponsorId, uplines()), steps, hides);
  const ids = new Set(mine.map((c) => c.id));
  return [...mine, ...theirs.filter((c) => !ids.has(c.id))];
}

/** The card as stored, or the implicit Contact made card for a prospect without one. */
function cardOf(person: CrmPerson): { card: PipelineCard; stored: boolean } {
  const stored = pipeline().cards.find((c) => c.personId === person.id);
  return stored ? { card: stored, stored: true } : { card: implicitCard(person), stored: false };
}

function putCard(card: PipelineCard): void {
  updatePipeline((s) => ({
    cards: s.cards.some((c) => c.personId === card.personId)
      ? s.cards.map((c) => (c.personId === card.personId ? card : c))
      : [...s.cards, card],
  }));
}

function restoreCard(personId: string, prev: PipelineCard | null): void {
  updatePipeline((s) => ({
    cards: prev
      ? s.cards.some((c) => c.personId === personId)
        ? s.cards.map((c) => (c.personId === personId ? prev : c))
        : [...s.cards, prev]
      : s.cards.filter((c) => c.personId !== personId),
  }));
}

function removeMoves(ids: string[]): void {
  const set = new Set(ids);
  updatePipeline((s) => ({ moves: s.moves.filter((m) => !set.has(m.id)) }));
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export type MoveFailure =
  "no-access" | "not-found" | "not-a-prospect" | "not-on-board" | "unknown-column" | "same-column";

export type MoveResult =
  | { ok: true; move: PipelineMove; registered: boolean; undo: () => void }
  | { ok: false; reason: MoveFailure };

/**
 * Move a prospect's card to a column (a milestone or a step on their owner's
 * or your board) and record the move. Moving into Registered makes them an
 * apprentice from today (stage history and activity come from updatePerson).
 * The next step is cleared unless one is given.
 */
export function movePipelineCard(
  personId: string,
  to: string,
  opts: { nextStep?: string | null; nextStepDate?: string | null } = {},
): MoveResult {
  const me = actor();
  if (!me) return { ok: false, reason: "no-access" };
  const person = visiblePerson(personId);
  if (!person) return { ok: false, reason: "not-found" };
  if (person.bizClass !== "prospect") return { ok: false, reason: "not-a-prospect" };
  const { card, stored } = cardOf(person);
  const check = validateMove(card, to, columnsForMove(person, me));
  if (!check.ok) return check;
  const at = now();
  const move: PipelineMove = {
    id: crypto.randomUUID(),
    personId,
    ownerId: person.sponsorId ?? me,
    from: card.column,
    to,
    milestone: check.to.band,
    movedAt: at,
    movedBy: me,
  };
  putCard({
    ...card,
    column: to,
    enteredAt: at,
    nextStep: opts.nextStep !== undefined ? opts.nextStep : null,
    nextStepDate: opts.nextStepDate !== undefined ? opts.nextStepDate : null,
    updatedAt: at,
  });
  updatePipeline((s) => ({ moves: [...s.moves, move] }));
  const registered = to === "registered";
  const before = { businessStartDate: person.businessStartDate };
  if (registered) {
    // Real accounts: move_pipeline_card() registers them (and logs the activity).
    const register = () => updatePerson(personId, registrationPatch(localDate()));
    if (IS_SUPABASE) serverSide(register);
    else register();
  }
  return {
    ok: true,
    move,
    registered,
    undo: () => {
      removeMoves([move.id]);
      restoreCard(personId, stored ? card : null);
      if (registered) {
        // Real accounts: deleting the move puts them back to prospect in the
        // database (pipeline_moves_after_delete), in the same statement.
        const unregister = () =>
          updatePerson(personId, {
            bizClass: "prospect",
            pipelineStage: "prospect",
            businessStartDate: before.businessStartDate,
          });
        if (IS_SUPABASE) serverSide(unregister);
        else unregister();
      }
    },
  };
}

/** Create a card (and its first move) for a prospect who has none yet. */
function createCard(
  person: CrmPerson,
  me: string,
  column: string,
  extra: Partial<PipelineCard> = {},
): { card: PipelineCard; move: PipelineMove } | null {
  const band = bandOf(column, pipeline().steps);
  if (!band) return null;
  const at = now();
  const card: PipelineCard = {
    personId: person.id,
    column,
    enteredAt: at,
    nextStep: null,
    nextStepDate: null,
    hot: false,
    source: null,
    droppedAt: null,
    updatedAt: at,
    ...extra,
  };
  const move: PipelineMove = {
    id: crypto.randomUUID(),
    personId: person.id,
    ownerId: person.sponsorId ?? me,
    from: null,
    to: column,
    milestone: band,
    movedAt: at,
    movedBy: me,
  };
  putCard(card);
  updatePipeline((s) => ({ moves: [...s.moves, move] }));
  return { card, move };
}

/**
 * Log sheet "New contact": put the new prospect on the board in Contact made.
 * Returns the undo (or null when there's nothing to do).
 */
export function startPipelineCard(
  personId: string,
  opts: { source?: string | null } = {},
): (() => void) | null {
  const me = actor();
  const person = me ? visiblePerson(personId) : undefined;
  if (!me || !person || person.bizClass !== "prospect") return null;
  if (pipeline().cards.some((c) => c.personId === personId)) return null;
  const r = createCard(person, me, "contact", { source: opts.source?.trim() || null });
  if (!r) return null;
  return () => {
    removeMoves([r.move.id]);
    restoreCard(personId, null);
  };
}

/**
 * Add a prospect from the board: a new person sponsored by `sponsorId`
 * (default you), a "New contact" contact, and a card in `column`.
 */
export function addPipelineProspect(input: {
  name: string;
  phone?: string;
  source?: string;
  sponsorId?: string;
  column?: string;
  nextStep?: string;
  nextStepDate?: string;
}): { person: CrmPerson; undo: () => void } | null {
  const me = actor();
  const name = input.name.trim();
  if (!me || !name) return null;
  const today = localDate();
  const person = addPerson({
    name,
    bizClass: "prospect",
    sponsorId: input.sponsorId ?? me,
    joinedDate: today,
    ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
    ...(input.source?.trim() ? { notes: `Met: ${input.source.trim()}` } : {}),
  });
  const contact = logContact({ personId: person.id, date: today, note: "New contact" });
  const r = createCard(person, me, input.column ?? "contact", {
    source: input.source?.trim() || null,
    nextStep: input.nextStep?.trim() || null,
    nextStepDate: input.nextStepDate || null,
  });
  return {
    person,
    undo: () => {
      if (r) removeMoves([r.move.id]);
      restoreCard(person.id, null);
      removeContact(contact.id);
      removePerson(person.id);
    },
  };
}

/** The card's current band for a prospect (Contact made when there's no card). */
function currentBand(person: CrmPerson): MilestoneCode {
  const { card } = cardOf(person);
  return bandOf(card.column, pipeline().steps) ?? "contact";
}

/**
 * Log sheet "Showed the plan": move the prospect to First plan, unless they
 * are already there or further. Returns null when nothing moves.
 */
export function recordShowedPlan(personId: string): MoveResult | null {
  const person = visiblePerson(personId);
  if (!person || person.bizClass !== "prospect") return null;
  if (bandIndex(currentBand(person)) >= bandIndex("first_plan")) return null;
  const r = movePipelineCard(personId, "first_plan");
  return r.ok ? r : null;
}

/** Would "Showed the plan" move this person? (For the form's hint.) */
export function showedPlanMoves(personId: string): boolean {
  const person = usePeopleStore.getState().people.find((p) => p.id === personId);
  if (!person || person.bizClass !== "prospect") return false;
  return bandIndex(currentBand(person)) < bandIndex("first_plan");
}

/** Edit a card's next step, hot flag or source. */
export function updatePipelineCard(
  personId: string,
  patch: Partial<Pick<PipelineCard, "nextStep" | "nextStepDate" | "hot" | "source">>,
): void {
  const person = actor() ? visiblePerson(personId) : undefined;
  if (!person || person.bizClass !== "prospect") return;
  const { card } = cardOf(person);
  putCard({ ...card, ...patch, updatedAt: now() });
}

/**
 * Take a card off the board ("not now"); the person stays a prospect and
 * their moves still count. Returns the undo.
 */
export function dropPipelineCard(personId: string): (() => void) | null {
  const person = actor() ? visiblePerson(personId) : undefined;
  if (!person || person.bizClass !== "prospect") return null;
  const { card, stored } = cardOf(person);
  if (card.droppedAt) return null;
  putCard({ ...card, droppedAt: now(), updatedAt: now() });
  return () => restoreCard(personId, stored ? card : null);
}

/** Put a dropped card back where it was. */
export function restorePipelineCard(personId: string): void {
  const person = actor() ? visiblePerson(personId) : undefined;
  if (!person) return;
  const stored = pipeline().cards.find((c) => c.personId === personId);
  if (stored?.droppedAt) putCard({ ...stored, droppedAt: null, updatedAt: now() });
}

// ---------------------------------------------------------------------------
// Steps (milestones are not steps: they can't be renamed, removed or reordered).
// The same rules on both boards: `kind` picks the recruiting board (default)
// or the customer board (src/data/customerPipeline), whose steps, hides and
// cards live in their own tables.
// ---------------------------------------------------------------------------

export type StepResult = { ok: true; step?: PipelineStep<string> } | { ok: false; error: string };

interface StepTables {
  def: BoardDef<string>;
  steps(): PipelineStep<string>[];
  hides(): StepHide[];
  setSteps(fn: (steps: PipelineStep<string>[]) => PipelineStep<string>[]): void;
  setHides(fn: (hides: StepHide[]) => StepHide[]): void;
  /** Send the cards in a deleted step back to its band's milestone; returns how many moved. */
  resetCards(stepId: string, band: string): number;
}

const RECRUITING_STEPS: StepTables = {
  def: RECRUITING_BOARD as BoardDef<string>,
  steps: () => pipeline().steps,
  hides: () => pipeline().hides,
  setSteps: (fn) => updatePipeline((s) => ({ steps: fn(s.steps) as PipelineStep[] })),
  setHides: (fn) => updatePipeline((s) => ({ hides: fn(s.hides) })),
  resetCards: (stepId, band) => {
    const moved = pipeline().cards.filter((c) => c.column === stepId).length;
    updatePipeline((s) => ({
      cards: s.cards.map((c) =>
        c.column === stepId ? { ...c, column: band, updatedAt: now() } : c,
      ),
    }));
    return moved;
  },
};

const CUSTOMER_STEPS: StepTables = {
  def: CUSTOMER_BOARD as BoardDef<string>,
  steps: () => customerPipeline().steps,
  hides: () => customerPipeline().hides,
  setSteps: (fn) =>
    updateCustomerPipeline((s) => ({ steps: fn(s.steps) as CustomerPipelineData["steps"] })),
  setHides: (fn) => updateCustomerPipeline((s) => ({ hides: fn(s.hides) })),
  resetCards: (stepId, band) => {
    const moved = customerPipeline().cards.filter((c) => c.column === stepId).length;
    updateCustomerPipeline((s) => ({
      cards: s.cards.map((c) =>
        c.column === stepId ? { ...c, column: band, updatedAt: now() } : c,
      ),
    }));
    return moved;
  },
};

const stepTables = (kind: BoardKind): StepTables =>
  kind === "customer" ? CUSTOMER_STEPS : RECRUITING_STEPS;

/** Milestones and fixed columns aren't steps. */
const isFixedColumn = (t: StepTables, id: string) =>
  t.def.milestones.includes(id) || t.def.fixed.some((f) => f.id === id);

function bandLabels(t: StepTables, band: string, me: string, except?: string): string[] {
  return columnsFor(chainFor(me), t.steps(), t.hides(), t.def)
    .filter((c) => c.band === band && c.kind === "step" && c.id !== except)
    .map((c) => c.label);
}

/** Add one of your own steps at the end of your steps in a band. */
export function addPipelineStep(
  band: StepBand | CustomerStepBand,
  label: string,
  kind: BoardKind = "recruiting",
): StepResult {
  const me = actor();
  if (!me) return { ok: false, error: "Candidates don't have a pipeline yet." };
  const t = stepTables(kind);
  if (!t.def.stepBands.includes(band)) return { ok: false, error: "Steps can't go there." };
  const error = stepLabelError(label, bandLabels(t, band, me), undefined, t.def.reserved);
  if (error) return { ok: false, error };
  const step: PipelineStep<string> = {
    id: crypto.randomUUID(),
    ownerId: me,
    band,
    label: label.trim(),
    position: nextPosition(t.steps(), me, band),
    createdAt: now(),
  };
  t.setSteps((steps) => [...steps, step]);
  return { ok: true, step };
}

/** Rename one of your own steps. */
export function renamePipelineStep(
  stepId: string,
  label: string,
  kind: BoardKind = "recruiting",
): StepResult {
  const me = actor();
  const t = stepTables(kind);
  if (isFixedColumn(t, stepId)) return { ok: false, error: "Milestones can't be renamed." };
  const step = t.steps().find((s) => s.id === stepId);
  if (!me || !step || !canEditStep(step, me))
    return { ok: false, error: "Only the leader who added a step can rename it." };
  const error = stepLabelError(
    label,
    bandLabels(t, step.band, me, stepId),
    undefined,
    t.def.reserved,
  );
  if (error) return { ok: false, error };
  t.setSteps((steps) => steps.map((x) => (x.id === stepId ? { ...x, label: label.trim() } : x)));
  return { ok: true };
}

/** Move one of your own steps up (-1) or down (+1) among your steps in its band. */
export function movePipelineStep(
  stepId: string,
  dir: -1 | 1,
  kind: BoardKind = "recruiting",
): StepResult {
  const me = actor();
  const t = stepTables(kind);
  if (!me || isFixedColumn(t, stepId)) return { ok: false, error: "Milestones can't be moved." };
  const changed = reorderOwnSteps(t.steps(), me, stepId, dir);
  if (!changed.length) return { ok: false, error: "It can't move further." };
  const byId = new Map(changed.map((s) => [s.id, s]));
  t.setSteps((steps) => steps.map((x) => byId.get(x.id) ?? x));
  return { ok: true };
}

/**
 * Delete one of your own steps. Cards in it go back to its milestone; past
 * moves keep counting (under the milestone). Returns how many cards moved.
 */
export function deletePipelineStep(
  stepId: string,
  kind: BoardKind = "recruiting",
): { ok: true; moved: number } | { ok: false; error: string } {
  const me = actor();
  const t = stepTables(kind);
  if (isFixedColumn(t, stepId)) return { ok: false, error: "Milestones can't be removed." };
  const step = t.steps().find((s) => s.id === stepId);
  if (!me || !step || !canEditStep(step, me))
    return { ok: false, error: "Only the leader who added a step can delete it." };
  t.setSteps((steps) => steps.filter((x) => x.id !== stepId));
  t.setHides((hides) => hides.filter((h) => h.stepId !== stepId));
  const moved = t.resetCards(stepId, step.band);
  return { ok: true, moved };
}

/** Hide an upline's step for your team (you and your downline). */
export function hidePipelineStep(stepId: string, kind: BoardKind = "recruiting"): StepResult {
  const me = actor();
  const t = stepTables(kind);
  const step = t.steps().find((s) => s.id === stepId);
  const chain = me ? chainFor(me) : [];
  if (!me || !step || !canHideStep(step, chain, me))
    return { ok: false, error: "You can hide steps you inherit from your upline." };
  if (t.hides().some((h) => h.personId === me && h.stepId === stepId)) return { ok: true };
  t.setHides((hides) => [...hides, { personId: me, stepId, createdAt: now() }]);
  return { ok: true };
}

/** Show a step you hid again. */
export function showPipelineStep(stepId: string, kind: BoardKind = "recruiting"): void {
  const me = actor();
  if (!me) return;
  stepTables(kind).setHides((hides) =>
    hides.filter((h) => !(h.personId === me && h.stepId === stepId)),
  );
}

// ---------------------------------------------------------------------------
// Team goal and conversion targets (yours, for your team; null = inherit)
// ---------------------------------------------------------------------------

function patchSetting(patch: { mg1Goal?: number | null; targets?: ConversionTargets | null }) {
  const me = actor();
  if (!me) return false;
  updatePipeline((s) => {
    const prev = s.settings.find((x) => x.personId === me);
    const next = {
      personId: me,
      mg1Goal: prev?.mg1Goal ?? null,
      targets: prev?.targets ?? null,
      ...patch,
      updatedAt: now(),
    };
    return {
      settings: prev
        ? s.settings.map((x) => (x.personId === me ? next : x))
        : [...s.settings, next],
    };
  });
  return true;
}

/** Your team's first-meeting goal per month (null: use your upline's). */
export function setTeamGoal(goal: number | null): boolean {
  if (goal !== null && !validGoal(goal)) return false;
  return patchSetting({ mg1Goal: goal });
}

/** Your team's conversion targets (null: use your upline's). */
export function setConversionTargets(targets: ConversionTargets | null): boolean {
  if (targets && !Object.values(targets).every(validTarget)) return false;
  return patchSetting({ targets });
}

// ---------------------------------------------------------------------------
// Sharing per-person numbers
// ---------------------------------------------------------------------------

/** Share your numbers with these people (uplines already see them). Returns how many were added. */
export function shareStats(viewerIds: string[]): number {
  const me = actor();
  if (!me) return 0;
  const people = usePeopleStore.getState().people;
  const at = now();
  let added = 0;
  updatePipeline((s) => {
    const shares = [...s.shares];
    for (const id of viewerIds) {
      if (!canShareWith(people, me, id, shares, uplines())) continue;
      // The id is the pair (the table's key), so a share is never made twice.
      shares.push({ id: `${me}:${id}`, ownerId: me, viewerId: id, createdAt: at });
      added++;
    }
    return { shares };
  });
  return added;
}

/** Stop sharing (only the person who shared can revoke). */
export function revokeStatShare(shareId: string): void {
  const me = actor();
  if (!me) return;
  updatePipeline((s) => ({
    shares: s.shares.filter((x) => !(x.id === shareId && x.ownerId === me)),
  }));
}

/** Ask someone to see their numbers; they answer from their inbox / profile. */
export function requestStats(ownerId: string): { ok: true } | { ok: false; reason: string } {
  const me = actor();
  const v = getViewer();
  const s = pipeline();
  const check = canRequestStats(usePeopleStore.getState().people, v, ownerId, s.shares, s.requests);
  if (!me || !check.ok) return { ok: false, reason: check.ok ? "candidate" : check.reason };
  const id = crypto.randomUUID();
  updatePipeline((d) => ({
    requests: [
      ...d.requests,
      { id, requesterId: me, ownerId, status: "pending", createdAt: now(), decidedAt: null },
    ],
  }));
  notifyLocal({ recipientId: ownerId, type: "stat_request", actorId: me, refId: id });
  return { ok: true };
}

/** Approve (shares your numbers) or decline a request sent to you. */
export function answerStatRequest(requestId: string, approve: boolean): void {
  const me = actor();
  const req = pipeline().requests.find((r) => r.id === requestId);
  if (!me || !req || req.ownerId !== me || req.status !== "pending") return;
  const at = now();
  updatePipeline((s) => ({
    requests: s.requests.map((r) =>
      r.id === requestId ? { ...r, status: approve ? "approved" : "declined", decidedAt: at } : r,
    ),
  }));
  if (approve) shareStats([req.requesterId]);
  if (!IS_SUPABASE) {
    updateChat((c) => ({
      notifications: c.notifications.map((n) =>
        n.type === "stat_request" && n.refId === requestId && !n.readAt ? { ...n, readAt: at } : n,
      ),
    }));
  }
  notifyLocal({
    recipientId: req.requesterId,
    type: "stat_request_answered",
    actorId: me,
    refId: requestId,
  });
}

/** Withdraw your own pending request. */
export function cancelStatRequest(requestId: string): void {
  const me = actor();
  if (!me) return;
  updatePipeline((s) => ({
    requests: s.requests.filter(
      (r) => !(r.id === requestId && r.requesterId === me && r.status === "pending"),
    ),
  }));
  // The database removes the owner's notification itself (trigger).
  if (!IS_SUPABASE)
    updateChat((c) => ({
      notifications: c.notifications.filter(
        (n) => !(n.type === "stat_request" && n.refId === requestId),
      ),
    }));
}
