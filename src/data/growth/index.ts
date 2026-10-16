/**
 * Growth path public API (re-exported from "@/data"): the milestone engine
 * (pure, ./engine), hooks, the upline's writes (monthly PV, hand marks) and the
 * milestone history the app records.
 * Overrides, marks and history live in the CRM store (`pvOverrides`,
 * `milestoneMarks`, `milestoneHistory`).
 */
export * from "./types";
export {
  GROWTH_MILESTONES,
  GROUP_PV_INCLUDES_OWN,
  growthMilestone,
  growthLabel,
  growthIndex,
  growthHold,
  isGrowthCode,
} from "./milestones";
export {
  growthPath,
  hasEverReachedMilestone,
  isMilestoneHeld,
  historyUpdates,
  monthPv,
  monthOfDate,
  addMonths,
  lastDayOf,
  daysInMonth,
  registeredOn,
  saleSellerId,
  isPersonalOrder,
  isRegistered,
  teamStructure,
  type TeamStructure,
  type GrowthInput,
  type HistoryUpdate,
} from "./engine";
export {
  useGrowthPath,
  useMyGrowthPath,
  getGrowthPath,
  hasEverReached,
  useHasEverReached,
  isHeld,
  useIsHeld,
  useRecordMilestoneHistory,
  useMonthPv,
  useMonthPvById,
  useCanCoach,
  canCoach,
} from "./hooks";
export { setMonthPv, markMilestoneReached, recordMilestoneHistory } from "./mutations";
