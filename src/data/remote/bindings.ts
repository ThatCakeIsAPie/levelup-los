/**
 * Which store holds which table, and how rows move between them
 * (see ./engine.ts). One spec per database table.
 */
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { useAttendanceStore, type Attendance } from "@/stores/attendanceStore";
import {
  useCrmStore,
  DEFAULT_SETTINGS,
  type Contact,
  type Learning,
  type LearningGoal,
  type Sale,
} from "@/stores/crmStore";
import {
  useOpsStore,
  type Campaign,
  type Logistics,
  type Payment,
  type ReportSchedule,
  type SharedCost,
} from "@/stores/opsStore";
import { useActivityStore, type ActivityEvent } from "@/stores/activityStore";
import { useChatStore } from "@/data/chat/store";
import type { ChatData } from "@/data/chat/types";
import { isPendingPath } from "@/data/chat/attachments";
import { useLibraryStore } from "@/data/library/store";
import type {
  CatalogItem,
  LibraryChannel,
  LibraryData,
  LibraryProgress,
  LibraryTopic,
} from "@/data/library/types";
import { usePipelineStore } from "@/data/pipeline/store";
import type {
  PipelineCard,
  PipelineData,
  PipelineMove,
  PipelineStep,
  StatRequest,
  StatShare,
  StepHide,
  TeamSetting,
} from "@/data/pipeline/types";
import { applyRemote, keyOf, syncContext, type Binding, type Row, type TableSpec } from "./engine";
import * as m from "./rows";

// ---------------------------------------------------------------------------
// Spec helpers
// ---------------------------------------------------------------------------

/** A table kept as an array of items in a store. */
function listSpec<S, T extends object>(o: {
  table: string;
  pk: readonly string[];
  get: (s: S) => T[];
  set: (items: T[]) => Partial<S>;
  toRow: (item: T) => Row;
  fromRow: (row: Row) => T;
  include?: (item: T, s: S) => boolean;
  /** New items go first (newest-first lists). */
  prepend?: boolean;
  insert?: TableSpec<S>["insert"];
  update?: boolean;
  delete?: boolean;
  writeInsert?: TableSpec<S>["writeInsert"];
  writeUpdate?: TableSpec<S>["writeUpdate"];
}): TableSpec<S> {
  const cache = new WeakMap<T, Row>();
  const rowOf = (item: T) => {
    let r = cache.get(item);
    if (!r) {
      r = o.toRow(item);
      cache.set(item, r);
    }
    return r;
  };
  return {
    table: o.table,
    pk: o.pk,
    insert: o.insert ?? "insert",
    update: o.update,
    delete: o.delete,
    writeInsert: o.writeInsert,
    writeUpdate: o.writeUpdate,
    rows: (s) => {
      const items = o.get(s);
      return (o.include ? items.filter((i) => o.include!(i, s)) : items).map(rowOf);
    },
    normalize: (row) => o.toRow(o.fromRow(row)),
    apply: (s, upserts, deletes) => {
      const items = [...o.get(s)];
      const index = new Map(items.map((it, i) => [keyOf(o.pk, rowOf(it)), i]));
      const gone = new Set(deletes.map((r) => keyOf(o.pk, r)));
      const added: T[] = [];
      for (const r of upserts) {
        const k = keyOf(o.pk, r);
        gone.delete(k);
        const item = o.fromRow(r);
        const i = index.get(k);
        if (i === undefined) added.push(item);
        else items[i] = item;
      }
      const kept = gone.size ? items.filter((it) => !gone.has(keyOf(o.pk, rowOf(it)))) : items;
      return o.set(o.prepend ? [...added.reverse(), ...kept] : [...kept, ...added]);
    },
  };
}

