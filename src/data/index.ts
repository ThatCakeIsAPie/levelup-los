/**
 * Data access layer. Pages read and write ONLY through this module.
 *
 * Every hook is backed by the Zustand stores in src/stores, in both data
 * sources (src/lib/config.ts):
 *   - "local" (GitHub Pages demo): the stores persist to localStorage and are
 *     seeded with demo data;
 *   - "supabase": the stores live in memory, are filled from Postgres after
 *     sign-in, and src/data/remote writes every change back (optimistic, rolled
 *     back with a toast on failure) and merges realtime changes.
 * So:
 *   - hooks return plain objects/arrays (never store instances),
 *   - writes are plain functions (fire-and-forget; they apply at once and are
 *     saved in the background),
 *   - visibility rules from ./access are already applied: anything a hook
 *     returns is something the current user may see; a non-visible id behaves
 *     exactly like a missing one.
 *
 * Do not import from src/stores/* in pages; add a hook here instead.
 */

// Visibility rules (pure)
export {
  downlineIds,
  visibleIdSet,
  visiblePeople,
  visibleCustomers,
  canSeePerson,
  filterAttendances,
  sponsorChain,
  downlineOf,
  type Viewer,
} from "./access";

// Navigation badges (chat feature)
export { useUnreadChatsCount, useUnreadInboxCount } from "./badges";

// Chats, notifications, announcements, attachments (src/data/chat)
export * from "./chat";

// Recruiting pipeline: board, activity goal, conversions, stat sharing (src/data/pipeline)
export * from "./pipeline";

// Hot / Warm / Cold for new contacts (lists and the recruiting board)
export * from "./rating";

// Your list and the customer pipeline (src/data/customerPipeline)
export * from "./customerPipeline";

// Referral sources and "Referred by" on both pipelines (src/data/referrals)
export * from "./referrals";

// Library: All talks catalog, channels, progress (src/data/library)
export * from "./library";

// Growth path: milestone engine, monthly PV, hand-marked milestones (src/data/growth)
export * from "./growth";

// How people join events, quick attendance, missed-event follow-ups (src/data/eventTypes)
export * from "./eventTypes";

// Event categories: the team's own kinds of event (src/data/eventCategories)
export * from "./eventCategories";

// Unlocks (what each person sees), feature switches, leader deputies (src/data/team)
export * from "./team";
export {
  computeUnlocks,
  unlockStage,
  routeAccess,
  NEXT_UNLOCK_TEXT,
  type Unlocks,
  type UnlockArea,
  type UnlockInput,
  type UnlockStage,
  type NextUnlock,
  type LockReason,
  type RouteAccess,
} from "./unlocks";

// Session
export {
  useSession,
  useCurrentUser,
  useMe,
  useViewer,
  getViewer,
  login,
  logout,
  resetDemo,
} from "./session";

// People
export {
  useVisibleIds,
  useVisiblePeople,
  useVisibleTeam,
  usePerson,
  getPerson,
  useVisibleCustomers,
  useCustomersOf,
  useCustomerCounts,
  useSponsorChain,
  useDownline,
  addPerson,
  updatePerson,
  updatePeople,
  removePerson,
  syncPeopleFromLos,
  getPersonByLosUid,
} from "./people";
export { syncLosEntries, type LosSyncEntry } from "./losSync";
export { rosterWithout, opsWithoutPerson, opsWithoutEvent } from "./cascade";

// Events + attendance
export {
  isUpcoming,
  useEvents,
  useUpcomingEvents,
  usePastEvents,
  useNextEvent,
  useEvent,
  useAttendancesForEvent,
  useAttendancesForPerson,
  useVisibleAttendances,
  useEventsAttentionCount,
  addEvent,
  updateEvent,
  removeEvent,
  assignToEvent,
  updateAttendance,
  removeAttendance,
  bulkUpdateAttendances,
} from "./events";
export {
  attentionItems,
  upcomingAttentionCount,
  needsTicket,
  type AttentionCode,
  type AttentionItem,
  type AttentionEvent,
} from "./attention";

