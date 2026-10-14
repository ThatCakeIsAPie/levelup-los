/**
 * Write-through sync between the in-memory stores and Postgres ("supabase"
 * mode only; nothing here runs in the browser-storage demo).
 *
 * How it works:
 *  - Each table has a spec (./bindings.ts) that lists the store's rows for that
 *    table (`rows`) and can put rows back into the store (`apply`).
 *  - The engine keeps a *baseline* per table: the rows as the server last
 *    confirmed them (or as we optimistically sent them).
 *  - Mutations in src/data change the stores exactly as in local mode. The
 *    engine notices (store subscription), diffs the store against the
 *    baseline and turns the difference into inserts and updates, sent in
 *    order (parents before children; deletes children first) through one
 *    serial queue. The store already shows the change (optimistic).
 *  - Deletes are never inferred from absence: a row is deleted only when a
 *    local change (a mutation) was seen removing it. A row that leaves the
 *    store any other way (a store emptied or replaced outside the engine) is
 *    dropped from the baseline without a delete, and a change that empties a
 *    whole table at once is never taken as deletes.
 *  - If a write fails, that change is rolled back in the store, a toast says
 *    so, and a reconcile (refetch) is scheduled.
 *  - Changes that come from the server (hydrate, refetch, realtime, RPC
 *    results) go through `replaceStore` / `applyRemote` / `serverSide`, which
 *    update the store *and* the baseline, so they are never echoed back.
 *  - One engine per page: a second copy of this module (a dev-server hot
 *    update) stops the first, and the page reloads instead of hot-swapping it.
 *    Two copies on the same stores took each other's loads and sign-out
 *    clears for local edits and deleted the signed-in person's rows.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Row } from "./rows";

export type { Row };

export interface StoreLike<S> {
  getState(): S;
  setState(partial: Partial<S>): void;
  subscribe(listener: (state: S, prev: S) => void): () => void;
}

export interface SyncContext {
  client: SupabaseClient;
  /** The signed-in person's id. */
  me: string;
  /** The signed-in person's name (activity "actor"). */
  myName: string;
}

export interface TableSpec<S> {
  table: string;
  pk: readonly string[];
  /** The rows of this table as the store has them now. */
  rows(s: S): Row[];
  /** Put rows into the store (upserts: full rows; deletes: at least the pk). */
  apply(s: S, upserts: Row[], deletes: Row[]): Partial<S>;
  /** A database row as rows() would produce it. */
  normalize(dbRow: Row): Row;
  /** How new rows are written (false: never written by the client). */
  insert?: "insert" | "ignore" | "upsert" | false;
  update?: boolean;
  delete?: boolean;
  /** Custom writers (throw on failure). */
  writeInsert?(rows: Row[], ctx: SyncContext): Promise<void>;
  writeUpdate?(row: Row, changes: Row, prev: Row, ctx: SyncContext): Promise<void>;
}

export interface Binding<S> {
  name: string;
  store: StoreLike<S>;
  specs: TableSpec<S>[];
}

/** Parents before children (inserts/updates in this order, deletes in reverse). */
export const TABLE_ORDER = [
  "people",
  "events",
  "attendances",
  "missed_event_notes",
  "logistics",
  "shared_costs",
  "shared_cost_members",
  "cost_overrides",
  "payments",
  "contacts",
  "sales",
  "pv_overrides",
  "milestone_marks",
  "learning",
  "learning_goals",
  "contact_settings",
  "campaigns",
  "report_schedules",
  "activity",
  "members",
  "conversations",
  "conversation_members",
  "messages",
  "attachments",
  "mentions",
  "reactions",
  "announcement_drafts",
  "reports",
  "blocks",
  "notifications",
  "library_topics",
  "library_items",
  "library_item_speakers",
  "library_item_topics",
  "library_channels",
  "library_channel_sections",
  "library_channel_items",
  "library_progress",
  // Moves before cards: move_pipeline_card() creates / moves the card first.
  "pipeline_steps",
  "pipeline_step_hides",
  "pipeline_moves",
  "pipeline_cards",
  "pipeline_team_settings",
  // Requests before shares: approving makes the share in the database.
  "stat_requests",
  "stat_shares",
  // Your list and the customer pipeline: entries (after the people they link
  // to), steps, then moves before cards (move_customer_card() makes the card).
  "list_entries",
  "customer_steps",
  "customer_step_hides",
  "customer_moves",
  "customer_cards",
  // Team settings (after the people a deputy row names).
  "deputies",
  "feature_switches",
] as const;
const orderOf = (t: string) => {
  const i = (TABLE_ORDER as readonly string[]).indexOf(t);
  return i === -1 ? TABLE_ORDER.length : i;
};