/** A table kept as a record (`"a:b"` or a person id -> value) in a store. */
function recordSpec<S, V>(o: {
  table: string;
  pk: readonly string[];
  get: (s: S) => Record<string, V>;
  set: (rec: Record<string, V>) => Partial<S>;
  toRow: (key: string, v: V) => Row;
  fromRow: (row: Row) => [string, V];
  insert?: TableSpec<S>["insert"];
  update?: boolean;
  delete?: boolean;
  writeInsert?: TableSpec<S>["writeInsert"];
}): TableSpec<S> {
  const recKey = (row: Row) => o.fromRow(row)[0];
  return {
    table: o.table,
    pk: o.pk,
    insert: o.insert ?? "insert",
    update: o.update,
    delete: o.delete,
    writeInsert: o.writeInsert,
    rows: (s) => Object.entries(o.get(s)).map(([k, v]) => o.toRow(k, v)),
    normalize: (row) => {
      const [k, v] = o.fromRow(row);
      return o.toRow(k, v);
    },
    apply: (s, upserts, deletes) => {
      const rec = { ...o.get(s) };
      for (const r of deletes) delete rec[recKey(r)];
      for (const r of upserts) {
        const [k, v] = o.fromRow(r);
        rec[k] = v;
      }
      return o.set(rec);
    },
  };
}

const me = () => syncContext()?.me ?? "";

// ---------------------------------------------------------------------------
// CRM
// ---------------------------------------------------------------------------

type PeopleS = ReturnType<typeof usePeopleStore.getState>;
export const peopleBinding: Binding<PeopleS> = {
  name: "people",
  store: usePeopleStore,
  specs: [
    listSpec<PeopleS, CrmPerson>({
      table: "people",
      pk: ["id"],
      get: (s) => s.people,
      set: (people) => ({ people }),
      toRow: m.personToRow,
      fromRow: m.personFromRow,
    }),
  ],
};

type EventsS = ReturnType<typeof useEventsStore.getState>;
export const eventsBinding: Binding<EventsS> = {
  name: "events",
  store: useEventsStore,
  specs: [
    listSpec<EventsS, CrmEvent>({
      table: "events",
      pk: ["id"],
      get: (s) => s.events,
      set: (events) => ({ events }),
      toRow: m.eventToRow,
      fromRow: m.eventFromRow,
    }),
  ],
};

type AttendanceS = ReturnType<typeof useAttendanceStore.getState>;
export const attendanceBinding: Binding<AttendanceS> = {
  name: "attendance",
  store: useAttendanceStore,
  specs: [
    listSpec<AttendanceS, Attendance>({
      table: "attendances",
      pk: ["id"],
      get: (s) => s.attendances,
      set: (attendances) => ({ attendances }),
      toRow: m.attendanceToRow,
      fromRow: m.attendanceFromRow,
    }),
  ],
};

type CrmS = ReturnType<typeof useCrmStore.getState>;
const sameSettings = (a: { customerDays: number; teamDays: number }) =>
  a.customerDays === DEFAULT_SETTINGS.customerDays && a.teamDays === DEFAULT_SETTINGS.teamDays;
export const crmBinding: Binding<CrmS> = {
  name: "crm",
  store: useCrmStore,
  specs: [
    listSpec<CrmS, Contact>({
      table: "contacts",
      pk: ["id"],
      get: (s) => s.contacts,
      set: (contacts) => ({ contacts }),
      toRow: m.contactToRow,
      fromRow: m.contactFromRow,
      prepend: true,
    }),
    listSpec<CrmS, Sale>({
      table: "sales",
      pk: ["id"],
      get: (s) => s.sales,
      set: (sales) => ({ sales }),
      toRow: m.saleToRow,
      fromRow: m.saleFromRow,
      prepend: true,
    }),
    listSpec<CrmS, Learning>({
      table: "learning",
      pk: ["id"],
      get: (s) => s.learning,
      set: (learning) => ({ learning }),
      toRow: m.learningToRow,
      fromRow: m.learningFromRow,
      prepend: true,
    }),
    recordSpec<CrmS, LearningGoal>({
      table: "learning_goals",
      pk: ["person_id"],
      get: (s) => s.goals,
      set: (goals) => ({ goals }),
      toRow: m.goalToRow,
      fromRow: (r) => m.goalFromRow(r),
      insert: "upsert",
    }),
    // One row per person; no row means the defaults (30 / 14 days).
    {
      table: "contact_settings",
      pk: ["person_id"],
      insert: "upsert",
      rows: (s) => (sameSettings(s.settings) || !me() ? [] : [m.settingsToRow(me(), s.settings)]),
      normalize: (r) => m.settingsToRow(String(r.person_id), m.settingsFromRow(r)),
      apply: (_s, upserts, deletes) =>
        upserts.length
          ? { settings: m.settingsFromRow(upserts[upserts.length - 1]) }
          : deletes.length
            ? { settings: { ...DEFAULT_SETTINGS } }
            : {},
    },
  ],
};