// Contacts, sales, learning
export {
  useContacts,
  useLastContactMap,
  useLastContact,
  useContactSettings,
  useSales,
  useLearning,
  useTeamLearning,
  useLearningGoal,
  logContact,
  removeContact,
  logLearning,
  removeLearning,
  logSale,
  removeSale,
  setContactSettings,
} from "./crm";

// The weekly goal: categories, counting, back-compat (src/data/weeklyGoal.ts)
export { useWeeklyGoal, setLearningGoal } from "./weeklyGoalHooks";
export {
  GOAL_CATEGORIES,
  GOAL_KINDS,
  MAX_GOAL_TARGET,
  goalCategory,
  goalProgress,
  goalUnit,
  goalWeek,
  addableCategories,
  newGoalItem,
  validTarget,
  itemLine,
  type GoalCategory,
  type GoalItem,
  type GoalItemProgress,
  type GoalKind,
  type GoalRequirement,
  type GoalUnitOption,
  type WeeklyGoalView,
} from "./weeklyGoal";

// Activity timeline
export { useActivity, useEventActivity } from "./activity";
export {
  HOME_CARDS,
  HOME_CARD_LABEL,
  arrangeHome,
  moveHomeCard,
  nudgeHomeCard,
  resolveLayout,
  sameLayout,
  sanitizeLayout,
  type HomeArrangement,
  type HomeCardId,
  type HomeColumn,
  type HomeLayout,
} from "./homeLayout";
export { useHomeLayout, setHomeLayout, resetHomeLayout } from "./homeLayoutHooks";
export { useMyDay, myDayItems, type MyDayItem, type MyDayKind, type MyDayInput } from "./myDay";

// Wallet, shared costs, travel, campaigns, report schedules
export {
  useSharedCosts,
  useCostSplit,
  useCostOrganizerName,
  useMyInvoices,
  useVisibleInvoices,
  useLogistics,
  useMyCampaigns,
  useMyReportSchedule,
  setLogistics,
  addSharedCost,
  toggleCostOptIn,
  setCostOverride,
  paySandbox,
  addCampaign,
  setReportSchedule,
  splitCost,
  invoicesFor,
  type Campaign,
  type Invoice,
  type Logistics,
  type Payment,
  type ReportSchedule,
  type SharedCost,
} from "./ops";

// UI: global Log sheet
export { useUiStore, openLog, closeLog, type LogTab } from "@/stores/uiStore";

// Pure helpers and labels (safe to use with hook results)
export {
  lastContactDate,
  lastSale,
  learningStreak,
  bestLearningStreak,
  learningGoalFor,
  learningUnit,
  learningLine,
  unitAmount,
  DEFAULT_LEARNING_GOAL,
  DEFAULT_SETTINGS,
} from "@/stores/crmStore";
export { daysSince, daysFromToday, localDate, parseDate } from "@/lib/dates";
export {
  bizClassLabel,
  bizClassShort,
  effectiveBizClass,
  apprenticeAlertLevel,
  apprenticeAlertLabel,
  missingRequiredFields,
  personPath,
  isCustomer,
} from "@/stores/peopleStore";
export { DEMO_USERS, roleLabel } from "@/stores/sessionStore";
export {
  getPersonShowRate,
  getEventFunnel,
  getRiskFlags,
  getUpcomingFollowUps,
  getAuditDelta,
  getComparisonEvents,
  attendanceStatusLabel,
  type AuditDeltaRow,
} from "@/lib/selectors";

// Types
export type {
  CrmPerson,
  BizClass,
  PipelineStage,
  PersonPath,
  ApprenticeAlert,
} from "@/stores/peopleStore";
export type { CrmEvent, EventFormat } from "@/stores/eventsStore";
export type {
  Attendance,
  AttendMode,
  DesireLevel,
  MissedEventNote,
} from "@/stores/attendanceStore";
export type {
  Contact,
  ContactSource,
  Learning,
  LearningKind,
  LearningGoal,
  LearningUnit,
  ReadingUnit,
  PodcastUnit,
  Sale,
  Settings as ContactSettings,
} from "@/stores/crmStore";
export type { ActivityEvent, ActivityKind } from "@/stores/activityStore";
export type { DemoUser, Role } from "@/stores/sessionStore";
