/**
 * Data access layer. Pages read and write ONLY through this module.
 *
 * Today every hook is backed by the Zustand stores in src/stores (persisted to
 * localStorage). Later each hook will be re-implemented on Supabase with the
 * same signature, so:
 *   - hooks return plain objects/arrays (never store instances),
 *   - writes are plain functions (fire-and-forget today; treat as async-safe),
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
  setLearningGoal,
  setContactSettings,
} from "./crm";

// Activity timeline
export { useActivity, useEventActivity } from "./activity";

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
export type { CrmEvent, EventType } from "@/stores/eventsStore";
export type { Attendance, DesireLevel, TicketType } from "@/stores/attendanceStore";
export type {
  Contact,
  ContactSource,
  Learning,
  LearningKind,
  LearningGoal,
  Sale,
  Settings as ContactSettings,
} from "@/stores/crmStore";
export type { ActivityEvent, ActivityKind } from "@/stores/activityStore";
export type { DemoUser, Role } from "@/stores/sessionStore";
