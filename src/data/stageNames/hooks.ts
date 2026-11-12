/**
 * Stage names for the signed-in person (rules in ./rules): the one place UI
 * and data code get a stage's displayed name, and the writes behind the rename
 * dialog. Same in both data sources; they differ only in where the names set
 * above you come from:
 *  - demo: the sponsor tree in the people store, every person's own names in
 *    the stage names store;
 *  - real accounts: `effective_stage_names(false)` (./inherited), because the
 *    people above you aren't all in your CRM view; your own rows are in the
 *    stage names store.
 */
import { useMemo } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useInheritedStageNames, type InheritedStageName } from "./inherited";
import { makeStageNames, registerStageNamesSource, type StageNames } from "./names";
import {
  draftOf,
  inheritedStageNames,
  reservedStageNames,
  resolveStageNames,
  sponsorLine,
  stageNameErrors,
  STAGE_KEYS,
  type ResolvedStage,
  type ResolvedStages,
  type StageNameDraft,
  type StageNameEntry,
  type StagePipeline,
} from "./rules";
import { useStageNamesStore } from "./store";
import { CUSTOMER_BOARD, type CustomerBand } from "../customerPipeline/types";
import { RECRUITING_BOARD, type BoardDef, type RecruitingBand } from "../pipeline/types";

const NO_PEOPLE: CrmPerson[] = [];

interface Context {
  me: string | null;
  /** Viewer first, then their sponsors upward. */
  line: string[];
  entries: StageNameEntry[];
  nameOf: (id: string) => string | undefined;
  resolved: ResolvedStages;
  /** The same with the viewer's own names left out. */
  inherited: ResolvedStages;
  views: Record<StagePipeline, StageNames>;
}

let cache: {
  me: string | null;
  entries: StageNameEntry[];
  people: CrmPerson[];
  up: InheritedStageName[];
  ctx: Context;
} | null = null;

/** Everything resolved for one person, computed once per change of its inputs. */
function contextFor(
  me: string | null,
  entries: StageNameEntry[],
  people: CrmPerson[],
  up: InheritedStageName[],
): Context {
  if (
    cache &&
    cache.me === me &&
    cache.entries === entries &&
    cache.people === people &&
    cache.up === up
  )
    return cache.ctx;
  let line: string[] = [];
  let all = entries;
  let nameOf: (id: string) => string | undefined;
  if (!me) {
    nameOf = () => undefined;
  } else if (IS_SUPABASE) {
    // Own rows, plus each name set above you as that upline's entry.
    const from = new Map(up.map((r) => [r.fromId, r.fromName]));
    line = [me, ...from.keys()];
    all = [
      ...entries.filter((e) => e.personId === me),
      ...up.map((r) => ({
        personId: r.fromId,
        pipeline: r.pipeline,
        stage: r.stage,
        name: r.name,
      })),
    ];
    nameOf = (id) => from.get(id);
  } else {
    const byId = new Map(people.map((p) => [p.id, p]));
    line = sponsorLine((id) => byId.get(id)?.sponsorId, me);
    nameOf = (id) => byId.get(id)?.name;
  }
  const resolved = resolveStageNames(line, all, nameOf);
  const ctx: Context = {
    me,
    line,
    entries: all,
    nameOf,
    resolved,
    inherited: inheritedStageNames(line, all, nameOf),
    views: {
      recruiting: makeStageNames("recruiting", resolved.recruiting),
      customer: makeStageNames("customer", resolved.customer),
    },
  };
  cache = { me, entries, people, up, ctx };
  return ctx;
}

function currentContext(): Context {
  return contextFor(
    useSessionStore.getState().user?.personId ?? null,
    useStageNamesStore.getState().entries,
    IS_SUPABASE ? NO_PEOPLE : usePeopleStore.getState().people,
    useInheritedStageNames.getState().rows,
  );
}

function useContext(): Context {
  const me = useSessionStore((s) => s.user?.personId ?? null);
  const entries = useStageNamesStore((s) => s.entries);
  const people = usePeopleStore((s) => (IS_SUPABASE ? NO_PEOPLE : s.people));
  const up = useInheritedStageNames((s) => s.rows);
  return contextFor(me, entries, people, up);
}

/**
 * The names the signed-in person sees for a pipeline's stages. Use this
 * for every display of a stage name; never write one in a component.
 * `names.name("first_meeting")`, `names.column(key)`, `names.band(id)`,
 * `names.board(RECRUITING_BOARD)`.
 */
