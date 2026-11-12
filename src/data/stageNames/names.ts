/**
 * The stage names one viewer sees, with helpers every display uses (see
 * ./rules for the rule). Built by `useStageNames` / `getStageNames` in
 * ./hooks; kept apart from the stores so tests can build one directly.
 */
import { CUSTOMER_BAND_LABEL } from "../customerPipeline/types";
import { RECRUITING_BAND_LABEL, type BoardDef } from "../pipeline/types";
import { resolveStageNames, type ResolvedStage, type StagePipeline } from "./rules";

export interface StageNames {
  pipeline: StagePipeline;
  /** Every stage with where its name comes from, in board order. */
  stages: readonly ResolvedStage[];
  /**
   * The stage's name for sentences, chips, menus and headings (`key` is the
   * milestone code, also a board band id). An unknown key comes back as is.
   */
  name(key: string): string;
  /** The stage's name as a board column header. */
  column(key: string): string;
  /** For counts and totals ("First meetings"); a custom name is used as typed. */
  plural(key: string): string;
  /** `name` for exactly one, `plural` otherwise ("1 First meeting", "5 First meetings"). */
  count(key: string, n: number): string;
  /** For tight spaces on phones ("MG1s"); a custom name is used as typed. */
  short(key: string): string;
  /** The team's shorthand for a built-in name ("MG1"); null for a custom name or none. */
  alias(key: string): string | null;
  /**
   * A board band's heading: a stage's name, or the fixed label of the start
   * and outcome bands ("Start", "Not now").
   */
  band(id: string): string;
  /** `def` with the stages' names (and the names a step can't take) swapped in. */
  board<B extends string>(def: BoardDef<B>): BoardDef<B>;
}

const BAND_LABEL: Record<StagePipeline, Record<string, string>> = {
  recruiting: RECRUITING_BAND_LABEL,
  customer: CUSTOMER_BAND_LABEL,
};

export function makeStageNames(
  pipeline: StagePipeline,
  resolved: Record<string, ResolvedStage>,
): StageNames {
  const stages = Object.values(resolved);
  const boards = new WeakMap<object, BoardDef<string>>();
  const api: StageNames = {
    pipeline,
    stages,
    name: (key) => resolved[key]?.name ?? key,
    column: (key) => resolved[key]?.column ?? key,
    plural: (key) => resolved[key]?.plural ?? key,
    count: (key, n) => (n === 1 ? api.name(key) : api.plural(key)),
    short: (key) => resolved[key]?.short ?? key,
    alias: (key) => resolved[key]?.alias ?? null,
    band: (id) => resolved[id]?.name ?? BAND_LABEL[pipeline][id] ?? id,
    board: <B extends string>(def: BoardDef<B>): BoardDef<B> => {
      const hit = boards.get(def);
      if (hit) return hit as BoardDef<B>;
      const custom = stages.filter((s) => s.source !== "default").map((s) => s.name);
      const next: BoardDef<B> = {
        ...def,
        bands: def.bands.map((b) => (b.kind === "milestone" ? { ...b, label: api.name(b.id) } : b)),
        milestoneColumnLabel: Object.fromEntries(
          def.milestones.map((m) => [m, api.column(m)]),
        ) as BoardDef<B>["milestoneColumnLabel"],
        reserved: [...def.reserved, ...custom],
      };
      boards.set(def, next as BoardDef<string>);
      return next;
    },
  };
  return api;
}

const DEFAULTS: Partial<Record<StagePipeline, StageNames>> = {};

/** The built-in names, for code that has no viewer (tests, pure rules called without one). */
export function defaultStageNames(pipeline: StagePipeline): StageNames {
  return (DEFAULTS[pipeline] ??= makeStageNames(pipeline, resolveStageNames([], [])[pipeline]));
}

let liveStageNames: ((pipeline: StagePipeline) => StageNames) | null = null;

/** hooks.ts registers the viewer's names here once the app loads it. */
export function registerStageNamesSource(fn: (pipeline: StagePipeline) => StageNames) {
  liveStageNames = fn;
}

/**
 * The signed-in person's names for plain data modules (rules, goals) that can't
 * import the hooks: those pull in the session and stores, which the Node seed
 * generator can't load. Built-in names until the app has registered its source.
 */
export function currentStageNames(pipeline: StagePipeline): StageNames {
  return (liveStageNames ?? defaultStageNames)(pipeline);
}
