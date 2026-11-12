import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  bestLearningStreak,
  learningStreak,
  localDate,
  useLearning,
  useWeeklyGoal,
  useContactSettings,
  useCurrentUser,
  useDoNotContactIds,
  useDueBookings,
  useEvents,
  useLastContactMap,
  useMissedFollowUps,
  useAllEventCategories,
  useReferralReminders,
  useSales,
  useVisibleAttendances,
  useVisiblePeople,
} from "@/data";
import { buildTodayItems, type TodayItem } from "./today";
import { weekDays } from "./learning";

// "Not now" on an "Invite your customers" suggestion: event ids put off, per
// viewer and device (a convenience, so it lives in localStorage).
const invitesKey = (personId: string) => `levelup.today.invitesOff.${personId}`;
const inviteListeners = new Set<() => void>();
const NO_IDS: ReadonlySet<string> = new Set();
const inviteCache = new Map<string, { raw: string | null; ids: ReadonlySet<string> }>();

function readInvitesOff(personId: string): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(invitesKey(personId));
  } catch {
    return NO_IDS;
  }
  const hit = inviteCache.get(personId);
  if (hit && hit.raw === raw) return hit.ids;
  let ids: ReadonlySet<string> = NO_IDS;
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) ids = new Set(list.filter((x) => typeof x === "string"));
  } catch {
    // Unreadable: start over.
  }
  inviteCache.set(personId, { raw, ids });
  return ids;
}

/** Events whose customer-invite suggestion the viewer put off, and "Not now". */
export function useInvitesOff(personId: string) {
  const ids = useSyncExternalStore(
    (cb) => {
      inviteListeners.add(cb);
      return () => inviteListeners.delete(cb);
    },
    () => readInvitesOff(personId),
  );
  const putOff = useCallback(
    (eventId: string) => {
      // Keep the list short: only the latest few.
      const next = [...readInvitesOff(personId), eventId].slice(-50);
      try {
        localStorage.setItem(invitesKey(personId), JSON.stringify(next));
      } catch {
        // Private mode: it just shows again next time.
      }
      inviteListeners.forEach((cb) => cb());
    },
    [personId],
  );
  return { ids, putOff };
}

/** The ranked Today list for the current user. */
export function useTodayItems(): TodayItem[] {
  const user = useCurrentUser();
  const people = useVisiblePeople();
  const lastContact = useLastContactMap();
  const settings = useContactSettings();
  const events = useEvents();
  const attendances = useVisibleAttendances();
  const sales = useSales();
  const doNotContact = useDoNotContactIds();
  const missed = useMissedFollowUps();
  const categories = useAllEventCategories();
  const bookings = useDueBookings();
  const referrals = useReferralReminders();
  const { ids: dismissedInvites } = useInvitesOff(user.personId);
  return useMemo(
    () =>
      buildTodayItems({
        viewerId: user.personId,
        role: user.role,
        people,
        lastContact,
        settings,
        events,
        attendances,
        sales,
        doNotContact,
        missed,
        categories,
        bookings,
        referrals,
        dismissedInvites,
      }),
    [
      user,
      people,
      lastContact,
      settings,
      events,
      attendances,
      sales,
      doNotContact,
      missed,
      categories,
      bookings,
      referrals,
      dismissedInvites,
    ],
  );
}

/** Streak + weekly goal numbers for one person (the viewer). */
export function useMyLearning(personId: string) {
  const entries = useLearning(personId);
  const weekly = useWeeklyGoal(personId);
  return useMemo(() => {
    const today = localDate();
    return {
      entries,
      goal: weekly.goal,
      /** Each goal item with this week's total. */
      goalItems: weekly.items,
      streak: learningStreak(entries),
      best: bestLearningStreak(entries),
      loggedToday: entries.some((e) => e.date === today),
      days: weekDays(entries, today),
      progress: weekly.progress,
    };
  }, [entries, weekly]);
}

export type MyLearning = ReturnType<typeof useMyLearning>;
