/**
 * Growth path public API (re-exported from "@/data"): the milestone engine
 * (pure, ./engine), hooks, and the upline's writes (monthly PV, hand marks).
 * Overrides and marks live in the CRM store (`pvOverrides`, `milestoneMarks`).
 */
export * from "./types";
export {
  GROWTH_MILESTONES,
  GROUP_PV_INCLUDES_OWN,
  growthMilestone,
  growthLabel,
  growthIndex,
  isGrowthCode,
} from "./milestones";
export {
  growthPath,
  hasReachedMilestone,
  monthPv,
  monthOfDate,
  daysInMonth,
  registeredOn,
  saleSellerId,
  isPersonalOrder,
  isRegistered,
  type GrowthInput,
} from "./engine";
export {
  useGrowthPath,
  useMyGrowthPath,
  getGrowthPath,
  hasReached,
  useHasReached,
  useMonthPv,
  useMonthPvById,
  useCanCoach,
  canCoach,
} from "./hooks";
export { setMonthPv, markMilestoneReached } from "./mutations";
