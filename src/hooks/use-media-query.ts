import { useCallback, useSyncExternalStore } from "react";

/** Live `window.matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * True at the shell's desktop breakpoint (Tailwind `lg`, 1024px+): sidebar
 * layout. Below it the app uses the phone layout (bottom tab bar + FAB).
 * Prefer responsive classes (`lg:`) for layout; use this only when behavior
 * differs (e.g. which side a sheet opens from).
 */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 1024px)");
}
