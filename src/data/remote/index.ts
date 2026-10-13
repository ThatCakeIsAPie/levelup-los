/**
 * The database behind the stores ("supabase" mode). The browser-storage demo
 * never calls any of this.
 *
 *   openRemoteSession(person)  after sign-in: load everything the person may
 *                              see, start write-through sync and realtime
 *   closeRemoteSession()       on sign-out: stop, and empty the stores
 *
 * While open:
 *  - every store change made by src/data mutations is written to Postgres
 *    (./engine.ts, ./bindings.ts); failures roll back with a toast;
 *  - chat tables follow Realtime (./realtime.ts);
 *  - CRM, library and pipeline tables are refetched when the window regains
 *    focus, when the connection comes back, and every few minutes (the
 *    pipeline also when a stat request notification arrives).
 */
import { getSupabase } from "@/lib/supabase";
import { usePeopleStore } from "@/stores/peopleStore";
import { useEventsStore } from "@/stores/eventsStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useCrmStore, DEFAULT_SETTINGS } from "@/stores/crmStore";
import { useOpsStore } from "@/stores/opsStore";
import { useActivityStore } from "@/stores/activityStore";
import { emptyChat, useChatStore } from "@/data/chat/store";
import { emptyLibrary, useLibraryStore } from "@/data/library/store";
import { useLibraryExtras } from "@/data/library/extras";
import { emptyPipeline, usePipelineStore } from "@/data/pipeline/store";
import { ALL_BINDINGS } from "./bindings";
import {
  applyRemote,
  isBusy,
  localChangeVersion,
  onWriteError,
  startEngine,
  stopEngine,
  suppressed,
  syncContext,
  whenIdle,
} from "./engine";
import { useRemoteStore } from "./extras";
import { saveFailed, setReconcile } from "./feedback";
import {
  applyChat,
  applyCrm,
  applyLibrary,
  applyPipeline,
  applySnapshot,
  fetchChat,
  fetchCrm,
  fetchDirectory,
  fetchLibrary,
  fetchPipeline,
  fetchRsvpCounts,
  fetchSnapshot,
} from "./hydrate";
import { subscribeChanges, type LiveChange } from "./realtime";

export { whenIdle, serverSide, isBusy } from "./engine";
export { useRemoteStore, directoryById, type DirectoryEntry, type RsvpCounts } from "./extras";
export { saveFailed, SAVE_FAILED } from "./feedback";

/** Refetch CRM data this often while the app is open. */
const REFRESH_EVERY_MS = 3 * 60 * 1000;
/** At most one refetch on focus per this many ms. */
const FOCUS_THROTTLE_MS = 30 * 1000;

let current: { personId: string; stop: () => void } | null = null;

/** The person whose data is loaded, or null. */
export function remotePersonId(): string | null {
  return current?.personId ?? null;
}

/**
 * Load the signed-in person's data and start syncing. Throws (and leaves the
 * stores empty) when the data can't be loaded.
 */
export function openRemoteSession(person: { personId: string; name: string }): Promise<void> {
  // Auth often reports the same sign-in twice in a row: share the load.
  if (opening?.personId === person.personId) return opening.promise;
  const token = ++openToken;
  const promise = open(person, token).finally(() => {
    if (opening?.promise === promise) opening = null;
  });
  opening = { personId: person.personId, promise };
  return promise;
}

let opening: { personId: string; promise: Promise<void> } | null = null;
let openToken = 0;