type Op = {
  spec: TableSpec<unknown>;
  binding: Binding<unknown>;
  kind: "insert" | "update" | "delete";
  key: string;
  row: Row;
  prev?: Row;
  changes?: Row;
};

// ---------------------------------------------------------------------------
// Engine state (one per page; started after sign-in, stopped on sign-out)
// ---------------------------------------------------------------------------

let ctx: SyncContext | null = null;
let generation = 0;
let bindings: Binding<unknown>[] = [];
const unsubscribers: (() => void)[] = [];
const specByTable = new Map<string, { spec: TableSpec<unknown>; binding: Binding<unknown> }>();
const baselines = new Map<string, Map<string, Row>>();
const dirty = new Set<Binding<unknown>>();
/** Keys a local change removed since the last flush, per table: the only rows deleted. */
const removedLocally = new Map<string, Set<string>>();
/** Keys with a delete queued or in flight, per table (server rows for them are dropped). */
const deleting = new Map<string, Map<string, number>>();
let flushScheduled = false;
let queue: Promise<void> = Promise.resolve();
let pendingBatches = 0;
/** Keys with a write in flight, per table (remote changes for them wait). */
const inflight = new Map<string, Map<string, number>>();
const deferred = new Map<string, { table: string; upsert?: Row; del?: Row }>();
/** Bumped whenever local changes are queued (refetches check it). */
let localVersion = 0;

/**
 * State shared by every copy of this module in the page. Normally there is
 * one; a dev-server hot update can load a second. Store changes made while
 * `suppressDepth` > 0 are server-side for every copy, and loading a copy
 * stops the previous copy's engine, so two engines never sync the same stores.
 */
interface SharedState {
  suppressDepth: number;
  stopPrevious: (() => void) | null;
}
const shared: SharedState = ((globalThis as { __levelupSync?: SharedState }).__levelupSync ??= {
  suppressDepth: 0,
  stopPrevious: null,
});
shared.stopPrevious?.();
shared.stopPrevious = () => stopEngine();

let errorHandler: (error: unknown, ops: { table: string; kind: string }[]) => void = (e) =>
  console.error("[sync] write failed", e);

/** Called after a failed write was rolled back (toast + reconcile). */
export function onWriteError(handler: typeof errorHandler): void {
  errorHandler = handler;
}

export function syncContext(): SyncContext | null {
  return ctx;
}

export function isRunning(): boolean {
  return ctx !== null;
}

/** Version of local changes; refetch results are dropped if it moved meanwhile. */
export function localChangeVersion(): number {
  return localVersion;
}

// ---------------------------------------------------------------------------
// Rows, keys, JSON
// ---------------------------------------------------------------------------

const jsonCache = new WeakMap<Row, string>();
function json(row: Row): string {
  let s = jsonCache.get(row);
  if (s === undefined) {
    s = JSON.stringify(row);
    jsonCache.set(row, s);
  }
  return s;
}

export function keyOf(pk: readonly string[], row: Row): string {
  return pk.length === 1 ? String(row[pk[0]]) : pk.map((c) => String(row[c])).join("\u0001");
}

function snapshot<S>(spec: TableSpec<S>, state: S): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const row of spec.rows(state)) m.set(keyOf(spec.pk, row), row);
  return m;
}

function changedColumns(prev: Row, next: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (JSON.stringify(v) !== JSON.stringify(prev[k])) out[k] = v;
  }
  return out;
}

