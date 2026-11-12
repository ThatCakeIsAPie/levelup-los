/**
 * Referrals (re-exported from "@/data"): the Referral source column on both
 * boards and "Referred by" on prospects, customers and list names.
 */
export {
  REFERRAL_ASK_DAYS,
  linksFor,
  newReferralSources,
  referralError,
  referralIndex,
  referralReminders,
  referralSourcesByStep,
  referralWrites,
  referredLine,
  referrerRef,
  sameRef,
  type Ref,
  type RefKind,
  type ReferralContact,
  type ReferralIndex,
  type ReferralLinks,
  type ReferralReminder,
  type ReferralSourceCard,
} from "./rules";
export {
  useReferralIndex,
  useReferrerOf,
  useReferrals,
  useReferrerChoices,
  useReferralReminders,
  type ReferrerChoice,
} from "./hooks";
export { setReferredBy, type ReferralResult } from "./mutations";
