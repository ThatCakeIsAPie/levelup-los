/**
 * The team's time zone: the zone an event's wall-clock start and end time are in (src/data/eventTimes).
 *
 *  - Real accounts: `workspaces.timezone`, loaded with the rest of the team after sign-in
 *    (src/data/remote/hydrate.ts).
 *  - Browser-storage demo: there is no team zone, so the browser's own.
 *
 * It is only needed where a time becomes a point in time: the "Add to calendar" file and link.
 */
import { useMemo } from "react";
import { create } from "zustand";

interface State {
  timezone: string | null;
}

export const useWorkspaceTimezoneStore = create<State>()(() => ({ timezone: null }));

/** Whether `tz` is a time zone this browser knows. */
export function isTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const browserZone = (): string => {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimezone(tz) ? tz : "UTC";
};

/** Sets the zone the signed-in team uses (null forgets it, on sign-out). */
export function setWorkspaceTimezone(tz: string | null | undefined): void {
  useWorkspaceTimezoneStore.setState({ timezone: isTimezone(tz) ? tz : null });
}

/** The team's time zone (an IANA name such as "America/Chicago"), non-reactive. */
export function getWorkspaceTimezone(): string {
  return useWorkspaceTimezoneStore.getState().timezone ?? browserZone();
}

/** The team's time zone, reactive. */
export function useWorkspaceTimezone(): string {
  const tz = useWorkspaceTimezoneStore((s) => s.timezone);
  return useMemo(() => tz ?? browserZone(), [tz]);
}
