import { useMemo } from "react";
import {
  bestLearningStreak,
  learningStreak,
  localDate,
  useLearning,
  useLearningGoal,
  useContactSettings,
  useCurrentUser,
  useDoNotContactIds,
  useEvents,
  useLastContactMap,
  useMissedFollowUps,
  useSales,
  useVisibleAttendances,
  useVisiblePeople,
} from "@/data";
import { buildTodayItems, type TodayItem } from "./today";
import { goalProgress, weekDays, weekTotals } from "./learning";

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
      }),
    [user, people, lastContact, settings, events, attendances, sales, doNotContact, missed],
  );
}

/** Streak + goal numbers for one person (the viewer). */
export function useMyLearning(personId: string) {
  const entries = useLearning(personId);
  const goal = useLearningGoal(personId);
  return useMemo(() => {
    const today = localDate();
    const totals = weekTotals(entries, today);
    return {
      entries,
      goal,
      totals,
      streak: learningStreak(entries),
      best: bestLearningStreak(entries),
      loggedToday: entries.some((e) => e.date === today),
      days: weekDays(entries, today),
      progress: goalProgress(totals, goal),
    };
  }, [entries, goal]);
}

export type MyLearning = ReturnType<typeof useMyLearning>;
