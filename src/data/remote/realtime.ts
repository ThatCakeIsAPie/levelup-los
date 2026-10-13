/**
 * Live chat ("supabase" mode): one Realtime channel per signed-in person,
 * following the chat tables in the `supabase_realtime` publication. Row-level
 * security applies per subscriber, so only rows the person may read arrive.
 *
 * `subscribeChanges` is store-free (the integration tests use it directly);
 * src/data/remote/index.ts merges the changes into the stores.
 */
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "./rows";

/** Tables followed live (see migrations ...0900 and 20261013000100). */
export const LIVE_TABLES = [
  "messages",
  "reactions",
  "mentions",
  "attachments",
  "notifications",
  "conversation_members",
  "conversations",
  "announcement_drafts",
  "reports",
] as const;
export type LiveTable = (typeof LIVE_TABLES)[number];

export interface LiveChange {
  table: LiveTable;
  type: "INSERT" | "UPDATE" | "DELETE";
  /** The new row (INSERT / UPDATE). */
  row: Row | null;
  /** The old row's primary key (DELETE). */
  old: Row | null;
}

export interface LiveHandlers {
  onChange: (change: LiveChange) => void;
  /**
   * Subscribed. `resumed` is true after a reconnect: changes may have been
   * missed while offline, so the caller should refetch.
   */
  onSubscribed?: (resumed: boolean) => void;
  onError?: (status: string, error?: Error) => void;
}

/** Follow the live tables; returns the unsubscribe function. */
export function subscribeChanges(
  client: SupabaseClient,
  name: string,
  handlers: LiveHandlers,
): () => void {
  let channel: RealtimeChannel = client.channel(name);
  for (const table of LIVE_TABLES) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload: {
        eventType: "INSERT" | "UPDATE" | "DELETE";
        new: Record<string, unknown>;
        old: Record<string, unknown>;
      }) => {
        const row = payload.new && Object.keys(payload.new).length ? payload.new : null;
        const old = payload.old && Object.keys(payload.old).length ? payload.old : null;
        handlers.onChange({ table, type: payload.eventType, row, old });
      },
    );
  }
  let subscribedOnce = false;
  channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      handlers.onSubscribed?.(subscribedOnce);
      subscribedOnce = true;
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      handlers.onError?.(status, err);
    }
  });
  return () => {
    void client.removeChannel(channel);
  };
}