async function open(person: { personId: string; name: string }, token: number): Promise<void> {
  closeRemoteSession(false);
  useRemoteStore.setState({ phase: "loading" });
  const client = getSupabase();
  let snapshot;
  try {
    snapshot = await fetchSnapshot(client, person.personId);
  } catch (e) {
    if (token === openToken) useRemoteStore.setState({ phase: "error" });
    throw e;
  }
  // A newer sign-in (or a sign-out) happened meanwhile.
  if (token !== openToken) return;
  startEngine({ client, me: person.personId, myName: person.name }, ALL_BINDINGS);
  applySnapshot(snapshot);

  const stopLive = subscribeChanges(client, `levelup-sync:${person.personId}`, {
    onChange: onLiveChange,
    // After a reconnect, changes may have been missed: catch up.
    onSubscribed: (resumed) =>
      resumed && scheduleRefresh(["chat", "crm", "library", "pipeline", "directory", "counts"]),
    onError: (status, err) => console.warn(`[realtime] ${status}`, err ?? ""),
  });

  const onFocus = () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - lastFocusRefresh < FOCUS_THROTTLE_MS) return;
    lastFocusRefresh = Date.now();
    scheduleRefresh(["crm", "chat", "library", "pipeline", "directory", "counts"]);
  };
  const onOnline = () =>
    scheduleRefresh(["crm", "chat", "library", "pipeline", "directory", "counts"]);
  let lastFocusRefresh = Date.now();
  const timer = setInterval(
    () => scheduleRefresh(["crm", "library", "pipeline", "directory", "counts"]),
    REFRESH_EVERY_MS,
  );
  // (No window in the Node integration tests.)
  const browser = typeof window !== "undefined" && typeof document !== "undefined";
  if (browser) {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
  }

  current = {
    personId: person.personId,
    stop: () => {
      stopLive();
      clearInterval(timer);
      if (browser) {
        window.removeEventListener("focus", onFocus);
        document.removeEventListener("visibilitychange", onFocus);
        window.removeEventListener("online", onOnline);
      }
    },
  };
  useRemoteStore.setState({ phase: "ready" });
}

/**
 * Stop syncing and empty every store (sign-out, or another account signs in).
 * The engine stops first, and the stores are emptied as a server-side change,
 * so emptying them can never be sent as deletes.
 */
export function closeRemoteSession(cancelLoading = true): void {
  if (cancelLoading) {
    openToken++;
    opening = null;
  }
  current?.stop();
  current = null;
  stopEngine();
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = undefined;
  pendingScopes.clear();
  suppressed(() => {
    usePeopleStore.setState({ people: [] });
    useEventsStore.setState({ events: [] });
    useAttendanceStore.setState({ attendances: [] });
    useCrmStore.setState({
      sales: [],
      contacts: [],
      learning: [],
      settings: { ...DEFAULT_SETTINGS },
      goals: {},
    });
    useOpsStore.setState({ logistics: {}, costs: [], payments: {}, campaigns: [], schedules: [] });
    useActivityStore.setState({ events: [] });
    useChatStore.setState(emptyChat());
    useLibraryStore.setState(emptyLibrary());
    usePipelineStore.setState(emptyPipeline());
  });
  useLibraryExtras.setState({ teasers: [], names: {} });
  useRemoteStore.setState({ directory: [], rsvpCounts: null, chain: [], phase: "idle" });
}

// ---------------------------------------------------------------------------
// Realtime -> stores
// ---------------------------------------------------------------------------

function onLiveChange(ch: LiveChange): void {
  const me = syncContext()?.me;
  if (!me) return;
  if (ch.type === "DELETE") {
    if (ch.old) applyRemote(ch.table, [], [ch.old]);
    return;
  }
  if (!ch.row) return;
  applyRemote(ch.table, [ch.row]);

  // Follow-ups the row itself doesn't carry.
  if (ch.table === "conversation_members" && ch.type === "INSERT" && ch.row.person_id === me) {
    // Added to a chat: load its conversation, members and history.
    scheduleRefresh(["chat", "directory"]);
  } else if (ch.table === "notifications" && ch.type === "INSERT") {
    // The database logged a conversation check-in (contacts) for me.
    if (ch.row.type === "checkin_logged") scheduleRefresh(["crm"]);
    // Someone asked to see my numbers, or answered my request (share).
    if (ch.row.type === "stat_request" || ch.row.type === "stat_request_answered")
      scheduleRefresh(["pipeline"]);
  } else if (ch.table === "messages" && ch.type === "INSERT") {
    const author = String(ch.row.author_id ?? "");
    const known =
      useRemoteStore.getState().directory.some((d) => d.personId === author) ||
      usePeopleStore.getState().people.some((p) => p.id === author);
    if (author && !known) scheduleRefresh(["directory"]);
  }
}

