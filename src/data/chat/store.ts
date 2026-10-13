/**
 * The chat tables on the client. In the browser-storage demo they persist to
 * localStorage key `levelup.chat`, versioned with the CRM seed so resetDemo and
 * SEED_VERSION bumps re-seed it like every other `levelup.*` store.
 *
 * Pages never import this: they use the hooks and mutations re-exported from
 * "@/data". With real accounts ("supabase" mode) the same store is kept in
 * memory only: src/data/remote fills it from the database after sign-in,
 * writes every change back and merges realtime changes from other people.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { IS_SUPABASE } from "@/lib/config";
import { SEED_VERSION } from "@/data/seed";
import { dataStorage } from "@/stores/storage";
import { clearAttachments } from "./attachments";
import { purgeExpired } from "./rules";
import { seedChat } from "./seed";
import type { ChatData } from "./types";

export const CHAT_STORAGE_KEY = "levelup.chat";
/** Bump when the stored shape changes (resets everyone's chat demo data). */
const CHAT_SCHEMA_VERSION = 2;

type ChatState = ChatData;

/** Drop messages past their chat's retention period, with their child rows. */
export function withoutExpired(s: ChatData, now = Date.now()): ChatData {
  const { keep, removed } = purgeExpired(s.messages, s.conversations, now);
  if (removed.size === 0) return s;
  return {
    ...s,
    messages: keep,
    attachments: s.attachments.filter((a) => !removed.has(a.messageId)),
    reactions: s.reactions.filter((r) => !removed.has(r.messageId)),
    mentions: s.mentions.filter((m) => !removed.has(m.messageId)),
    reports: s.reports.filter((r) => !removed.has(r.messageId)),
    conversations: s.conversations.map((c) =>
      c.pinnedMessageId && removed.has(c.pinnedMessageId) ? { ...c, pinnedMessageId: null } : c,
    ),
  };
}

/** Every chat table, empty (real accounts: filled from the database after sign-in). */
export function emptyChat(): ChatData {
  return {
    members: [],
    conversations: [],
    conversationMembers: [],
    messages: [],
    attachments: [],
    reactions: [],
    mentions: [],
    drafts: [],
    notifications: [],
    reports: [],
    blocks: [],
    library: [],
  };
}

function fresh(): ChatData {
  return IS_SUPABASE ? emptyChat() : seedChat();
}

/** True when no chat data was saved yet (first run or after resetDemo). Demo only. */
export const isFirstRun = (() => {
  if (IS_SUPABASE) return false;
  try {
    return localStorage.getItem(CHAT_STORAGE_KEY) === null;
  } catch {
    return true;
  }
})();
// Fresh seed: drop photos and voice notes left over from before a reset.
if (isFirstRun) void clearAttachments();

export const useChatStore = create<ChatState>()(
  persist(() => fresh(), {
    name: CHAT_STORAGE_KEY,
    storage: dataStorage(),
    version: SEED_VERSION * 100 + CHAT_SCHEMA_VERSION,
    migrate: () => fresh() as unknown as ChatState,
  }),
);

/**
 * Apply retention now (localStorage hydration is synchronous, so the saved
 * data is loaded). With real accounts the database purges nightly and the
 * hooks hide expired messages until then.
 */
export function purgeExpiredMessages(): void {
  if (IS_SUPABASE) return;
  const s = useChatStore.getState();
  const purged = withoutExpired(s);
  if (purged !== s) useChatStore.setState(purged, true);
}
purgeExpiredMessages();

/** Apply an immutable update to the chat tables. */
export function updateChat(fn: (s: ChatData) => Partial<ChatData>): void {
  useChatStore.setState((s) => fn(s));
}

/** Non-reactive snapshot (for mutations and route loaders). */
export const chat = (): ChatData => useChatStore.getState();