const pkOf = (pk: readonly string[], row: Row): Row =>
  Object.fromEntries(pk.map((c) => [c, row[c]]));

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Start syncing these stores (their current contents are taken as the server's). */
export function startEngine(context: SyncContext, list: Binding<unknown>[]): void {
  stopEngine();
  ctx = context;
  generation++;
  bindings = list;
  for (const b of list) {
    for (const spec of b.specs) {
      specByTable.set(spec.table, { spec, binding: b });
      baselines.set(spec.table, snapshot(spec, b.store.getState()));
    }
    unsubscribers.push(
      b.store.subscribe((state, prev) => {
        if (shared.suppressDepth > 0 || !ctx) return;
        noteRemovals(b, state, prev);
        dirty.add(b);
        scheduleFlush();
      }),
    );
  }
}

/**
 * Stop syncing (sign-out, another person signing in). A write already being
 * sent finishes, but the rest of its batch is dropped (it would go out with
 * the next person's session) and nothing is rolled back.
 */
export function stopEngine(): void {
  unsubscribers.splice(0).forEach((u) => u());
  ctx = null;
  generation++;
  bindings = [];
  specByTable.clear();
  baselines.clear();
  dirty.clear();
  removedLocally.clear();
  inflight.clear();
  deleting.clear();
  deferred.clear();
}

/**
 * Remember which rows a local change removed: they are the only rows the next
 * flush deletes. Rows the server doesn't have yet need no delete. A change
 * that empties a whole table at once is a reset (sign-out, another copy of
 * the app's data layer), never a person deleting their data: it deletes
 * nothing.
 */
function noteRemovals(b: Binding<unknown>, state: unknown, prev: unknown): void {
  for (const spec of b.specs) {
    if (spec.delete === false) continue;
    const base = baselines.get(spec.table);
    if (!base?.size) continue;
    const now = new Set(spec.rows(state).map((r) => keyOf(spec.pk, r)));
    const gone: string[] = [];
    for (const r of spec.rows(prev)) {
      const key = keyOf(spec.pk, r);
      if (!now.has(key) && base.has(key)) gone.push(key);
    }
    if (!gone.length) continue;
    if (now.size === 0 && gone.length > 1) {
      console.warn(`[sync] ${spec.table} was emptied outside a mutation; nothing is deleted`);
      continue;
    }
    const set = removedLocally.get(spec.table) ?? new Set<string>();
    for (const key of gone) {
      set.add(key);
      // An older server copy of the row must not bring it back.
      deferred.delete(`${spec.table}\u0002${key}`);
    }
    removedLocally.set(spec.table, set);
  }
}

function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  queueMicrotask(() => {
    flushScheduled = false;
    flush();
  });
}

/**
 * Run `fn` without the engine treating its store changes as local edits
 * (server rows, rollbacks, emptying the stores on sign-out).
 */
export function suppressed(fn: () => void): void {
  shared.suppressDepth++;
  try {
    fn();
  } finally {
    shared.suppressDepth--;
  }
}

// ---------------------------------------------------------------------------
// Local changes -> writes
// ---------------------------------------------------------------------------

/**
 * Diff the changed stores against the baseline and queue the writes. Rows
 * missing from the store are deleted only if a local change removed them
 * (see noteRemovals); any other missing row just leaves the baseline.
 */
export function flush(): void {
  if (!ctx || dirty.size === 0) return;
  const ops: Op[] = [];
  for (const b of dirty) {
    const state = b.store.getState();
    for (const spec of b.specs) {
      const base = baselines.get(spec.table) ?? new Map<string, Row>();
      const cur = snapshot(spec, state);
      for (const [key, row] of cur) {
        const prev = base.get(key);
        if (!prev) {
          ops.push({ spec, binding: b, kind: "insert", key, row });
        } else if (prev !== row && json(prev) !== json(row)) {
          const changes = changedColumns(prev, row);
          if (Object.keys(changes).length)
            ops.push({ spec, binding: b, kind: "update", key, row, prev, changes });
        }
      }
      const removed = removedLocally.get(spec.table);
      let dropped = 0;
      for (const [key, prev] of base) {
        if (cur.has(key)) continue;
        if (removed?.has(key)) ops.push({ spec, binding: b, kind: "delete", key, row: prev, prev });
        else dropped++;
      }
      if (dropped)
        console.warn(`[sync] ${dropped} ${spec.table} row(s) left the store without a delete`);
      removedLocally.delete(spec.table);
      baselines.set(spec.table, cur);
    }
  }
  dirty.clear();
  const writable = ops.filter((op) =>
    op.kind === "insert"
      ? op.spec.insert !== false
      : op.kind === "update"
        ? op.spec.update !== false
        : op.spec.delete !== false,
  );
  if (writable.length) enqueue(writable);
}

function count(map: Map<string, Map<string, number>>, ops: Op[], delta: number) {
  for (const op of ops) {
    const m = map.get(op.spec.table) ?? new Map<string, number>();
    const n = (m.get(op.key) ?? 0) + delta;
    if (n > 0) m.set(op.key, n);
    else m.delete(op.key);
    map.set(op.spec.table, m);
  }
}

function enqueue(ops: Op[]) {
  localVersion++;
  pendingBatches++;
  const deletes = ops.filter((o) => o.kind === "delete");
  count(inflight, ops, 1);
  count(deleting, deletes, 1);
  const gen = generation;
  queue = queue
    .then(() => execute(ops, gen))
    .catch((e) => console.error("[sync] unexpected", e))
    .finally(() => {
      pendingBatches--;
      if (gen !== generation) return;
      count(inflight, ops, -1);
      applyDeferred();
      count(deleting, deletes, -1);
    });
}

