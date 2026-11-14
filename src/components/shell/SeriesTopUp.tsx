import { useEffect } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { useSessionStore } from "@/stores/sessionStore";
import { topUpSeries, useEventSeriesList } from "@/data";

/** How often an open app checks again (it also checks when the window is shown again). */
const EVERY_MS = 30 * 60 * 1000;

/**
 * Keeps repeating events filled ahead (src/data/recurrence): when someone signs in, whenever the
 * team's events or series are loaded again, when the window comes back and every half hour. An idle
 * team gets its next occurrences as soon as anyone opens the app. Renders nothing.
 */
export function SeriesTopUp() {
  const signedIn = useSessionStore((s) =>
    IS_SUPABASE ? s.status === "ready" && !!s.user : !!s.user,
  );
  // A new list of series arrives with every load of the team's data.
  const series = useEventSeriesList();
  useEffect(() => {
    if (!signedIn) return;
    void topUpSeries();
  }, [signedIn, series]);
  useEffect(() => {
    if (!signedIn) return;
    const again = () => {
      if (document.visibilityState === "visible") void topUpSeries();
    };
    document.addEventListener("visibilitychange", again);
    const timer = setInterval(again, EVERY_MS);
    return () => {
      document.removeEventListener("visibilitychange", again);
      clearInterval(timer);
    };
  }, [signedIn]);
  return null;
}