type OpsS = ReturnType<typeof useOpsStore.getState>;
/** A cost's members and overrides live in their own tables. */
function costChildSpec(table: "shared_cost_members" | "cost_overrides"): TableSpec<OpsS> {
  const isMembers = table === "shared_cost_members";
  const toRow = (costId: string, personId: string, amount?: number): Row =>
    isMembers
      ? { cost_id: costId, person_id: personId }
      : { cost_id: costId, person_id: personId, amount };
  return {
    table,
    pk: ["cost_id", "person_id"],
    // The database opts the organizer in itself (trigger): ignore that duplicate.
    insert: isMembers ? "ignore" : "upsert",
    update: !isMembers,
    rows: (s) =>
      s.costs.flatMap((c) =>
        isMembers
          ? c.members.map((p) => toRow(c.id, p))
          : Object.entries(c.overrides).map(([p, a]) => toRow(c.id, p, a)),
      ),
    normalize: (r) =>
      toRow(String(r.cost_id), String(r.person_id), isMembers ? undefined : Number(r.amount)),
    apply: (s, upserts, deletes) => {
      const touched = new Set([...upserts, ...deletes].map((r) => String(r.cost_id)));
      return {
        costs: s.costs.map((c) => {
          if (!touched.has(c.id)) return c;
          if (isMembers) {
            let members = c.members.filter(
              (p) => !deletes.some((r) => r.cost_id === c.id && r.person_id === p),
            );
            for (const r of upserts)
              if (r.cost_id === c.id && !members.includes(String(r.person_id)))
                members = [...members, String(r.person_id)];
            return { ...c, members };
          }
          const overrides = { ...c.overrides };
          for (const r of deletes) if (r.cost_id === c.id) delete overrides[String(r.person_id)];
          for (const r of upserts)
            if (r.cost_id === c.id) overrides[String(r.person_id)] = Number(r.amount);
          return { ...c, overrides };
        }),
      };
    },
  };
}

export const opsBinding: Binding<OpsS> = {
  name: "ops",
  store: useOpsStore,
  specs: [
    recordSpec<OpsS, Logistics>({
      table: "logistics",
      pk: ["event_id", "person_id"],
      get: (s) => s.logistics,
      set: (logistics) => ({ logistics }),
      toRow: m.logisticsToRow,
      fromRow: m.logisticsFromRow,
      insert: "upsert",
    }),
    {
      ...listSpec<OpsS, SharedCost>({
        table: "shared_costs",
        pk: ["id"],
        get: (s) => s.costs,
        set: (costs) => ({ costs }),
        toRow: m.costToRow,
        fromRow: m.costFromRow,
      }),
      // Keep members/overrides when a cost row is updated from the server.
      apply: (s, upserts, deletes) => {
        const byId = new Map(s.costs.map((c) => [c.id, c]));
        const gone = new Set(deletes.map((r) => String(r.id)));
        const next = s.costs.filter((c) => !gone.has(c.id));
        for (const r of upserts) {
          const fresh = m.costFromRow(r);
          const old = byId.get(fresh.id);
          const merged = old ? { ...fresh, members: old.members, overrides: old.overrides } : fresh;
          const i = next.findIndex((c) => c.id === fresh.id);
          if (i === -1) next.push(merged);
          else next[i] = merged;
        }
        return { costs: next };
      },
    },
    costChildSpec("shared_cost_members"),
    costChildSpec("cost_overrides"),
    recordSpec<OpsS, Payment>({
      table: "payments",
      pk: ["cost_id", "person_id"],
      get: (s) => s.payments,
      set: (payments) => ({ payments }),
      toRow: m.paymentToRow,
      fromRow: m.paymentFromRow,
      // Payments only go through pay_sandbox(), which works out the amount
      // itself; its row replaces the optimistic one. Deletes are cascades.
      update: false,
      delete: false,
      writeInsert: async (rows, c) => {
        for (const r of rows) {
          if (r.person_id !== c.me) continue;
          const { data, error } = await c.client.rpc("pay_sandbox", { p_cost_id: r.cost_id });
          if (error) throw new Error(`pay_sandbox: ${error.message}`);
          if (data) queueMicrotask(() => applyRemote("payments", [data as Row]));
        }
      },
    }),
    listSpec<OpsS, Campaign>({
      table: "campaigns",
      pk: ["id"],
      get: (s) => s.campaigns,
      set: (campaigns) => ({ campaigns }),
      toRow: m.campaignToRow,
      fromRow: m.campaignFromRow,
      prepend: true,
    }),
    listSpec<OpsS, ReportSchedule>({
      table: "report_schedules",
      pk: ["owner_id"],
      get: (s) => s.schedules,
      set: (schedules) => ({ schedules }),
      toRow: m.scheduleToRow,
      fromRow: m.scheduleFromRow,
      insert: "upsert",
    }),
  ],
};

