/**
 * Renameable pipeline stages (re-exported from "@/data"): every person can
 * name the four major stages of each pipeline for themselves and their
 * downline. Rule: ./rules. Hooks and writes: ./hooks.
 */
export {
  MAX_SPONSOR_DEPTH,
  MAX_STAGE_NAME,
  STAGE_KEYS,
  STAGE_PIPELINES,
  defaultStageName,
  inheritedStageNames,
  isStageKey,
  isStagePipeline,
  reservedStageNames,
  resolveStageNames,
  sponsorLine,
  stageNameErrors,
  stageSourceHint,
  type ResolvedStage,
  type ResolvedStages,
  type StageNameDraft,
  type StageNameEntry,
  type StageNameSource,
  type StagePipeline,
} from "./rules";
export { defaultStageNames, makeStageNames, type StageNames } from "./names";
export {
  getBoardDef,
  getStageNames,
  saveStageNames,
  useBoardDef,
  useStageNameEditor,
  useStageNames,
  type SaveStageNamesResult,
  type StageNameEditor,
  type StageNameRow,
} from "./hooks";
