import {
  stageNameErrors,
  type StageNameDraft,
  type StageNameRow,
  type StagePipeline,
} from "@/data";

/**
 * Pure rules for renaming one stage in place (the rows and the saved write
 * are in `@/data/stageNames`; the checks are the same `stageNameErrors`).
 */

/** The person's own names as they stand, with one stage's typed name put in. */
export function draftWith(
  rows: readonly Pick<StageNameRow, "key" | "own">[],
  key: string,
  typed: string,
): StageNameDraft {
  const draft: StageNameDraft = Object.fromEntries(rows.map((r) => [r.key, r.own]));
  draft[key] = typed;
  return draft;
}

/**
 * What to store as the person's own name for a stage after they typed
 * `typed`: the trimmed name, "" to clear it (back to the inherited or
 * built-in name), or null when nothing changes. Typing the name already
 * shown, when it isn't their own, changes nothing.
 */
export function nextOwnName(
  row: Pick<StageNameRow, "own" | "effective">,
  typed: string,
): string | null {
  const next = typed.trim();
  if (next === row.own) return null;
  if (row.own === "" && (next === "" || next === row.effective.name)) return null;
  return next;
}

/**
 * The message to show next to a stage's field for `typed`, or null when it
 * can be saved: too long, the name of a column or of another stage. When
 * clearing a name puts back one that another stage's own name now clashes
 * with, the message is shown on the stage being edited.
 */
export function stageEditError(
  pipeline: StagePipeline,
  rows: readonly StageNameRow[],
  reserved: readonly string[],
  key: string,
  typed: string,
): string | null {
  const errors = stageNameErrors(
    pipeline,
    draftWith(rows, key, typed),
    Object.fromEntries(rows.map((r) => [r.key, r.inherited])),
    reserved,
  );
  return errors[key] ?? Object.values(errors)[0] ?? null;
}
