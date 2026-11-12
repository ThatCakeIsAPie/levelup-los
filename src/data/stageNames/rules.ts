/**
 * Renaming the pipelines' major stages (pure rules; no stores, no React).
 *
 * Both pipelines have four fixed top-level stages with internal keys (the
 * milestone codes). Their meaning, order and behaviour never change; only the
 * name a person sees can. Each person may set their own name for any stage of
 * either pipeline, and the name a viewer sees for a stage is, per pipeline and
 * per stage independently:
 *
 *   1. the viewer's own custom name, if they set one; else
 *   2. the custom name set by the NEAREST person above them in the sponsor line
 *      (walking up sponsor by sponsor) who set one; else
 *   3. the built-in default name.
 *
 * Never write a stage name in UI code: get it from `useStageNames(pipeline)`
 * (React) or `getStageNames(pipeline)` (everything else) in "@/data".
 */
import { CUSTOMER_MILESTONE_LABEL, CUSTOMER_MILESTONES } from "../customerPipeline/types";
import {
  MILESTONE_COLUMN_LABEL,
  MILESTONE_LABEL,
  MILESTONES,
  type BoardDef,
} from "../pipeline/types";

export type StagePipeline = "recruiting" | "customer";

export const STAGE_PIPELINES: readonly StagePipeline[] = ["recruiting", "customer"];

/** The stage keys of each pipeline, in board order (the milestone codes). */
export const STAGE_KEYS: Record<StagePipeline, readonly string[]> = {
  recruiting: MILESTONES,
  customer: CUSTOMER_MILESTONES,
};

/** Longest custom stage name. */
export const MAX_STAGE_NAME = 30;

/** Walking up the sponsor line stops after this many people (cycle and runaway guard). */
export const MAX_SPONSOR_DEPTH = 50;

/** One custom name: `personId` calls `stage` of `pipeline` this. */
export interface StageNameEntry {
  personId: string;
  pipeline: StagePipeline;
  stage: string;
  name: string;
}

export const isStagePipeline = (v: unknown): v is StagePipeline =>
  v === "recruiting" || v === "customer";

export const isStageKey = (pipeline: StagePipeline, key: string): boolean =>
  STAGE_KEYS[pipeline].includes(key);

/** The built-in forms of a stage's name (the only place they are written out besides the board types). */
export interface DefaultStageName {
  /** For sentences, chips, menus and headings. */
  name: string;
  /** For the column header: the recruiting board's first two carry the team's shorthand. */
  column: string;
  /** For counts ("First meetings"). */
  plural: string;
  /** For tight spaces on phones ("MG1s"). */
  short: string;
  /** The team's shorthand for it ("MG1"), if it has one. */
  alias: string | null;
}

const DEFAULT_FORMS: Record<
  StagePipeline,
  Record<string, Pick<DefaultStageName, "plural" | "short" | "alias">>
> = {
  recruiting: {
    contact: { plural: "Contacts made", short: "Contacts", alias: null },
    first_meeting: { plural: "First meetings", short: "MG1s", alias: "MG1" },
    first_plan: { plural: "First plans", short: "Plans", alias: "Info 1" },
    registered: { plural: "Registered", short: "Registered", alias: null },
  },
  customer: {
    contact: { plural: "Contacts", short: "Contacts", alias: null },
    first_meeting: { plural: "First meetings", short: "Meetings", alias: null },
    first_sale: { plural: "First sales", short: "Sales", alias: null },
    on_ditto: { plural: "On Ditto", short: "Ditto", alias: null },
  },
};

export function defaultStageName(pipeline: StagePipeline, key: string): DefaultStageName {
  const forms = DEFAULT_FORMS[pipeline][key] ?? { plural: key, short: key, alias: null };
  if (pipeline === "recruiting") {
    const k = key as keyof typeof MILESTONE_LABEL;
    return { name: MILESTONE_LABEL[k] ?? key, column: MILESTONE_COLUMN_LABEL[k] ?? key, ...forms };
  }
  const k = key as keyof typeof CUSTOMER_MILESTONE_LABEL;
  const name = CUSTOMER_MILESTONE_LABEL[k] ?? key;
  return { name, column: name, ...forms };
}

/** Where a name a viewer sees comes from. */
export type StageNameSource = "own" | "upline" | "default";

export interface ResolvedStage {
  pipeline: StagePipeline;
  key: string;
  /** What this viewer sees: in sentences, menus, chips and headings. */
  name: string;
  /** The same for a column header (differs from `name` only for the defaults). */
  column: string;
  /** For counts: a custom name is used as typed. */
  plural: string;
  /** For tight spaces: a custom name is used as typed. */
  short: string;
  /** The team's shorthand ("MG1"): only the built-in name has one. */
  alias: string | null;
  /** The built-in name. */
  defaultName: string;
  source: StageNameSource;
  /** The person whose name it is (the viewer for "own"); null for the default. */
  fromId: string | null;
  /** Their name, when known. */
  fromName: string | null;
}

export type ResolvedStages = Record<StagePipeline, Record<string, ResolvedStage>>;

/**
 * The sponsor line of `personId`, the person first, then their sponsor, then
 * that sponsor's sponsor … Stops at the top, at a repeated person (a cycle) or
 * after `maxDepth` people.
 */
