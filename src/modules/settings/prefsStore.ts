/**
 * Notification preferences, saved in this browser under `levelup.prefs`.
 * Module-local on purpose: nothing reads them until push notifications launch,
 * when they move to the user's server-side settings behind @/data.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storageKey } from "@/lib/config";

export type NotifyKey = "mentions" | "replies" | "announcements" | "wins" | "checkins";

export const NOTIFY_OPTIONS: {
  key: NotifyKey;
  label: string;
  description: string;
  /** Only shown to people who can use chats. */
  chat?: boolean;
}[] = [
  {
    key: "mentions",
    label: "Mentions",
    description: "Someone @mentions you in a chat",
    chat: true,
  },
  {
    key: "replies",
    label: "Replies",
    description: "Someone replies to your message",
    chat: true,
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "Leaders post to the whole team",
  },
  {
    key: "wins",
    label: "Wins",
    description: "Teammates share a win",
    chat: true,
  },
  {
    key: "checkins",
    label: "Check-ins",
    description: "Your sponsor checks in with you",
  },
];

interface PrefsState {
  notify: Record<NotifyKey, boolean>;
  setNotify: (key: NotifyKey, on: boolean) => void;
}

const DEFAULT_NOTIFY: Record<NotifyKey, boolean> = {
  mentions: true,
  replies: true,
  announcements: true,
  wins: true,
  checkins: true,
};

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      notify: DEFAULT_NOTIFY,
      setNotify: (key, on) => set((s) => ({ notify: { ...s.notify, [key]: on } })),
    }),
    {
      name: storageKey("prefs"),
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Keep new keys' defaults when an older saved object lacks them.
      merge: (saved, current) => {
        const s = (saved ?? {}) as Partial<PrefsState>;
        return { ...current, notify: { ...DEFAULT_NOTIFY, ...s.notify } };
      },
    },
  ),
);
