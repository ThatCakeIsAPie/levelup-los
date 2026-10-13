/**
 * Team settings and unlocks (re-exported from "@/data"): feature switches,
 * leader deputies, and what each person has unlocked (pure rules in
 * ../unlocks.ts).
 */
export * from "./types";
export {
  canEditSwitches,
  canManageDeputies,
  deputiesOf,
  deputyCandidates,
  deputyError,
  deputyOfIds,
  switchMap,
} from "./rules";
export {
  useUnlocks,
  getUnlocks,
  useFeature,
  isFeatureOn,
  useFeatureSwitches,
  useFeatureSwitchRows,
  useCanEditSwitches,
  useActingFor,
  useDeputies,
  type DeputyRow,
} from "./hooks";
export { addDeputy, removeDeputy, setFeatureSwitch } from "./mutations";