export function sponsorLine(
  sponsorOf: (id: string) => string | null | undefined,
  personId: string,
  maxDepth: number = MAX_SPONSOR_DEPTH,
): string[] {
  const line = [personId];
  const seen = new Set(line);
  let cur = sponsorOf(personId);
  while (cur && !seen.has(cur) && line.length < maxDepth) {
    seen.add(cur);
    line.push(cur);
    cur = sponsorOf(cur);
  }
  return line;
}

/**
 * Resolve every stage of both pipelines for the first person in `line`
 * (viewer first, then their sponsors upward). `nameOf` names the person a
 * custom name comes from.
 */
export function resolveStageNames(
  line: readonly string[],
  entries: readonly StageNameEntry[],
  nameOf: (personId: string) => string | undefined = () => undefined,
): ResolvedStages {
  const byPerson = new Map<string, Map<string, string>>();
  for (const e of entries) {
    if (!isStageKey(e.pipeline, e.stage)) continue;
    const name = e.name.trim();
    if (!name) continue;
    let m = byPerson.get(e.personId);
    if (!m) byPerson.set(e.personId, (m = new Map()));
    m.set(`${e.pipeline}:${e.stage}`, name);
  }
  const out = { recruiting: {}, customer: {} } as ResolvedStages;
  for (const pipeline of STAGE_PIPELINES) {
    for (const key of STAGE_KEYS[pipeline]) {
      const def = defaultStageName(pipeline, key);
      let hit: { id: string; name: string } | null = null;
      for (const id of line) {
        const name = byPerson.get(id)?.get(`${pipeline}:${key}`);
        if (name) {
          hit = { id, name };
          break;
        }
      }
      const own = hit && hit.id === line[0];
      out[pipeline][key] = {
        pipeline,
        key,
        name: hit?.name ?? def.name,
        column: hit?.name ?? def.column,
        plural: hit?.name ?? def.plural,
        short: hit?.name ?? def.short,
        alias: hit ? null : def.alias,
        defaultName: def.name,
        source: !hit ? "default" : own ? "own" : "upline",
        fromId: hit?.id ?? null,
        fromName: hit ? (nameOf(hit.id) ?? null) : null,
      };
    }
  }
  return out;
}

/** The stages as the viewer would see them with no custom name of their own. */
export function inheritedStageNames(
  line: readonly string[],
  entries: readonly StageNameEntry[],
  nameOf?: (personId: string) => string | undefined,
): ResolvedStages {
  return resolveStageNames(line.slice(1), entries, nameOf);
}

/** "Default" or "From Maria Reyes": where an inherited name comes from. */
export function stageSourceHint(stage: ResolvedStage): string {
  if (stage.source === "default") return "Default";
  return stage.fromName ? `From ${stage.fromName}` : "From your upline";
}

// ---------------------------------------------------------------------------
// Validation (what the Customize steps dialog and the save check)
// ---------------------------------------------------------------------------

/** What the person typed per stage key; empty = "not set by me". */
export type StageNameDraft = Record<string, string>;

/**
 * Names a stage can't take: the board's start and outcome columns (they'd read
 * as the same column). The built-in stage names are fine: a person may put a
 * name back, or swap two.
 */
export function reservedStageNames(def: Pick<BoardDef<string>, "fixed" | "bands">): string[] {
  return [
    ...def.fixed.map((f) => f.label),
    ...def.bands.filter((b) => b.kind !== "milestone").map((b) => b.label),
  ];
}

/**
 * Why a draft can't be saved, per stage key (keys without a problem are
 * missing from the result). A name is trimmed and 1 to MAX_STAGE_NAME
 * characters; an empty field means "not set by me" and is always fine. After
 * resolution (the typed name, else the inherited one) no two stages of the
 * pipeline may end up with the same name for this person, compared without
 * regard to case and to extra spaces.
 */
export function stageNameErrors(
  pipeline: StagePipeline,
  draft: StageNameDraft,
  inherited: Record<string, ResolvedStage>,
  reserved: readonly string[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const effective = new Map<string, string>();
  for (const key of STAGE_KEYS[pipeline]) {
    const typed = (draft[key] ?? "").trim();
    if (typed.length > MAX_STAGE_NAME) {
      errors[key] = `Keep it to ${MAX_STAGE_NAME} characters.`;
      continue;
    }
    effective.set(key, typed || (inherited[key]?.name ?? defaultStageName(pipeline, key).name));
  }
  const reservedSet = new Set(reserved.map(norm));
  const seen = new Map<string, string>();
  for (const [key, name] of effective) {
    const n = norm(name);
    const typed = (draft[key] ?? "").trim();
    if (typed && reservedSet.has(n)) {
      errors[key] = "That's already the name of a column.";
      continue;
    }
    const other = seen.get(n);
    if (other !== undefined) {
      // Blame a field the person typed in; two inherited names that clash aren't theirs to fix.
      const blame = typed ? key : (draft[other] ?? "").trim() ? other : null;
      if (blame) errors[blame] ??= "Another stage already has that name.";
      continue;
    }
    seen.set(n, key);
  }
  return errors;
}

/** The entries one person holds for one pipeline as a draft (stage key -> name). */
export function draftOf(
  entries: readonly StageNameEntry[],
  personId: string,
  pipeline: StagePipeline,
): StageNameDraft {
  const out: StageNameDraft = {};
  for (const e of entries) {
    if (e.personId === personId && e.pipeline === pipeline && isStageKey(pipeline, e.stage))
      out[e.stage] = e.name;
  }
  return out;
}