type ActivityS = ReturnType<typeof useActivityStore.getState>;
export const activityBinding: Binding<ActivityS> = {
  name: "activity",
  store: useActivityStore,
  specs: [
    listSpec<ActivityS, ActivityEvent>({
      table: "activity",
      pk: ["id"],
      get: (s) => s.events,
      set: (events) => ({ events }),
      toRow: (a) => m.activityToRow(a, syncContext()?.myName ?? ""),
      fromRow: (r) => m.activityFromRow(r, me()),
      prepend: true,
      // The timeline is append-only.
      update: false,
      delete: false,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

type ChatS = ChatData;
/** Messages whose photo / voice note is still uploading (cached per attachments array). */
const pendingCache = new WeakMap<object, Set<string>>();
function pendingMessages(s: ChatS): Set<string> {
  let set = pendingCache.get(s.attachments);
  if (!set) {
    set = new Set(
      s.attachments.filter((a) => isPendingPath(a.storagePath)).map((a) => a.messageId),
    );
    pendingCache.set(s.attachments, set);
  }
  return set;
}
const hasPendingMedia = (s: ChatS, messageId: string) => pendingMessages(s).has(messageId);

const omit = (row: Row, key: string): Row => {
  const out = { ...row };
  delete out[key];
  return out;
};

export const chatBinding: Binding<ChatS> = {
  name: "chat",
  store: useChatStore,
  specs: [
    listSpec<ChatS, ChatData["members"][number]>({
      table: "members",
      pk: ["workspace_id", "person_id"],
      get: (s) => s.members,
      set: (members) => ({ members }),
      toRow: m.memberToRow,
      fromRow: m.memberFromRow,
      // Membership comes from invites and the database; the app only changes roles.
      insert: false,
      delete: false,
    }),
    listSpec<ChatS, ChatData["conversations"][number]>({
      table: "conversations",
      pk: ["id"],
      get: (s) => s.conversations,
      set: (conversations) => ({ conversations }),
      toRow: m.conversationToRow,
      fromRow: m.conversationFromRow,
      // DMs are created by create_dm() (see chat mutations), never inserted.
      writeInsert: async (rows, c) => {
        const groups = rows.filter((r) => r.kind !== "dm");
        if (!groups.length) return;
        // workspace_id defaults to the caller's workspace.
        const { error } = await c.client.from("conversations").insert(
          groups.map((r) => omit(r, "workspace_id")),
          { defaultToNull: false },
        );
        if (error) throw new Error(`insert conversations: ${error.message}`);
      },
    }),
    listSpec<ChatS, ChatData["conversationMembers"][number]>({
      table: "conversation_members",
      pk: ["conversation_id", "person_id"],
      get: (s) => s.conversationMembers,
      set: (conversationMembers) => ({ conversationMembers }),
      toRow: m.conversationMemberToRow,
      fromRow: m.conversationMemberFromRow,
      // The creator of a group is made admin by the database too.
      insert: "ignore",
      writeUpdate: async (row, changes, _prev, c) => {
        const cols = Object.keys(changes);
        if (cols.length === 1 && cols[0] === "last_read_at" && row.person_id === c.me) {
          const { error } = await c.client.rpc("mark_conversation_read", {
            p_conversation_id: row.conversation_id,
          });
          if (error) throw new Error(`mark_conversation_read: ${error.message}`);
          return;
        }
        const { data, error } = await c.client
          .from("conversation_members")
          .update(changes)
          .match({ conversation_id: row.conversation_id, person_id: row.person_id })
          .select("person_id");
        if (error) throw new Error(`update conversation_members: ${error.message}`);
        if (!data?.length) throw new Error("update conversation_members: not allowed");
      },
    }),
    listSpec<ChatS, ChatData["messages"][number]>({
      table: "messages",
      pk: ["id"],
      get: (s) => s.messages,
      set: (messages) => ({ messages }),
      toRow: m.messageToRow,
      fromRow: m.messageFromRow,
      // A message with a photo / voice note still uploading is sent afterwards.
      include: (msg, s) => !hasPendingMedia(s, msg.id),
      writeUpdate: async (row, changes, _prev, c) => {
        // Removing: only deleted_at (the database blanks the text and card).
        const patch = changes.deleted_at ? { deleted_at: changes.deleted_at } : changes;
        const { data, error } = await c.client
          .from("messages")
          .update(patch)
          .eq("id", row.id as string)
          .select("id");
        if (error) throw new Error(`update messages: ${error.message}`);
        if (!data?.length) throw new Error("update messages: not allowed");
      },
    }),
    listSpec<ChatS, ChatData["attachments"][number]>({
      table: "attachments",
      pk: ["id"],
      get: (s) => s.attachments,
      set: (attachments) => ({ attachments }),
      toRow: m.attachmentToRow,
      fromRow: m.attachmentFromRow,
      include: (a) => !isPendingPath(a.storagePath),
      update: false,
    }),
    listSpec<ChatS, ChatData["mentions"][number]>({
      table: "mentions",
      pk: ["message_id", "person_id"],
      get: (s) => s.mentions,
      set: (mentions) => ({ mentions }),
      toRow: m.mentionToRow,
      fromRow: m.mentionFromRow,
      include: (x, s) => !hasPendingMedia(s, x.messageId),
      insert: "ignore",
      update: false,
    }),
    listSpec<ChatS, ChatData["reactions"][number]>({
      table: "reactions",
      pk: ["message_id", "person_id", "emoji"],
      get: (s) => s.reactions,
      set: (reactions) => ({ reactions }),
      toRow: m.reactionToRow,
      fromRow: m.reactionFromRow,
      insert: "ignore",
      update: false,
    }),
    listSpec<ChatS, ChatData["drafts"][number]>({
      table: "announcement_drafts",
      pk: ["id"],
      get: (s) => s.drafts,
      set: (drafts) => ({ drafts }),
      toRow: m.draftToRow,
      fromRow: m.draftFromRow,
    }),
    listSpec<ChatS, ChatData["reports"][number]>({
      table: "reports",
      pk: ["id"],
      get: (s) => s.reports,
      set: (reports) => ({ reports }),
      toRow: m.reportToRow,
      fromRow: m.reportFromRow,
      delete: false,
    }),
    listSpec<ChatS, ChatData["blocks"][number]>({
      table: "blocks",
      pk: ["blocker_id", "blocked_id"],
      get: (s) => s.blocks,
      set: (blocks) => ({ blocks }),
      toRow: m.blockToRow,
      fromRow: m.blockFromRow,
      insert: "ignore",
      update: false,
    }),
    listSpec<ChatS, ChatData["notifications"][number]>({
      table: "notifications",
      pk: ["id"],
      get: (s) => s.notifications,
      set: (notifications) => ({ notifications }),
      toRow: m.notificationToRow,
      fromRow: m.notificationFromRow,
      // Only triggers and RPCs create notifications; people mark them read.
      insert: false,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Library (src/data/library): items and channels carry their child rows
// (speakers, topics; sections, lessons) inside them in the store.
// ---------------------------------------------------------------------------

type LibS = LibraryData;

/** Rows of a child table kept inside its parents (pk includes the parent column). */
function childSpec<P>(o: {
  table: string;
  pk: readonly string[];
  /** The parent id column ("item_id", "channel_id"). */
  parentCol: string;
  parents: (s: LibS) => P[];
  parentId: (p: P) => string;
  setParents: (parents: P[]) => Partial<LibS>;
  rowsOf: (p: P) => Row[];
  normalize: (r: Row) => Row;
  /** The parent with exactly these child rows. */
  rebuild: (p: P, rows: Row[]) => P;
  insert?: TableSpec<LibS>["insert"];
  update?: boolean;
}): TableSpec<LibS> {
  return {
    table: o.table,
    pk: o.pk,
    insert: o.insert ?? "insert",
    update: o.update,
    rows: (s) => o.parents(s).flatMap(o.rowsOf),
    normalize: o.normalize,
    apply: (s, upserts, deletes) => {
      const touched = new Set([...upserts, ...deletes].map((r) => String(r[o.parentCol])));
      if (!touched.size) return {};
      return o.setParents(
        o.parents(s).map((p) => {
          if (!touched.has(o.parentId(p))) return p;
          const rows = new Map(o.rowsOf(p).map((r) => [keyOf(o.pk, r), r]));
          for (const r of deletes) rows.delete(keyOf(o.pk, r));
          for (const r of upserts)
            if (String(r[o.parentCol]) === o.parentId(p)) rows.set(keyOf(o.pk, r), o.normalize(r));
          return o.rebuild(p, [...rows.values()]);
        }),
      );
    },
  };
}

const byPosition = (a: Row, b: Row) => Number(a.position) - Number(b.position);

export const libraryBinding: Binding<LibS> = {
  name: "library",
  store: useLibraryStore,
  specs: [
    listSpec<LibS, LibraryTopic>({
      table: "library_topics",
      pk: ["id"],
      get: (s) => s.topics,
      set: (topics) => ({ topics }),
      toRow: m.topicToRow,
      fromRow: m.topicFromRow,
    }),
    {
      ...listSpec<LibS, CatalogItem>({
        table: "library_items",
        pk: ["id"],
        get: (s) => s.items,
        set: (items) => ({ items }),
        toRow: m.catalogItemToRow,
        fromRow: m.catalogItemFromRow,
        prepend: true,
      }),
      // Keep speakers and topics when the item row comes back from the server.
      apply: (s, upserts, deletes) => {
        const old = new Map(s.items.map((i) => [i.id, i]));
        const gone = new Set(deletes.map((r) => String(r.id)));
        const next = s.items.filter((i) => !gone.has(i.id));
        for (const r of upserts) {
          const fresh = m.catalogItemFromRow(r);
          const prev = old.get(fresh.id);
          const merged = prev
            ? { ...fresh, speakers: prev.speakers, topicIds: prev.topicIds }
            : fresh;
          const i = next.findIndex((x) => x.id === fresh.id);
          if (i === -1) next.unshift(merged);
          else next[i] = merged;
        }
        return { items: next };
      },
    },
    childSpec<CatalogItem>({
      table: "library_item_speakers",
      pk: ["item_id", "position"],
      parentCol: "item_id",
      parents: (s) => s.items,
      parentId: (i) => i.id,
      setParents: (items) => ({ items }),
      rowsOf: (i) => i.speakers.map((sp, n) => m.speakerToRow(i.id, n, sp)),
      normalize: (r) => m.speakerToRow(String(r.item_id), Number(r.position), m.speakerFromRow(r)),
      rebuild: (i, rows) => ({
        ...i,
        speakers: rows.sort(byPosition).map((r) => m.speakerFromRow(r)),
      }),
      insert: "upsert",
    }),
    childSpec<CatalogItem>({
      table: "library_item_topics",
      pk: ["item_id", "topic_id"],
      parentCol: "item_id",
      parents: (s) => s.items,
      parentId: (i) => i.id,
      setParents: (items) => ({ items }),
      rowsOf: (i) => i.topicIds.map((t) => ({ item_id: i.id, topic_id: t })),
      normalize: (r) => ({ item_id: String(r.item_id), topic_id: String(r.topic_id) }),
      rebuild: (i, rows) => ({ ...i, topicIds: rows.map((r) => String(r.topic_id)) }),
      insert: "ignore",
      update: false,
    }),
    {
      ...listSpec<LibS, LibraryChannel>({
        table: "library_channels",
        pk: ["id"],
        get: (s) => s.channels,
        set: (channels) => ({ channels }),
        toRow: m.channelToRow,
        fromRow: m.channelFromRow,
      }),
      // Keep sections when the channel row comes back from the server.
      apply: (s, upserts, deletes) => {
        const old = new Map(s.channels.map((c) => [c.id, c]));
        const gone = new Set(deletes.map((r) => String(r.id)));
        const next = s.channels.filter((c) => !gone.has(c.id));
        for (const r of upserts) {
          const fresh = m.channelFromRow(r);
          const prev = old.get(fresh.id);
          const merged = prev ? { ...fresh, sections: prev.sections } : fresh;
          const i = next.findIndex((x) => x.id === fresh.id);
          if (i === -1) next.push(merged);
          else next[i] = merged;
        }
        return { channels: next };
      },
    },
    childSpec<LibraryChannel>({
      table: "library_channel_sections",
      pk: ["id"],
      parentCol: "channel_id",
      parents: (s) => s.channels,
      parentId: (c) => c.id,
      setParents: (channels) => ({ channels }),
      rowsOf: (c) => c.sections.map((sec, n) => m.sectionToRow(c.id, n, sec)),
      normalize: (r) => ({
        id: String(r.id),
        channel_id: String(r.channel_id),
        position: Number(r.position),
        title: (r.title as string | null) ?? null,
      }),
      rebuild: (c, rows) => {
        const old = new Map(c.sections.map((sec) => [sec.id, sec]));
        return {
          ...c,
          sections: rows.sort(byPosition).map((r) => ({
            id: String(r.id),
            title: (r.title as string | null) ?? null,
            itemIds: old.get(String(r.id))?.itemIds ?? [],
          })),
        };
      },
    }),
    childSpec<LibraryChannel>({
      table: "library_channel_items",
      pk: ["section_id", "item_id"],
      parentCol: "channel_id",
      parents: (s) => s.channels,
      parentId: (c) => c.id,
      setParents: (channels) => ({ channels }),
      rowsOf: (c) =>
        c.sections.flatMap((sec) =>
          sec.itemIds.map((id, n) => m.channelItemToRow(c.id, sec.id, n, id)),
        ),
      normalize: (r) =>
        m.channelItemToRow(
          String(r.channel_id),
          String(r.section_id),
          Number(r.position),
          String(r.item_id),
        ),
      rebuild: (c, rows) => ({
        ...c,
        sections: c.sections.map((sec) => ({
          ...sec,
          itemIds: rows
            .filter((r) => r.section_id === sec.id)
            .sort(byPosition)
            .map((r) => String(r.item_id)),
        })),
      }),
    }),
    listSpec<LibS, LibraryProgress>({
      table: "library_progress",
      pk: ["person_id", "item_id"],
      get: (s) => s.progress,
      set: (progress) => ({ progress }),
      toRow: m.progressToRow,
      fromRow: m.progressFromRow,
      insert: "upsert",
    }),
  ],
};

// ---------------------------------------------------------------------------
// Pipeline (src/data/pipeline). Moves go through move_pipeline_card(), which
// also creates or moves the card; a card's column and entry time belong to
// the database (they change only through moves, undo and step deletes).
// ---------------------------------------------------------------------------

type PipeS = PipelineData;
/** Card columns the client never sends (the database owns them). */
const SERVER_CARD_COLS = ["person_id", "column_id", "entered_at"];
const cardPatch = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([k]) => !SERVER_CARD_COLS.includes(k)));

function rpcError(what: string, error: { message: string; code?: string }): Error {
  const e = new Error(`${what}: ${error.message}`) as Error & { code?: string };
  e.code = error.code;
  return e;
}

export const pipelineBinding: Binding<PipeS> = {
  name: "pipeline",
  store: usePipelineStore,
  specs: [
    listSpec<PipeS, PipelineStep>({
      table: "pipeline_steps",
      pk: ["id"],
      get: (s) => s.steps,
      set: (steps) => ({ steps }),
      toRow: m.stepToRow,
      fromRow: m.stepFromRow,
    }),
    listSpec<PipeS, StepHide>({
      table: "pipeline_step_hides",
      pk: ["person_id", "step_id"],
      get: (s) => s.hides,
      set: (hides) => ({ hides }),
      toRow: m.hideToRow,
      fromRow: m.hideFromRow,
      insert: "ignore",
      update: false,
    }),
    listSpec<PipeS, PipelineMove>({
      table: "pipeline_moves",
      pk: ["id"],
      get: (s) => s.moves,
      set: (moves) => ({ moves }),
      toRow: m.moveToRow,
      fromRow: m.moveFromRow,
      // Undo deletes; nobody edits a move.
      update: false,
      writeInsert: async (rows, c) => {
        const sorted = [...rows].sort((a, b) =>
          String(a.moved_at).localeCompare(String(b.moved_at)),
        );
        for (const r of sorted) {
          const card = usePipelineStore.getState().cards.find((x) => x.personId === r.person_id);
          const { data, error } = await c.client.rpc("move_pipeline_card", {
            p_person_id: r.person_id as string,
            p_to: r.to_column as string,
            p_move_id: r.id as string,
            p_next_step: card?.nextStep ?? undefined,
            p_next_step_date: card?.nextStepDate ?? undefined,
            p_source: card?.source ?? undefined,
            p_hot: card?.hot ?? undefined,
          });
          if (error) throw rpcError("move_pipeline_card", error);
          const out = (data ?? {}) as { move?: Row; card?: Row };
          queueMicrotask(() => {
            if (out.move) applyRemote("pipeline_moves", [out.move]);
            if (out.card) applyRemote("pipeline_cards", [out.card]);
          });
        }
      },
    }),
    listSpec<PipeS, PipelineCard>({
      table: "pipeline_cards",
      pk: ["person_id"],
      get: (s) => s.cards,
      set: (cards) => ({ cards }),
      toRow: m.cardToRow,
      fromRow: m.cardFromRow,
      // A card usually comes from its first move (written just before). A
      // prospect without one (added on the People page) gets it here, in
      // Contact made, the first time it is edited.
      writeInsert: async (rows, c) => {
        const ids = rows.map((r) => r.person_id as string);
        const { data, error } = await c.client
          .from("pipeline_cards")
          .select("person_id")
          .in("person_id", ids);
        if (error) throw rpcError("load pipeline_cards", error);
        const have = new Set((data ?? []).map((r) => String(r.person_id)));
        for (const r of rows) {
          const res = have.has(String(r.person_id))
            ? await c.client
                .from("pipeline_cards")
                .update(cardPatch(r))
                .eq("person_id", r.person_id as string)
            : await c.client
                .from("pipeline_cards")
                .insert({ ...r, column_id: "contact" }, { defaultToNull: false });
          if (res.error) throw rpcError("write pipeline_cards", res.error);
        }
      },
      writeUpdate: async (row, changes, _prev, c) => {
        const patch = cardPatch(changes);
        if (!Object.keys(patch).length) return;
        const { data, error } = await c.client
          .from("pipeline_cards")
          .update(patch)
          .eq("person_id", row.person_id as string)
          .select("person_id");
        if (error) throw rpcError("update pipeline_cards", error);
        if (!data?.length) throw new Error("update pipeline_cards: not allowed");
      },
    }),
    listSpec<PipeS, TeamSetting>({
      table: "pipeline_team_settings",
      pk: ["person_id"],
      get: (s) => s.settings,
      set: (settings) => ({ settings }),
      toRow: m.teamSettingToRow,
      fromRow: m.teamSettingFromRow,
      insert: "upsert",
    }),
    listSpec<PipeS, StatRequest>({
      table: "stat_requests",
      pk: ["id"],
      get: (s) => s.requests,
      set: (requests) => ({ requests }),
      toRow: m.statRequestToRow,
      fromRow: m.statRequestFromRow,
      // Answering goes through answer_stat_request() (share + notification).
      writeUpdate: async (row, changes, _prev, c) => {
        if (!changes.status) return;
        const { data, error } = await c.client.rpc("answer_stat_request", {
          p_request_id: row.id as string,
          p_approve: changes.status === "approved",
        });
        if (error) throw rpcError("answer_stat_request", error);
        if (data) queueMicrotask(() => applyRemote("stat_requests", [data as unknown as Row]));
      },
    }),
    listSpec<PipeS, StatShare>({
      table: "stat_shares",
      pk: ["owner_id", "viewer_id"],
      get: (s) => s.shares,
      set: (shares) => ({ shares }),
      toRow: m.shareToRow,
      fromRow: m.shareFromRow,
      // answer_stat_request() may have made it already.
      insert: "ignore",
      update: false,
    }),
  ],
};

export const ALL_BINDINGS = [
  peopleBinding,
  eventsBinding,
  attendanceBinding,
  crmBinding,
  opsBinding,
  activityBinding,
  chatBinding,
  libraryBinding,
  pipelineBinding,
] as unknown as Binding<unknown>[];
