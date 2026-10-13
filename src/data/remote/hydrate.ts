/**
 * Loading everything the signed-in person may see (row-level security does
 * the filtering) and putting it into the stores.
 *
 * `fetchSnapshot(client, me)` is pure data (no stores), so the integration
 * tests can call it for several users at once; `applySnapshot` replaces the
 * stores' contents and the sync engine's baselines.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CrmPerson } from "@/stores/peopleStore";
import type { CrmEvent } from "@/stores/eventsStore";
import type { Attendance } from "@/stores/attendanceStore";
import {
  DEFAULT_SETTINGS,
  type Contact,
  type Learning,
  type LearningGoal,
  type Sale,
  type Settings,
} from "@/stores/crmStore";
import type { Campaign, Logistics, Payment, ReportSchedule, SharedCost } from "@/stores/opsStore";
import type { ActivityEvent } from "@/stores/activityStore";
import type { ChatData } from "@/data/chat/types";
import { isPendingPath } from "@/data/chat/attachments";
import type { LibraryData } from "@/data/library/types";
import { useLibraryExtras, type ChannelTeaser, type LibraryExtras } from "@/data/library/extras";
import {
  activityBinding,
  attendanceBinding,
  chatBinding,
  crmBinding,
  libraryBinding,
  eventsBinding,
  opsBinding,
  peopleBinding,
} from "./bindings";
import { replaceStore } from "./engine";
import { useRemoteStore, type DirectoryEntry, type RsvpCounts } from "./extras";
import * as m from "./rows";
import type { Row } from "./rows";

/** Rows per request (the API's max_rows is 1000). */
const PAGE = 1000;
/** Caps for the tables that grow forever (newest kept). */
export const LIMITS = { activity: 5000, messages: 10000, notifications: 2000 };

type Order = [column: string, ascending: boolean];