// ---------------------------------------------------------------------------
// Refetching
// ---------------------------------------------------------------------------

type Scope = "crm" | "chat" | "library" | "pipeline" | "directory" | "counts";
const pendingScopes = new Set<Scope>();
let pendingTimer: ReturnType<typeof setTimeout> | undefined;

/** Refetch some tables soon (debounced; waits for local writes to finish). */
export function scheduleRefresh(scopes: Scope[], delayMs = 400): void {
  if (!current) return;
  scopes.forEach((s) => pendingScopes.add(s));
  if (pendingTimer) return;
  pendingTimer = setTimeout(() => {
    pendingTimer = undefined;
    const list = [...pendingScopes];
    pendingScopes.clear();
    void refresh(list);
  }, delayMs);
}

async function refresh(scopes: Scope[], attempt = 0): Promise<void> {
  const ctx = syncContext();
  if (!ctx || !current) return;
  const person = current.personId;
  await whenIdle();
  const version = localChangeVersion();
  try {
    const [crm, chat, library, pipeline, directory, counts] = await Promise.all([
      scopes.includes("crm") ? fetchCrm(ctx.client, ctx.me) : null,
      scopes.includes("chat") ? fetchChat(ctx.client) : null,
      scopes.includes("library") ? fetchLibrary(ctx.client) : null,
      scopes.includes("pipeline") ? fetchPipeline(ctx.client, ctx.me) : null,
      scopes.includes("directory") ? fetchDirectory(ctx.client) : null,
      scopes.includes("counts") ? fetchRsvpCounts(ctx.client) : null,
    ]);
    if (!current || current.personId !== person) return;
    // Something was edited meanwhile: the fetched rows may predate it. Try again.
    if (localChangeVersion() !== version || isBusy()) {
      if (attempt < 3) scheduleRefresh(scopes, 1500);
      return;
    }
    if (crm) applyCrm(crm);
    if (chat) applyChat(chat);
    if (library) applyLibrary(library);
    if (pipeline) applyPipeline(pipeline);
    if (directory) useRemoteStore.setState({ directory });
    if (counts) useRemoteStore.setState({ rsvpCounts: counts });
  } catch (e) {
    console.warn("[sync] refresh failed", e);
  }
}

/** Re-read the event card totals (after an RSVP). */
export function refreshRsvpCounts(): void {
  scheduleRefresh(["counts"], 0);
}

// Dev server: this module holds the open session (timers, realtime, focus
// listeners); a hot-swapped copy would run a second one. Reload instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

// A failed write was rolled back: say so and re-sync with the server.
onWriteError((error) => saveFailed(error));
setReconcile(() =>
  scheduleRefresh(["crm", "chat", "library", "pipeline", "directory", "counts"], 1000),
);

/**
 * Milestones reached per owner (totals only) for people whose numbers you
 * may see but whose prospects you can't (they shared with you). Null when
 * signed out.
 */
export async function fetchPipelineCounts(
  ownerIds: string[],
  from: string,
  to: string,
): Promise<Record<
  string,
  Record<"contact" | "first_meeting" | "first_plan" | "registered", number>
> | null> {
  const ctx = syncContext();
  if (!ctx || !ownerIds.length) return ctx ? {} : null;
  const { data, error } = await ctx.client.rpc("pipeline_person_counts", {
    p_owner_ids: ownerIds,
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`pipeline_person_counts: ${error.message}`);
  const out: Record<
    string,
    Record<"contact" | "first_meeting" | "first_plan" | "registered", number>
  > = {};
  for (const r of data ?? []) {
    out[r.owner_id] = {
      contact: r.contact,
      first_meeting: r.first_meeting,
      first_plan: r.first_plan,
      registered: r.registered,
    };
  }
  return out;
}