async function execute(ops: Op[], gen: number): Promise<void> {
  const c = ctx;
  if (!c || gen !== generation) return;
  // Signed out or someone else signed in meanwhile: send nothing more (the
  // client would send it with the next person's session).
  const stale = () => gen !== generation;
  const upserts = ops
    .filter((o) => o.kind !== "delete")
    .sort((a, b) => orderOf(a.spec.table) - orderOf(b.spec.table));
  const deletes = ops
    .filter((o) => o.kind === "delete")
    .sort((a, b) => orderOf(b.spec.table) - orderOf(a.spec.table));

  const failed: Op[] = [];
  let firstError: unknown = null;
  const run = async (group: Op[], fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      firstError ??= e;
      failed.push(...group);
    }
  };

  for (const table of unique(upserts.map((o) => o.spec.table))) {
    const tableOps = upserts.filter((o) => o.spec.table === table);
    const inserts = tableOps.filter((o) => o.kind === "insert");
    const updates = tableOps.filter((o) => o.kind === "update");
    if (inserts.length && !stale()) await run(inserts, () => writeInserts(inserts, c));
    if (updates.length && !stale()) await writeUpdates(updates, c, run);
  }
  for (const table of unique(deletes.map((o) => o.spec.table))) {
    if (stale()) return;
    const tableOps = deletes.filter((o) => o.spec.table === table);
    await run(tableOps, () => writeDeletes(tableOps, c));
  }

  if (failed.length && gen === generation) {
    revert(failed);
    errorHandler(
      firstError,
      failed.map((o) => ({ table: o.spec.table, kind: o.kind })),
    );
  }
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

function fail(error: { message: string; code?: string } | null, what: string): void {
  if (error) {
    const e = new Error(`${what}: ${error.message}`) as Error & { code?: string };
    e.code = error.code;
    throw e;
  }
}

async function writeInserts(ops: Op[], c: SyncContext): Promise<void> {
  const spec = ops[0].spec;
  const rows = ops.map((o) => o.row);
  if (spec.writeInsert) return spec.writeInsert(rows, c);
  const q = c.client.from(spec.table);
  const onConflict = spec.pk.join(",");
  const { error } =
    spec.insert === "ignore"
      ? await q.upsert(rows, { onConflict, ignoreDuplicates: true, defaultToNull: false })
      : spec.insert === "upsert"
        ? await q.upsert(rows, { onConflict, defaultToNull: false })
        : await q.insert(rows, { defaultToNull: false });
  fail(error, `insert ${spec.table}`);
}

