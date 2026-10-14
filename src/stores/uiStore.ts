import { create } from "zustand";

/** Tabs of the global Log sheet (src/components/log/LogSheet.tsx). */
export type LogTab = "learning" | "checkin" | "customer" | "sale" | "attendance";

export interface LogSheetState {
  open: boolean;
  /** Tab to show when opened (defaults to "learning"). */
  tab?: LogTab;
  /** Preselect this person (team member for check-in, customer for contact/sale). */
  personId?: string;
}

interface UiState {
  logSheet: LogSheetState;
  /** Open the Log sheet, optionally on a tab and/or for a person. */
  openLog: (opts?: { tab?: LogTab; personId?: string }) => void;
  closeLog: () => void;
}

/** Transient UI state (not persisted). */
export const useUiStore = create<UiState>()((set) => ({
  logSheet: { open: false },
  openLog: (opts) => set({ logSheet: { open: true, tab: opts?.tab, personId: opts?.personId } }),
  closeLog: () => set((s) => ({ logSheet: { ...s.logSheet, open: false } })),
}));

/** Non-hook helpers so any handler can open/close the Log sheet. */
export const openLog = (opts?: { tab?: LogTab; personId?: string }) =>
  useUiStore.getState().openLog(opts);
export const closeLog = () => useUiStore.getState().closeLog();