/** Every row of a table the caller may read, paged, in a stable order. */
export async function fetchAll(
  client: SupabaseClient,
  table: string,
  order: Order[],
  opts: { limit?: number; select?: string } = {},
): Promise<Row[]> {
  const out: Row[] = [];
  const limit = opts.limit ?? Infinity;
  for (let from = 0; out.length < limit; from += PAGE) {
    let q = client
      .from(table)
      .select(opts.select ?? "*")
      .range(from, from + Math.min(PAGE, limit - out.length) - 1);
    for (const [col, ascending] of order) q = q.order(col, { ascending });
    const { data, error } = await q;
    if (error) throw new Error(`load ${table}: ${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface CrmSnapshot {
  people: CrmPerson[];
  events: CrmEvent[];
  attendances: Attendance[];
  contacts: Contact[];
  sales: Sale[];
  learning: Learning[];
  goals: Record<string, LearningGoal>;
  settings: Settings;
  logistics: Record<string, Logistics>;
  costs: SharedCost[];
  payments: Record<string, Payment>;
  campaigns: Campaign[];
  schedules: ReportSchedule[];
  activity: ActivityEvent[];
}

export interface LibrarySnapshot {
  data: LibraryData;
  extras: LibraryExtras;
}

export interface Snapshot {
  crm: CrmSnapshot;
  chat: ChatData;
  library: LibrarySnapshot;
  directory: DirectoryEntry[];
  rsvpCounts: Record<string, RsvpCounts>;
}

export async function fetchCrm(client: SupabaseClient, me: string): Promise<CrmSnapshot> {
  const all = (t: string, order: Order[], limit?: number) => fetchAll(client, t, order, { limit });
  const [
    people,
    events,
    attendances,
    contacts,
    sales,
    learning,
    goals,
    settings,
    logistics,
    costs,
    costMembers,
    overrides,
    payments,
    campaigns,
    schedules,
    activity,
  ] = await Promise.all([
    all("people", [["id", true]]),
    all("events", [
      ["date", true],
      ["id", true],
    ]),
    all("attendances", [["id", true]]),
    all("contacts", [
      ["date", false],
      ["created_at", false],
      ["id", true],
    ]),
    all("sales", [
      ["date", false],
      ["created_at", false],
      ["id", true],
    ]),
    all("learning", [
      ["date", false],
      ["created_at", false],
      ["id", true],
    ]),
    all("learning_goals", [["person_id", true]]),
    all("contact_settings", [["person_id", true]]),
    all("logistics", [
      ["event_id", true],
      ["person_id", true],
    ]),
    all("shared_costs", [
      ["created_at", true],
      ["id", true],
    ]),
    all("shared_cost_members", [
      ["created_at", true],
      ["cost_id", true],
      ["person_id", true],
    ]),
    all("cost_overrides", [
      ["cost_id", true],
      ["person_id", true],
    ]),
    all("payments", [
      ["cost_id", true],
      ["person_id", true],
    ]),
    all("campaigns", [
      ["created_at", false],
      ["id", true],
    ]),
    all("report_schedules", [["owner_id", true]]),
    all(
      "activity",
      [
        ["timestamp", false],
        ["id", true],
      ],
      LIMITS.activity,
    ),
  ]);

  const costList = costs.map((r) => m.costFromRow(r));
  const byId = new Map(costList.map((c) => [c.id, c]));
  for (const r of costMembers) byId.get(String(r.cost_id))?.members.push(String(r.person_id));
  for (const r of overrides) {
    const c = byId.get(String(r.cost_id));
    if (c) c.overrides[String(r.person_id)] = Number(r.amount);
  }
  const mine = settings.find((r) => r.person_id === me);

  return {
    people: people.map((r) => m.personFromRow(r)),
    events: events.map((r) => m.eventFromRow(r)),
    attendances: attendances.map((r) => m.attendanceFromRow(r)),
    contacts: contacts.map((r) => m.contactFromRow(r)),
    sales: sales.map((r) => m.saleFromRow(r)),
    learning: learning.map((r) => m.learningFromRow(r)),
    goals: Object.fromEntries(goals.map((r) => m.goalFromRow(r))),
    settings: mine ? m.settingsFromRow(mine) : { ...DEFAULT_SETTINGS },
    logistics: Object.fromEntries(logistics.map((r) => m.logisticsFromRow(r))),
    costs: costList,
    payments: Object.fromEntries(payments.map((r) => m.paymentFromRow(r))),
    campaigns: campaigns.map((r) => m.campaignFromRow(r)),
    schedules: schedules.map((r) => m.scheduleFromRow(r)),
    activity: activity.map((r) => m.activityFromRow(r, me)),
  };
}

export async function fetchChat(client: SupabaseClient): Promise<ChatData> {
  const all = (t: string, order: Order[], limit?: number) => fetchAll(client, t, order, { limit });
  const [
    members,
    conversations,
    conversationMembers,
    messages,
    attachments,
    reactions,
    mentions,
    drafts,
    notifications,
    reports,
    blocks,
  ] = await Promise.all([
    all("members", [["person_id", true]]),
    all("conversations", [
      ["created_at", true],
      ["id", true],
    ]),
    all("conversation_members", [
      ["conversation_id", true],
      ["person_id", true],
    ]),
    all(
      "messages",
      [
        ["created_at", false],
        ["id", true],
      ],
      LIMITS.messages,
    ),
    all("attachments", [["id", true]]),
    all("reactions", [
      ["created_at", true],
      ["message_id", true],
      ["person_id", true],
      ["emoji", true],
    ]),
    all("mentions", [
      ["message_id", true],
      ["person_id", true],
    ]),
    all("announcement_drafts", [
      ["created_at", true],
      ["id", true],
    ]),
    all(
      "notifications",
      [
        ["created_at", false],
        ["id", true],
      ],
      LIMITS.notifications,
    ),
    all("reports", [
      ["created_at", true],
      ["id", true],
    ]),
    all("blocks", [
      ["blocker_id", true],
      ["blocked_id", true],
    ]),
  ]);
  return {
    members: members.map((r) => m.memberFromRow(r)),
    conversations: conversations.map((r) => m.conversationFromRow(r)),
    conversationMembers: conversationMembers.map((r) => m.conversationMemberFromRow(r)),
    messages: messages.reverse().map((r) => m.messageFromRow(r)),
    attachments: attachments.map((r) => m.attachmentFromRow(r)),
    reactions: reactions.map((r) => m.reactionFromRow(r)),
    mentions: mentions.map((r) => m.mentionFromRow(r)),
    drafts: drafts.map((r) => m.draftFromRow(r)),
    notifications: notifications.map((r) => m.notificationFromRow(r)),
    reports: reports.map((r) => m.reportFromRow(r)),
    blocks: blocks.map((r) => m.blockFromRow(r)),
  };
}

export async function fetchDirectory(client: SupabaseClient): Promise<DirectoryEntry[]> {
  const rows = await fetchAll(client, "chat_directory", [["person_id", true]], {
    select: "person_id, name, stage, role",
  });
  return rows.map((r) => ({
    personId: String(r.person_id),
    name: String(r.name ?? ""),
    stage: r.stage as DirectoryEntry["stage"],
    role: (r.role as DirectoryEntry["role"]) ?? null,
  }));
}

export async function fetchRsvpCounts(client: SupabaseClient): Promise<Record<string, RsvpCounts>> {
  const { data, error } = await client.rpc("event_rsvp_counts");
  if (error) throw new Error(`event_rsvp_counts: ${error.message}`);
  const out: Record<string, RsvpCounts> = {};
  for (const r of (data ?? []) as Row[]) {
    out[String(r.event_id)] = {
      bought: Number(r.bought ?? 0),
      going: Number(r.going ?? 0),
      maybe: Number(r.maybe ?? 0),
    };
  }
  return out;
}

/**
 * The library the caller may see (catalog, topics, channels, their own
 * progress), plus the locked "IBOs and leaders" channels and the names of the
 * people behind it all.
 */
export async function fetchLibrary(client: SupabaseClient): Promise<LibrarySnapshot> {
  const all = (t: string, order: Order[]) => fetchAll(client, t, order);
  const [topics, items, speakers, itemTopics, channels, sections, lessons, progress, people] =
    await Promise.all([
      all("library_topics", [
        ["created_at", true],
        ["id", true],
      ]),
      all("library_items", [
        ["created_at", false],
        ["id", true],
      ]),
      all("library_item_speakers", [
        ["item_id", true],
        ["position", true],
      ]),
      all("library_item_topics", [
        ["item_id", true],
        ["topic_id", true],
      ]),
      all("library_channels", [
        ["created_at", true],
        ["id", true],
      ]),
      all("library_channel_sections", [
        ["channel_id", true],
        ["position", true],
      ]),
      all("library_channel_items", [
        ["section_id", true],
        ["position", true],
      ]),
      all("library_progress", [
        ["person_id", true],
        ["item_id", true],
      ]),
      all("library_people", [["person_id", true]]),
    ]);
  const { data: teaserRows, error } = await client.rpc("library_channel_teasers");
  if (error) throw new Error(`library_channel_teasers: ${error.message}`);

  const itemList = items.map((r) => m.catalogItemFromRow(r));
  const itemById = new Map(itemList.map((i) => [i.id, i]));
  for (const r of speakers) itemById.get(String(r.item_id))?.speakers.push(m.speakerFromRow(r));
  for (const r of itemTopics) itemById.get(String(r.item_id))?.topicIds.push(String(r.topic_id));
  const channelList = channels.map((r) => m.channelFromRow(r));
  const channelById = new Map(channelList.map((c) => [c.id, c]));
  const sectionById = new Map<string, { itemIds: string[] }>();
  for (const r of sections) {
    const sec = { id: String(r.id), title: (r.title as string | null) ?? null, itemIds: [] };
    channelById.get(String(r.channel_id))?.sections.push(sec);
    sectionById.set(sec.id, sec);
  }
  for (const r of lessons) sectionById.get(String(r.section_id))?.itemIds.push(String(r.item_id));

  const teasers: ChannelTeaser[] = ((teaserRows ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ""),
    description: (r.description as string | null) ?? null,
    icon: String(r.icon ?? "book-open"),
    color: (r.color as ChannelTeaser["color"]) ?? "teal",
    createdBy: String(r.created_by ?? ""),
    lessonCount: Number(r.lesson_count ?? 0),
    createdAt: m.iso(r.created_at) ?? "",
  }));
  return {
    data: {
      topics: topics.map((r) => m.topicFromRow(r)),
      items: itemList,
      channels: channelList,
      progress: progress.map((r) => m.progressFromRow(r)),
    },
    extras: {
      teasers,
      names: Object.fromEntries(people.map((r) => [String(r.person_id), String(r.name ?? "")])),
    },
  };
}

/** Everything the signed-in person may see, in store shapes. */
export async function fetchSnapshot(client: SupabaseClient, me: string): Promise<Snapshot> {
  const [crm, chat, library, directory, rsvpCounts] = await Promise.all([
    fetchCrm(client, me),
    fetchChat(client),
    fetchLibrary(client),
    fetchDirectory(client),
    fetchRsvpCounts(client),
  ]);
  return { crm, chat, library, directory, rsvpCounts };
}

// ---------------------------------------------------------------------------
// Snapshot -> stores
// ---------------------------------------------------------------------------

export function applyCrm(s: CrmSnapshot): void {
  replaceStore(peopleBinding, { people: s.people });
  replaceStore(eventsBinding, { events: s.events });
  replaceStore(attendanceBinding, { attendances: s.attendances });
  replaceStore(crmBinding, {
    contacts: s.contacts,
    sales: s.sales,
    learning: s.learning,
    goals: s.goals,
    settings: s.settings,
  });
  replaceStore(opsBinding, {
    logistics: s.logistics,
    costs: s.costs,
    payments: s.payments,
    campaigns: s.campaigns,
    schedules: s.schedules,
  });
  replaceStore(activityBinding, { events: s.activity });
}

/**
 * Replace the chat tables, keeping messages whose photo / voice note is still
 * uploading (they aren't in the database yet).
 */
export function applyChat(next: ChatData): void {
  const cur = chatBinding.store.getState();
  const uploading = cur.attachments.filter((a) => isPendingPath(a.storagePath));
  if (uploading.length) {
    const ids = new Set(uploading.map((a) => a.messageId));
    next = {
      ...next,
      messages: [...next.messages, ...cur.messages.filter((x) => ids.has(x.id))],
      attachments: [...next.attachments, ...uploading],
      mentions: [...next.mentions, ...cur.mentions.filter((x) => ids.has(x.messageId))],
    };
  }
  replaceStore(chatBinding, next);
}

export function applyLibrary(s: LibrarySnapshot): void {
  replaceStore(libraryBinding, s.data);
  useLibraryExtras.setState(s.extras);
}

export function applySnapshot(s: Snapshot): void {
  applyCrm(s.crm);
  applyChat(s.chat);
  applyLibrary(s.library);
  useRemoteStore.setState({ directory: s.directory, rsvpCounts: s.rsvpCounts });
}