export function useStageNames(pipeline: StagePipeline): StageNames {
  return useContext().views[pipeline];
}

/** Non-reactive `useStageNames`, for code outside React (toasts, exports, rules). */
export function getStageNames(pipeline: StagePipeline): StageNames {
  return currentContext().views[pipeline];
}
registerStageNamesSource(getStageNames);

/** A pipeline's board layout with the signed-in person's stage names. */
export function useBoardDef(pipeline: "recruiting"): BoardDef<RecruitingBand>;
export function useBoardDef(pipeline: "customer"): BoardDef<CustomerBand>;
export function useBoardDef(pipeline: StagePipeline): BoardDef<string>;
export function useBoardDef(pipeline: StagePipeline): BoardDef<string> {
  const names = useStageNames(pipeline);
  return useMemo(
    () =>
      names.board(
        (pipeline === "recruiting" ? RECRUITING_BOARD : CUSTOMER_BOARD) as BoardDef<string>,
      ),
    [names, pipeline],
  );
}

/** Non-reactive `useBoardDef`. */
export function getBoardDef(pipeline: "recruiting"): BoardDef<RecruitingBand>;
export function getBoardDef(pipeline: "customer"): BoardDef<CustomerBand>;
export function getBoardDef(pipeline: StagePipeline): BoardDef<string>;
export function getBoardDef(pipeline: StagePipeline): BoardDef<string> {
  return getStageNames(pipeline).board(
    (pipeline === "recruiting" ? RECRUITING_BOARD : CUSTOMER_BOARD) as BoardDef<string>,
  );
}

// ---------------------------------------------------------------------------
// The rename dialog
// ---------------------------------------------------------------------------

export interface StageNameRow {
  key: string;
  /** What the person typed and saved (empty = not set by them). */
  own: string;
  /** What they'd see without a name of their own, and from whom. */
  inherited: ResolvedStage;
  /** What they see now. */
  effective: ResolvedStage;
}

export interface StageNameEditor {
  rows: StageNameRow[];
  /** Names a stage can't take (the board's other column names). */
  reserved: string[];
}

/** The signed-in person's names for one pipeline, as the rename dialog edits them. */
export function useStageNameEditor(pipeline: StagePipeline): StageNameEditor {
  const ctx = useContext();
  return useMemo(() => editorOf(ctx, pipeline), [ctx, pipeline]);
}

function editorOf(ctx: Context, pipeline: StagePipeline): StageNameEditor {
  const own = ctx.me ? draftOf(ctx.entries, ctx.me, pipeline) : {};
  return {
    rows: STAGE_KEYS[pipeline].map((key) => ({
      key,
      own: own[key] ?? "",
      inherited: ctx.inherited[pipeline][key],
      effective: ctx.resolved[pipeline][key],
    })),
    reserved: reservedStageNames(pipeline === "recruiting" ? RECRUITING_BOARD : CUSTOMER_BOARD),
  };
}

export type SaveStageNamesResult = { ok: true } | { ok: false; errors: Record<string, string> };

/**
 * Save the signed-in person's names for one pipeline: `draft` maps stage key to
 * the name typed (empty or missing = not set by them, which removes their own
 * name). Checked first (trimmed, 1 to 30 characters, no two stages with the same
 * name after resolution); nothing is saved when anything is wrong.
 */
export function saveStageNames(
  pipeline: StagePipeline,
  draft: StageNameDraft,
): SaveStageNamesResult {
  const ctx = currentContext();
  const me = ctx.me;
  if (!me) return { ok: false, errors: {} };
  const editor = editorOf(ctx, pipeline);
  const errors = stageNameErrors(pipeline, draft, ctx.inherited[pipeline], editor.reserved);
  if (Object.keys(errors).length) return { ok: false, errors };
  // One store change per row: with real accounts the sync engine treats a single
  // change that empties the table as a reset, not as deletes.
  for (const row of editor.rows) {
    const next = (draft[row.key] ?? "").trim();
    if (next === row.own) continue;
    setOwn(me, pipeline, row.key, next);
  }
  return { ok: true };
}

function setOwn(me: string, pipeline: StagePipeline, stage: string, name: string): void {
  const { entries } = useStageNamesStore.getState();
  const others = entries.filter(
    (e) => !(e.personId === me && e.pipeline === pipeline && e.stage === stage),
  );
  useStageNamesStore.setState({
    entries: name ? [...others, { personId: me, pipeline, stage, name }] : others,
  });
}