async function writeUpdates(
  ops: Op[],
  c: SyncContext,
  run: (group: Op[], fn: () => Promise<void>) => Promise<void>,
): Promise<void> {
  const spec = ops[0].spec;
  if (spec.writeUpdate) {
    await Promise.all(
      ops.map((o) => run([o], () => spec.writeUpdate!(o.row, o.changes!, o.prev!, c))),
    );
    return;
  }
  if (spec.pk.length === 1) {
    // Same change on many rows (bulk attendance edits, "mark all read"): one request.
    const groups = new Map<string, Op[]>();
    for (const o of ops) {
      const k = JSON.stringify(o.changes);
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    await Promise.all(
      [...groups.values()].map((group) =>
        run(group, async () => {
          const col = spec.pk[0];
          const ids = group.map((o) => o.row[col] as string);
          const { data, error } = await c.client
            .from(spec.table)
            .update(group[0].changes!)
            .in(col, ids)
            .select(col);
          fail(error, `update ${spec.table}`);
          if ((data?.length ?? 0) < ids.length) notAllowed(spec.table);
        }),
      ),
    );
    return;
  }
  await Promise.all(
    ops.map((o) =>
      run([o], async () => {
        const { data, error } = await c.client
          .from(spec.table)
          .update(o.changes!)
          .match(pkOf(spec.pk, o.row))
          .select(spec.pk.join(","));
        fail(error, `update ${spec.table}`);
        if (!data?.length) notAllowed(spec.table);
      }),
    ),
  );
}

function notAllowed(table: string): never {
  const e = new Error(`update ${table}: not allowed (no row changed)`) as Error & { code?: string };
  e.code = "42501";
  throw e;
}

async function writeDeletes(ops: Op[], c: SyncContext): Promise<void> {
  const spec = ops[0].spec;
  if (spec.pk.length === 1) {
    const col = spec.pk[0];
    const { error } = await c.client
      .from(spec.table)
      .delete()
      .in(
        col,
        ops.map((o) => o.row[col] as string),
      );
    fail(error, `delete ${spec.table}`);
    return;
  }
  const results = await Promise.all(
    ops.map((o) => c.client.from(spec.table).delete().match(pkOf(spec.pk, o.row))),
  );
  for (const r of results) fail(r.error, `delete ${spec.table}`);
}

/** Undo failed writes in the store (and the baseline). */
function revert(ops: Op[]) {
  const byTable = new Map<string, Op[]>();
  for (const o of ops) byTable.set(o.spec.table, [...(byTable.get(o.spec.table) ?? []), o]);
  suppressed(() => {
    for (const [table, list] of byTable) {
      const entry = specByTable.get(table);
      if (!entry) continue;
      const base = baselines.get(table)!;
      const restore = list.filter((o) => o.kind !== "insert").map((o) => o.prev!);
      const remove = list.filter((o) => o.kind === "insert").map((o) => o.row);
      entry.binding.store.setState(
        entry.spec.apply(entry.binding.store.getState(), restore, remove),
      );
      for (const r of remove) base.delete(keyOf(entry.spec.pk, r));
      for (const r of restore) base.set(keyOf(entry.spec.pk, r), r);
    }
  });
}

// ---------------------------------------------------------------------------
// Server changes -> store
// ---------------------------------------------------------------------------

/**
 * Replace whole tables with server rows (hydrate, refetch). `build` returns
 * the new store state for one binding; baselines follow it.
 */
export function replaceStore<S>(binding: Binding<S>, next: Partial<S>): void {
  flush();
  suppressed(() => binding.store.setState(next));
  if (!ctx) return;
  const state = binding.store.getState();
  for (const spec of binding.specs) baselines.set(spec.table, snapshot(spec, state));
}

/**
 * Merge rows the server changed (realtime, RPC results). Rows with a local
 * write in flight wait until it finishes, so the optimistic value isn't
 * overwritten by an older server one.
 */
export function applyRemote(table: string, upserts: Row[], deletes: Row[] = []): void {
  const entry = specByTable.get(table);
  if (!entry || !ctx) return;
  flush();
  const { spec, binding } = entry;
  const base = baselines.get(table)!;
  const busy = inflight.get(table);
  const ups: Row[] = [];
  const dels: Row[] = [];
  const goingAway = deleting.get(table);
  for (const raw of upserts) {
    const row = spec.normalize(raw);
    const key = keyOf(spec.pk, row);
    // Deleted here meanwhile (e.g. an undo while the move was being saved).
    if (goingAway?.has(key)) continue;
    if (busy?.has(key)) {
      deferred.set(`${table}\u0002${key}`, { table, upsert: raw });
      continue;
    }
    const prev = base.get(key);
    if (prev && json(prev) === json(row)) continue;
    ups.push(row);
  }
  for (const raw of deletes) {
    const key = keyOf(spec.pk, raw);
    if (busy?.has(key)) {
      deferred.set(`${table}\u0002${key}`, { table, del: raw });
      continue;
    }
    if (!base.has(key)) continue;
    dels.push(raw);
  }
  if (!ups.length && !dels.length) return;
  suppressed(() => binding.store.setState(spec.apply(binding.store.getState(), ups, dels)));
  for (const r of ups) base.set(keyOf(spec.pk, r), r);
  for (const r of dels) base.delete(keyOf(spec.pk, r));
}

function applyDeferred() {
  if (!deferred.size) return;
  const items = [...deferred.values()];
  deferred.clear();
  for (const d of items) {
    if (d.upsert) applyRemote(d.table, [d.upsert]);
    else if (d.del) applyRemote(d.table, [], [d.del]);
  }
}

/**
 * Apply store changes the database makes by itself (triggers, RPCs): they show
 * immediately but are not written back.
 */
export function serverSide(fn: () => void): void {
  if (!ctx) {
    fn();
    return;
  }
  flush();
  suppressed(fn);
  for (const b of bindings) {
    const state = b.store.getState();
    for (const spec of b.specs) baselines.set(spec.table, snapshot(spec, state));
  }
}

/** Resolves when every queued write has finished. */
export async function whenIdle(): Promise<void> {
  flush();
  let current: Promise<void>;
  do {
    current = queue;
    await current;
    await Promise.resolve();
    flush();
  } while (current !== queue || pendingBatches > 0);
}

/** True while writes are queued or in flight. */
export function isBusy(): boolean {
  return pendingBatches > 0 || dirty.size > 0;
}

// Dev server: never hot-swap the engine (the old copy would keep syncing the
// same stores next to the new one); reload the page instead.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}
