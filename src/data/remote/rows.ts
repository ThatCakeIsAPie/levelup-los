/**
 * Row mappers: database rows (snake_case, src/data/remote/database.types.ts)
 * <-> the store types the app uses (camelCase, src/stores and
 * src/data/chat/types.ts). Pure functions, no client, no stores.
 *
 * Conventions:
 *  - `xFromRow(row)` accepts a full database row or the subset `xToRow`
 *    produces, so `xFromRow(xToRow(item))` gives the item back.
 *  - `xToRow(item)` returns only the columns the client manages. A value of
 *    `undefined` means "not managed" (the column keeps its database default /
 *    current value); `null` clears it.
 *  - Timestamps come back from Postgres as "2026-10-12 10:00:00+00"; they are
 *    normalised to `Date#toISOString()` so the app's string comparisons
 *    (`createdAt > lastReadAt`) keep working across client and server values.
 */
import { format } from "date-fns";
import type { Tables } from "./database.types";
import type { CrmPerson, StageChange } from "@/stores/peopleStore";
import type { CrmEvent } from "@/stores/eventsStore";
import type { CategoryIcon, CategoryTone, EventCategory } from "@/data/eventCategories/types";
import type { Attendance, MissedEventNote } from "@/stores/attendanceStore";
import type {
  Contact,
  Learning,
  LearningGoal,
  PodcastUnit,
  ReadingUnit,
  Sale,
  Settings,
} from "@/stores/crmStore";
import {
  itemsFromLegacy,
  legacyGoalColumns,
  normalizeItem,
  parseGoalItems,
} from "@/data/weeklyGoal";
import type {
  GrowthMilestoneCode,
  MilestoneHistory,
  MilestoneMark,
  PvOverride,
} from "@/data/growth/types";
import type { Campaign, Logistics, Payment, ReportSchedule, SharedCost } from "@/stores/opsStore";
import type { ActivityEvent } from "@/stores/activityStore";
import { sanitizeLayout, type HomeLayout } from "@/data/homeLayout";
import type {
  AnnouncementDraft,
  Attachment,
  Block,
  Conversation,
  ConversationMember,
  Mention,
  Message,
  MessageCard,
  Notification,
  Reaction,
  Report,
  WorkspaceMember,
} from "@/data/chat/types";
import type {
  CatalogItem,
  ChannelSection,
  LibraryChannel,
  LibraryProgress,
  LibraryTopic,
  Speaker,
} from "@/data/library/types";
import type {
  CancelReason,
  MilestoneCode,
  PipelineCard,
  PipelineMove,
  PipelineStep,
  StatRequest,
  StatShare,
  StepBand,
  StepCancellation,
  StepHide,
  TeamSetting,
} from "@/data/pipeline/types";
import type {
  CustomerBand,
  CustomerCard,
  CustomerMove,
  CustomerStep,
  ListEntry,
  ListRating,
} from "@/data/customerPipeline/types";
import type { Deputy, FeatureKey, FeatureSwitch } from "@/data/team/types";
import { asRating } from "@/data/rating";

export type Row = Record<string, unknown>;
type R<T extends keyof import("./database.types").Database["public"]["Tables"]> = Partial<
  Tables<T>
>;

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/** ISO timestamp (UTC, "Z"), or null. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
const isoOr = (v: unknown, fallback = ""): string => iso(v) ?? fallback;
/** null/undefined -> undefined (optional TS fields). */
const opt = <T>(v: T | null | undefined): T | undefined => (v === null ? undefined : v);
/** undefined -> null (nullable columns). */
const nul = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);
const num = (v: unknown): number | undefined =>
  v === null || v === undefined ? undefined : Number(v);
const numNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

// ---------------------------------------------------------------------------
// People, events, attendance
// ---------------------------------------------------------------------------

export function personFromRow(r: R<"people">): CrmPerson {
  const history = (r.stage_history as unknown as StageChange[] | null) ?? [];
  return {
    id: r.id!,
    name: r.name ?? "",
    email: opt(r.email),
    phone: opt(r.phone),
    bizClass: r.biz_class as CrmPerson["bizClass"],
    iboNumber: opt(r.ibo_number),
    ltdNumber: opt(r.ltd_number),
    location: opt(r.location),
    sponsorId: r.sponsor_id ?? null,
    businessStartDate: opt(r.business_start_date),
    joinedDate: opt(r.joined_date),
    ownerId: r.owner_id ?? null,
    monthlyVolume: num(r.monthly_volume),
    notes: opt(r.notes),
    pipelineStage: opt(r.pipeline_stage) as CrmPerson["pipelineStage"],
    stageHistory: history.length ? history : undefined,
    tags: r.tags?.length ? r.tags : undefined,
    lastUpdatedAt: iso(r.last_updated_at) ?? undefined,
    losUid: opt(r.los_uid),
    dittoSince: opt(r.ditto_since),
    referredBy: r.referred_by ?? null,
    referredByEntry: r.referred_by_entry ?? null,
  };
}

export function personToRow(p: CrmPerson): Row {
  return {
    id: p.id,
    name: p.name,
    email: nul(p.email),
    phone: nul(p.phone),
    biz_class: p.bizClass,
    ibo_number: nul(p.iboNumber),
    ltd_number: nul(p.ltdNumber),
    location: nul(p.location),
    sponsor_id: p.bizClass === "customer" ? null : (p.sponsorId ?? null),
    business_start_date: nul(p.businessStartDate),
    joined_date: nul(p.joinedDate),
    owner_id: p.bizClass === "customer" ? (p.ownerId ?? null) : null,
    monthly_volume: nul(p.monthlyVolume),
    notes: nul(p.notes),
    pipeline_stage: nul(p.pipelineStage),
    stage_history: p.stageHistory ?? [],
    tags: p.tags ?? [],
    last_updated_at: p.lastUpdatedAt ? iso(p.lastUpdatedAt) : undefined,
    los_uid: nul(p.losUid),
    ditto_since: nul(p.dittoSince),
    referred_by: p.referredBy ?? null,
    referred_by_entry: p.referredByEntry ?? null,
  };
}

export function eventFromRow(r: R<"events">): CrmEvent {
  return {
    id: r.id!,
    name: r.name ?? "",
    categoryId: r.category_id ?? "",
    date: r.date ?? "",
    endDate: opt(r.end_date),
    location: opt(r.location),
    notes: opt(r.notes),
    format: opt(r.format) as CrmEvent["format"],
    ticketUrl: opt(r.ticket_url),
  };
}

export function eventToRow(e: CrmEvent): Row {
  return {
    id: e.id,
    name: e.name,
    category_id: e.categoryId,
    date: e.date,
    end_date: nul(e.endDate),
    location: nul(e.location),
    notes: nul(e.notes),
    format: e.format ?? "in_person",
    ticket_url: nul(e.ticketUrl),
  };
}

export function eventCategoryFromRow(r: R<"event_categories">): EventCategory {
  return {
    id: r.id!,
    name: r.name ?? "",
    icon: (r.icon ?? "calendar") as CategoryIcon,
    tone: (r.tone ?? "neutral") as CategoryTone,
    allowsVirtual: !!r.allows_virtual,
    usesTickets: !!r.uses_tickets,
    usesTravel: !!r.uses_travel,
    countsForMissed: r.counts_for_missed_followups ?? true,
    welcomesCustomers: !!r.welcomes_customers,
    position: Number(r.position ?? 0),
    archivedAt: iso(r.archived_at) ?? undefined,
    createdBy: opt(r.created_by),
    createdAt: isoOr(r.created_at),
  };
}

/** Who made it and when are the database's (stamped on insert, never changed). */
export function eventCategoryToRow(c: EventCategory): Row {
  return {
    id: c.id,
    name: c.name,
    icon: c.icon,
    tone: c.tone,
    allows_virtual: c.allowsVirtual,
    uses_tickets: c.usesTickets,
    uses_travel: c.usesTravel,
    counts_for_missed_followups: c.countsForMissed,
    welcomes_customers: c.welcomesCustomers,
    position: c.position,
    archived_at: iso(c.archivedAt),
  };
}

export function attendanceFromRow(r: R<"attendances">): Attendance {
  return {
    id: r.id!,
    eventId: r.event_id!,
    personId: r.person_id!,
    desireToAttend: opt(r.desire_to_attend) as Attendance["desireToAttend"],
    followUpDate: opt(r.follow_up_date),
    hasTicket: !!r.has_ticket,
    mode: opt(r.mode) as Attendance["mode"],
    plannedPurchaseDate: opt(r.planned_purchase_date),
    helperId: r.helper_id ?? null,
    leadershipQualified: !!r.leadership_qualified,
    specialEventQualified: !!r.special_event_qualified,
    notes: opt(r.notes),
    attended: opt(r.attended),
    updatedAt: iso(r.updated_at) ?? undefined,
  };
}

export function attendanceToRow(a: Attendance): Row {
  return {
    id: a.id,
    event_id: a.eventId,
    person_id: a.personId,
    desire_to_attend: nul(a.desireToAttend),
    follow_up_date: nul(a.followUpDate),
    has_ticket: !!a.hasTicket,
    mode: nul(a.mode),
    planned_purchase_date: nul(a.plannedPurchaseDate),
    helper_id: a.helperId ?? null,
    leadership_qualified: !!a.leadershipQualified,
    special_event_qualified: !!a.specialEventQualified,
    notes: nul(a.notes),
    attended: nul(a.attended),
    updated_at: a.updatedAt ? iso(a.updatedAt) : undefined,
  };
}

export function missedNoteFromRow(r: R<"missed_event_notes">): MissedEventNote {
  return {
    id: r.id!,
    personId: r.person_id!,
    eventId: r.event_id!,
    note: r.note ?? "",
    byId: r.by_id ?? null,
    createdAt: isoOr(r.created_at),
  };
}

export function missedNoteToRow(n: MissedEventNote): Row {
  return {
    id: n.id,
    person_id: n.personId,
    event_id: n.eventId,
    note: n.note,
    // Stamped by the database on every client write (who and when).
    by_id: n.byId,
    created_at: iso(n.createdAt),
  };
}

// ---------------------------------------------------------------------------
// Ops: travel, shared costs, payments, campaigns, report schedules
// ---------------------------------------------------------------------------

export const logisticsKey = (eventId: string, personId: string) => `${eventId}:${personId}`;

export function logisticsFromRow(r: R<"logistics">): [string, Logistics] {
  const l: Logistics = {
    ticket: r.ticket as Logistics["ticket"],
    mode: r.mode as Logistics["mode"],
    carpool: r.carpool as Logistics["carpool"],
  };
  if (r.plan_date) l.planDate = r.plan_date;
  if (r.flight_booked !== null && r.flight_booked !== undefined) l.flightBooked = r.flight_booked;
  if (r.van_paid) l.vanPaid = r.van_paid as Logistics["vanPaid"];
  if (r.van_pay_date) l.vanPayDate = r.van_pay_date;
  return [logisticsKey(r.event_id!, r.person_id!), l];
}

export function logisticsToRow(key: string, l: Logistics): Row {
  const i = key.indexOf(":");
  return {
    event_id: key.slice(0, i),
    person_id: key.slice(i + 1),
    ticket: l.ticket,
    plan_date: nul(l.planDate),
    mode: l.mode,
    flight_booked: nul(l.flightBooked),
    carpool: l.carpool,
    van_paid: nul(l.vanPaid),
    van_pay_date: nul(l.vanPayDate),
  };
}

export function costFromRow(r: R<"shared_costs">): SharedCost {
  return {
    id: r.id!,
    eventId: r.event_id!,
    name: r.name ?? "",
    total: Number(r.total ?? 0),
    // Null only when the organizer was deleted with nobody to inherit it.
    ownerId: r.owner_id ?? "",
    members: [],
    overrides: {},
  };
}

export function costToRow(c: SharedCost): Row {
  return {
    id: c.id,
    event_id: c.eventId,
    name: c.name,
    total: c.total,
    owner_id: c.ownerId || null,
  };
}

export const paymentKey = (costId: string, personId: string) => `${costId}:${personId}`;

export function paymentFromRow(r: R<"payments">): [string, Payment] {
  return [
    paymentKey(r.cost_id!, r.person_id!),
    {
      paidAt: isoOr(r.paid_at),
      ref: r.ref ?? "",
      amount: num(r.amount),
      costName: opt(r.cost_name),
    },
  ];
}

export function paymentToRow(key: string, p: Payment): Row {
  const i = key.indexOf(":");
  return {
    cost_id: key.slice(0, i),
    person_id: key.slice(i + 1),
    paid_at: iso(p.paidAt),
    ref: p.ref,
    amount: nul(p.amount),
    cost_name: nul(p.costName),
  };
}

/** "YYYY-MM-DDTHH:mm" in local time (the Campaigns form's format). */
function localDateTime(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : format(d, "yyyy-MM-dd'T'HH:mm");
}

export function campaignFromRow(r: R<"campaigns">): Campaign {
  return {
    id: r.id!,
    ownerId: r.owner_id!,
    kind: r.kind as Campaign["kind"],
    message: r.message ?? "",
    recipients: r.recipients ?? [],
    scheduledFor: localDateTime(r.scheduled_for),
    createdAt: isoOr(r.created_at),
    status: "pending_send",
  };
}

export function campaignToRow(c: Campaign): Row {
  return {
    id: c.id,
    owner_id: c.ownerId,
    kind: c.kind,
    message: c.message,
    recipients: c.recipients,
    // A local date-time ("2026-10-20T14:00") is stored as that instant.
    scheduled_for: c.scheduledFor ? iso(new Date(c.scheduledFor)) : null,
    created_at: iso(c.createdAt),
    status: c.status,
  };
}

export function scheduleFromRow(r: R<"report_schedules">): ReportSchedule {
  return { ownerId: r.owner_id!, frequency: r.frequency as ReportSchedule["frequency"] };
}

export function scheduleToRow(s: ReportSchedule): Row {
  return { owner_id: s.ownerId, frequency: s.frequency };
}

// ---------------------------------------------------------------------------
// Contacts, sales, learning, goals, settings
// ---------------------------------------------------------------------------

export function contactFromRow(r: R<"contacts">): Contact {
  return {
    id: r.id!,
    personId: r.person_id!,
    byId: r.by_id ?? "",
    date: r.date ?? "",
    note: opt(r.note),
    source: (r.source as Contact["source"]) ?? "manual",
    ...(r.created_at ? { createdAt: isoOr(r.created_at) } : {}),
  };
}

export function contactToRow(c: Contact): Row {
  return {
    id: c.id,
    person_id: c.personId,
    by_id: c.byId || null,
    date: c.date,
    note: nul(c.note),
    source: c.source ?? "manual",
    // When it was logged ("What you did today"); the database stamps rows without it.
    ...(c.createdAt ? { created_at: c.createdAt } : {}),
  };
}

export function saleFromRow(r: R<"sales">): Sale {
  return {
    id: r.id!,
    customerId: r.customer_id!,
    product: r.product ?? "",
    date: r.date ?? "",
    amount: num(r.amount),
    pv: num(r.pv),
    personId: opt(r.person_id),
    ...(r.created_at ? { createdAt: isoOr(r.created_at) } : {}),
  };
}

export function saleToRow(s: Sale): Row {
  return {
    id: s.id,
    customer_id: s.customerId,
    product: s.product,
    date: s.date,
    amount: nul(s.amount),
    pv: nul(s.pv),
    // Left out when unknown: the database fills in the customer's owner.
    person_id: s.personId,
    ...(s.createdAt ? { created_at: s.createdAt } : {}),
  };
}

// Growth path: monthly PV set by uplines, milestones marked by hand. Who set
// them and when are stamped by the database (the client's values are shown
// until the next load).

export function pvOverrideFromRow(r: R<"pv_overrides">): PvOverride {
  return {
    personId: r.person_id!,
    month: r.month ?? "",
    pv: Number(r.pv ?? 0),
    setBy: opt(r.set_by),
    setAt: isoOr(r.set_at),
  };
}

export function pvOverrideToRow(o: PvOverride): Row {
  return {
    person_id: o.personId,
    month: o.month,
    pv: o.pv,
    set_by: nul(o.setBy),
    set_at: o.setAt,
  };
}

export function milestoneMarkFromRow(r: R<"milestone_marks">): MilestoneMark {
  return {
    personId: r.person_id!,
    code: r.code as GrowthMilestoneCode,
    reachedOn: r.reached_on ?? "",
    markedBy: opt(r.marked_by),
    markedAt: isoOr(r.marked_at),
    note: opt(r.note),
  };
}

export function milestoneMarkToRow(k: MilestoneMark): Row {
  return {
    person_id: k.personId,
    code: k.code,
    reached_on: k.reachedOn,
    marked_by: nul(k.markedBy),
    marked_at: k.markedAt,
    note: nul(k.note),
  };
}

// Milestone history the app records (the database keeps the earlier first
// day and the later last day, and stamps who recorded it and when).

export function milestoneHistoryFromRow(r: R<"milestone_history">): MilestoneHistory {
  return {
    personId: r.person_id!,
    code: r.code as GrowthMilestoneCode,
    firstReachedOn: r.first_reached_on ?? "",
    lastMetOn: r.last_met_on ?? "",
    recordedBy: opt(r.recorded_by),
    recordedAt: isoOr(r.recorded_at),
  };
}

export function milestoneHistoryToRow(h: MilestoneHistory): Row {
  return {
    person_id: h.personId,
    code: h.code,
    first_reached_on: h.firstReachedOn,
    last_met_on: h.lastMetOn,
    recorded_by: nul(h.recordedBy),
    recorded_at: h.recordedAt,
  };
}

export function learningFromRow(r: R<"learning">): Learning {
  return {
    id: r.id!,
    personId: r.person_id!,
    kind: r.kind as Learning["kind"],
    title: r.title ?? "",
    amount: Number(r.amount ?? 1),
    ...(r.unit ? { unit: r.unit as Learning["unit"] } : {}),
    date: r.date ?? "",
    ...(r.created_at ? { createdAt: isoOr(r.created_at) } : {}),
  };
}

export function learningToRow(l: Learning): Row {
  return {
    id: l.id,
    person_id: l.personId,
    kind: l.kind,
    title: l.title,
    amount: l.amount,
    unit: nul(l.unit),
    date: l.date,
    ...(l.createdAt ? { created_at: l.createdAt } : {}),
  };
}

/**
 * A weekly goal row. `items` null (rows from before lists) = the reading,
 * podcast and workshop targets in the old columns (src/data/weeklyGoal.ts).
 */
export function goalFromRow(r: R<"learning_goals">): [string, LearningGoal] {
  const items =
    r.items == null
      ? itemsFromLegacy({
          pages: Number(r.pages ?? 60),
          podcasts: Number(r.podcasts ?? 3),
          workshops: Number(r.workshops ?? 1),
          readingUnit: r.reading_unit as ReadingUnit | null,
          podcastUnit: r.podcast_unit as PodcastUnit | null,
        })
      : parseGoalItems(r.items);
  return [r.person_id!, { items }];
}

/** The list, plus the old columns kept in step for older clients. */
export function goalToRow(personId: string, g: LearningGoal): Row {
  // normalizeItem builds fresh {kind, target, unit?} objects, so the sync
  // engine's JSON comparison sees the same key order on both sides.
  const items = g.items.map(normalizeItem);
  const legacy = legacyGoalColumns(items);
  return {
    person_id: personId,
    items,
    pages: legacy.pages,
    podcasts: legacy.podcasts,
    workshops: legacy.workshops,
    reading_unit: legacy.readingUnit,
    podcast_unit: legacy.podcastUnit,
  };
}

export function settingsFromRow(r: R<"contact_settings">): Settings {
  return { customerDays: Number(r.customer_days ?? 30), teamDays: Number(r.team_days ?? 14) };
}

export function settingsToRow(personId: string, s: Settings): Row {
  return { person_id: personId, customer_days: s.customerDays, team_days: s.teamDays };
}

// ---------------------------------------------------------------------------
// Home card layout (dashboard_layouts)
// ---------------------------------------------------------------------------

/** A layout row; one the app can't read is the default (an empty list). */
export function homeLayoutFromRow(r: R<"dashboard_layouts">): [string, HomeLayout] {
  return [r.person_id!, sanitizeLayout(r.layout) ?? { order: [], side: [] }];
}

export function homeLayoutToRow(personId: string, l: HomeLayout): Row {
  return { person_id: personId, layout: { order: [...l.order], side: [...l.side] } };
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/** `me` and `myName` turn the viewer's own entries into "You" (and back). */
export function activityFromRow(r: R<"activity">, me: string): ActivityEvent {
  return {
    id: r.id!,
    timestamp: isoOr(r.timestamp),
    actorName: r.actor_id && r.actor_id === me ? "You" : (r.actor_name ?? "Someone"),
    // Not written back: the database stamps who did it.
    ...(r.actor_id ? { actorId: r.actor_id } : {}),
    entityType: r.entity_type as ActivityEvent["entityType"],
    entityId: r.entity_id!,
    relatedPersonId: opt(r.related_person_id),
    relatedEventId: opt(r.related_event_id),
    kind: r.kind as ActivityEvent["kind"],
    summary: r.summary ?? "",
    meta: (r.meta as Record<string, unknown> | null) ?? undefined,
  };
}

export function activityToRow(a: ActivityEvent, myName: string): Row {
  return {
    id: a.id,
    timestamp: iso(a.timestamp),
    actor_name: a.actorName === "You" ? myName || "You" : a.actorName,
    entity_type: a.entityType,
    entity_id: a.entityId,
    related_person_id: nul(a.relatedPersonId),
    related_event_id: nul(a.relatedEventId),
    kind: a.kind,
    summary: a.summary,
    meta: a.meta ?? null,
  };
}

// ---------------------------------------------------------------------------
// Chat (the "Chat data contract": the same fields, camelCase <-> snake_case)
// ---------------------------------------------------------------------------

export function memberFromRow(r: R<"members">): WorkspaceMember {
  return {
    workspaceId: r.workspace_id!,
    personId: r.person_id!,
    role: (r.role ?? "member") as WorkspaceMember["role"],
    joinedAt: isoOr(r.joined_at),
  };
}

export function memberToRow(m: WorkspaceMember): Row {
  return {
    workspace_id: m.workspaceId,
    person_id: m.personId,
    role: m.role,
    joined_at: iso(m.joinedAt),
  };
}

export function conversationFromRow(r: R<"conversations">): Conversation {
  return {
    id: r.id!,
    workspaceId: r.workspace_id!,
    kind: r.kind as Conversation["kind"],
    title: r.title ?? null,
    description: r.description ?? null,
    icon: r.icon ?? null,
    pinned: !!r.pinned,
    retentionDays: r.retention_days ?? null,
    createdBy: r.created_by ?? "",
    createdAt: isoOr(r.created_at),
    pinnedMessageId: r.pinned_message_id ?? null,
  };
}

export function conversationToRow(c: Conversation): Row {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    kind: c.kind,
    title: c.title,
    description: c.description,
    icon: c.icon,
    pinned: c.pinned,
    retention_days: c.retentionDays,
    created_by: c.createdBy || null,
    created_at: iso(c.createdAt),
    pinned_message_id: c.pinnedMessageId ?? null,
  };
}

export function conversationMemberFromRow(r: R<"conversation_members">): ConversationMember {
  return {
    conversationId: r.conversation_id!,
    personId: r.person_id!,
    role: (r.role ?? "member") as ConversationMember["role"],
    lastReadAt: iso(r.last_read_at),
    muted: !!r.muted,
    joinedAt: isoOr(r.joined_at),
    pinnedAt: iso(r.pinned_at),
  };
}

export function conversationMemberToRow(m: ConversationMember): Row {
  return {
    conversation_id: m.conversationId,
    person_id: m.personId,
    role: m.role,
    last_read_at: iso(m.lastReadAt),
    muted: m.muted,
    joined_at: iso(m.joinedAt),
    pinned_at: iso(m.pinnedAt),
  };
}

export function messageFromRow(r: R<"messages">): Message {
  return {
    id: r.id!,
    conversationId: r.conversation_id!,
    authorId: r.author_id ?? "",
    body: r.body ?? "",
    replyToId: r.reply_to_id ?? null,
    card: (r.card as unknown as MessageCard | null) ?? null,
    createdAt: isoOr(r.created_at),
    editedAt: iso(r.edited_at),
    deletedAt: iso(r.deleted_at),
  };
}

export function messageToRow(m: Message): Row {
  return {
    id: m.id,
    conversation_id: m.conversationId,
    author_id: m.authorId || null,
    body: m.body,
    reply_to_id: m.replyToId,
    card: m.card,
    created_at: iso(m.createdAt),
    edited_at: iso(m.editedAt),
    deleted_at: iso(m.deletedAt),
  };
}

export function attachmentFromRow(r: R<"attachments">): Attachment {
  return {
    id: r.id!,
    messageId: r.message_id!,
    kind: r.kind as Attachment["kind"],
    storagePath: r.storage_path ?? "",
    mime: r.mime ?? "",
    size: Number(r.size ?? 0),
    durationMs: numNull(r.duration_ms),
    width: numNull(r.width),
    height: numNull(r.height),
  };
}

export function attachmentToRow(a: Attachment): Row {
  return {
    id: a.id,
    message_id: a.messageId,
    kind: a.kind,
    storage_path: a.storagePath,
    mime: a.mime || null,
    size: a.size,
    duration_ms: a.durationMs,
    width: a.width,
    height: a.height,
  };
}

export function reactionFromRow(r: R<"reactions">): Reaction {
  return {
    messageId: r.message_id!,
    personId: r.person_id!,
    emoji: r.emoji!,
    createdAt: isoOr(r.created_at),
  };
}

export function reactionToRow(x: Reaction): Row {
  return {
    message_id: x.messageId,
    person_id: x.personId,
    emoji: x.emoji,
    created_at: iso(x.createdAt),
  };
}

export function mentionFromRow(r: R<"mentions">): Mention {
  return { messageId: r.message_id!, personId: r.person_id! };
}

export function mentionToRow(m: Mention): Row {
  return { message_id: m.messageId, person_id: m.personId };
}

export function draftFromRow(r: R<"announcement_drafts">): AnnouncementDraft {
  return {
    id: r.id!,
    conversationId: r.conversation_id!,
    authorId: r.author_id ?? "",
    body: r.body ?? "",
    card: (r.card as unknown as MessageCard | null) ?? null,
    status: (r.status ?? "pending") as AnnouncementDraft["status"],
    reviewerId: r.reviewer_id ?? null,
    reviewedAt: iso(r.reviewed_at),
    createdAt: isoOr(r.created_at),
  };
}

export function draftToRow(d: AnnouncementDraft): Row {
  return {
    id: d.id,
    conversation_id: d.conversationId,
    author_id: d.authorId || null,
    body: d.body,
    card: d.card,
    status: d.status,
    reviewer_id: d.reviewerId,
    reviewed_at: iso(d.reviewedAt),
    created_at: iso(d.createdAt),
  };
}

export function notificationFromRow(r: R<"notifications">): Notification {
  return {
    id: r.id!,
    recipientId: r.recipient_id!,
    type: r.type as Notification["type"],
    actorId: r.actor_id ?? null,
    conversationId: r.conversation_id ?? null,
    messageId: r.message_id ?? null,
    refId: r.ref_id ?? null,
    createdAt: isoOr(r.created_at),
    readAt: iso(r.read_at),
  };
}

export function notificationToRow(n: Notification): Row {
  return {
    id: n.id,
    recipient_id: n.recipientId,
    type: n.type,
    actor_id: n.actorId,
    conversation_id: n.conversationId,
    message_id: n.messageId,
    ref_id: n.refId,
    created_at: iso(n.createdAt),
    read_at: iso(n.readAt),
  };
}

export function reportFromRow(r: R<"reports">): Report {
  return {
    id: r.id!,
    messageId: r.message_id!,
    reporterId: r.reporter_id ?? "",
    reason: r.reason ?? "",
    createdAt: isoOr(r.created_at),
    resolvedAt: iso(r.resolved_at),
    resolvedBy: r.resolved_by ?? null,
  };
}

export function reportToRow(x: Report): Row {
  return {
    id: x.id,
    message_id: x.messageId,
    reporter_id: x.reporterId || null,
    reason: x.reason,
    created_at: iso(x.createdAt),
    resolved_at: iso(x.resolvedAt),
    resolved_by: x.resolvedBy,
  };
}

export function blockFromRow(r: R<"blocks">): Block {
  return { blockerId: r.blocker_id!, blockedId: r.blocked_id!, createdAt: isoOr(r.created_at) };
}

export function blockToRow(b: Block): Row {
  return { blocker_id: b.blockerId, blocked_id: b.blockedId, created_at: iso(b.createdAt) };
}

// ---------------------------------------------------------------------------
// Library (src/data/library/types.ts). An item's speakers and topics, and a
// channel's sections and lessons, live in their own tables.
// ---------------------------------------------------------------------------

export function topicFromRow(r: R<"library_topics">): LibraryTopic {
  return {
    id: r.id!,
    workspaceId: r.workspace_id!,
    name: r.name ?? "",
    createdBy: r.created_by ?? "",
    createdAt: isoOr(r.created_at),
  };
}

export function topicToRow(t: LibraryTopic): Row {
  return {
    id: t.id,
    workspace_id: t.workspaceId,
    name: t.name,
    created_by: t.createdBy || null,
    created_at: iso(t.createdAt),
  };
}

/** The item without its speakers and topics (filled from their tables). */
export function catalogItemFromRow(r: R<"library_items">): CatalogItem {
  return {
    id: r.id!,
    workspaceId: r.workspace_id!,
    title: r.title ?? "",
    description: r.description ?? null,
    kind: r.kind as CatalogItem["kind"],
    source: r.source as CatalogItem["source"],
    storagePath: r.storage_path ?? null,
    mime: r.mime ?? null,
    sizeBytes: numNull(r.size_bytes),
    fileName: r.file_name ?? null,
    linkUrl: r.link_url ?? null,
    linkProvider: (r.link_provider as CatalogItem["linkProvider"]) ?? null,
    durationSec: numNull(r.duration_sec),
    pageCount: numNull(r.page_count),
    speakers: [],
    format: (r.format as CatalogItem["format"]) ?? "talk",
    topicIds: [],
    eventId: r.event_id ?? null,
    recordedOn: r.recorded_on ?? null,
    createdBy: r.created_by ?? "",
    permissionConfirmed: r.permission_confirmed ?? true,
    visibility: (r.visibility as CatalogItem["visibility"]) ?? "team",
    createdAt: isoOr(r.created_at),
    updatedAt: isoOr(r.updated_at),
  };
}

export function catalogItemToRow(i: CatalogItem): Row {
  return {
    id: i.id,
    workspace_id: i.workspaceId,
    title: i.title,
    description: i.description,
    kind: i.kind,
    source: i.source,
    storage_path: i.storagePath,
    mime: i.mime,
    size_bytes: i.sizeBytes,
    file_name: i.fileName,
    link_url: i.linkUrl,
    link_provider: i.linkProvider,
    duration_sec: i.durationSec,
    page_count: i.pageCount,
    format: i.format,
    event_id: i.eventId,
    recorded_on: i.recordedOn,
    created_by: i.createdBy,
    permission_confirmed: i.permissionConfirmed,
    visibility: i.visibility,
    created_at: iso(i.createdAt),
    updated_at: iso(i.updatedAt),
  };
}

export function speakerToRow(itemId: string, position: number, s: Speaker): Row {
  return { item_id: itemId, position, person_id: s.personId, name: s.name };
}

export function speakerFromRow(r: R<"library_item_speakers">): Speaker {
  return { personId: r.person_id ?? null, name: r.person_id ? null : (r.name ?? null) };
}

/** The channel without its sections (filled from their tables). */
export function channelFromRow(r: R<"library_channels">): LibraryChannel {
  return {
    id: r.id!,
    workspaceId: r.workspace_id!,
    title: r.title ?? "",
    description: r.description ?? null,
    icon: r.icon ?? "book-open",
    color: (r.color as LibraryChannel["color"]) ?? "teal",
    createdBy: r.created_by ?? "",
    visibility: (r.visibility as LibraryChannel["visibility"]) ?? "team",
    sections: [],
    createdAt: isoOr(r.created_at),
    updatedAt: isoOr(r.updated_at),
  };
}

export function channelToRow(c: LibraryChannel): Row {
  return {
    id: c.id,
    workspace_id: c.workspaceId,
    title: c.title,
    description: c.description,
    icon: c.icon,
    color: c.color,
    created_by: c.createdBy,
    visibility: c.visibility,
    created_at: iso(c.createdAt),
    updated_at: iso(c.updatedAt),
  };
}

export function sectionToRow(channelId: string, position: number, s: ChannelSection): Row {
  return { id: s.id, channel_id: channelId, position, title: s.title };
}

export function channelItemToRow(
  channelId: string,
  sectionId: string,
  position: number,
  itemId: string,
): Row {
  return { section_id: sectionId, item_id: itemId, channel_id: channelId, position };
}

export function progressFromRow(r: R<"library_progress">): LibraryProgress {
  return {
    personId: r.person_id!,
    itemId: r.item_id!,
    positionSec: Number(r.position_sec ?? 0),
    completedAt: iso(r.completed_at),
    loggedAt: iso(r.logged_at),
    updatedAt: isoOr(r.updated_at),
  };
}

/** `logged_at` is the database's (set when finishing is logged): never sent. */
export function progressToRow(p: LibraryProgress): Row {
  return {
    person_id: p.personId,
    item_id: p.itemId,
    position_sec: p.positionSec,
    completed_at: iso(p.completedAt),
    updated_at: iso(p.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Pipeline (src/data/pipeline)
// ---------------------------------------------------------------------------

export function stepFromRow(r: R<"pipeline_steps">): PipelineStep {
  return {
    id: r.id!,
    ownerId: r.owner_id!,
    band: r.band as StepBand,
    label: r.label ?? "",
    position: Number(r.position ?? 0),
    createdAt: isoOr(r.created_at),
  };
}

export function stepToRow(s: PipelineStep): Row {
  return {
    id: s.id,
    owner_id: s.ownerId,
    band: s.band,
    label: s.label,
    position: s.position,
    created_at: iso(s.createdAt),
  };
}

export function hideFromRow(r: R<"pipeline_step_hides">): StepHide {
  return { personId: r.person_id!, stepId: r.step_id!, createdAt: isoOr(r.created_at) };
}

export function hideToRow(h: StepHide): Row {
  return { person_id: h.personId, step_id: h.stepId, created_at: iso(h.createdAt) };
}

/** `column_id` and `entered_at` only change through moves (see the cards binding). */
export function cardFromRow(r: R<"pipeline_cards">): PipelineCard {
  return {
    personId: r.person_id!,
    column: r.column_id ?? "contact",
    enteredAt: isoOr(r.entered_at),
    nextColumn: r.next_column ?? null,
    nextStepDate: r.next_step_date ?? null,
    nextStepTime: hhmm(r.next_step_time),
    note: r.note ?? null,
    rating: asRating(r.rating) ?? (r.hot ? "hot" : null),
    source: r.source ?? null,
    droppedAt: iso(r.dropped_at),
    updatedAt: isoOr(r.updated_at),
  };
}

/** `updated_at` is the database's (stamped on every change): never sent. */
export function cardToRow(c: PipelineCard): Row {
  return {
    person_id: c.personId,
    column_id: c.column,
    entered_at: iso(c.enteredAt),
    next_column: c.nextColumn,
    next_step_date: c.nextStepDate,
    next_step_time: c.nextStepTime,
    note: c.note,
    rating: c.rating,
    // Kept in step with the rating (the move RPC and older clients use it).
    hot: c.rating === "hot",
    source: c.source,
    dropped_at: iso(c.droppedAt),
  };
}

export function moveFromRow(r: R<"pipeline_moves">): PipelineMove {
  return {
    id: r.id!,
    personId: r.person_id!,
    ownerId: r.owner_id ?? "",
    from: r.from_column ?? null,
    to: r.to_column!,
    milestone: r.milestone as MilestoneCode,
    movedAt: isoOr(r.moved_at),
    movedBy: r.moved_by ?? "",
  };
}

export function moveToRow(m: PipelineMove): Row {
  return {
    id: m.id,
    person_id: m.personId,
    owner_id: m.ownerId || null,
    from_column: m.from,
    to_column: m.to,
    milestone: m.milestone,
    moved_at: iso(m.movedAt),
    moved_by: m.movedBy || null,
  };
}

/** Postgres `time` ("19:00:00") as the app keeps it ("19:00"). */
export const hhmm = (v: string | null | undefined): string | null => (v ? v.slice(0, 5) : null);

export function stepCancellationFromRow(r: R<"pipeline_step_cancellations">): StepCancellation {
  return {
    id: r.id!,
    board: r.board === "customer" ? "customer" : "recruiting",
    cardId: r.card_id!,
    ownerId: r.owner_id ?? "",
    column: r.column_id!,
    bookedDate: r.booked_date ?? null,
    bookedTime: hhmm(r.booked_time),
    reason: r.reason as CancelReason,
    reasonText: r.reason_text ?? null,
    cancelledAt: isoOr(r.cancelled_at),
    cancelledBy: r.cancelled_by ?? "",
  };
}

export function stepCancellationToRow(c: StepCancellation): Row {
  return {
    id: c.id,
    board: c.board,
    card_id: c.cardId,
    owner_id: c.ownerId || null,
    column_id: c.column,
    booked_date: c.bookedDate,
    booked_time: c.bookedTime,
    reason: c.reason,
    reason_text: c.reasonText,
    cancelled_at: iso(c.cancelledAt),
    cancelled_by: c.cancelledBy || null,
  };
}

export function teamSettingFromRow(r: R<"pipeline_team_settings">): TeamSetting {
  const t1 = r.target_contact_to_meeting;
  return {
    personId: r.person_id!,
    mg1Goal: r.mg1_goal ?? null,
    targets:
      t1 === null || t1 === undefined
        ? null
        : {
            contactToMeeting: Number(t1),
            meetingToPlan: Number(r.target_meeting_to_plan),
            planToRegistered: Number(r.target_plan_to_registered),
          },
    updatedAt: isoOr(r.updated_at),
  };
}

/** `updated_at` is stamped by the database: never sent. */
export function teamSettingToRow(t: TeamSetting): Row {
  return {
    person_id: t.personId,
    mg1_goal: t.mg1Goal,
    target_contact_to_meeting: t.targets?.contactToMeeting ?? null,
    target_meeting_to_plan: t.targets?.meetingToPlan ?? null,
    target_plan_to_registered: t.targets?.planToRegistered ?? null,
  };
}

/** A share's id is its owner and viewer (the table's key). */
export const shareId = (ownerId: string, viewerId: string) => `${ownerId}:${viewerId}`;

export function shareFromRow(r: R<"stat_shares">): StatShare {
  return {
    id: shareId(r.owner_id!, r.viewer_id!),
    ownerId: r.owner_id!,
    viewerId: r.viewer_id!,
    createdAt: isoOr(r.created_at),
  };
}

export function shareToRow(s: StatShare): Row {
  return { owner_id: s.ownerId, viewer_id: s.viewerId, created_at: iso(s.createdAt) };
}

export function statRequestFromRow(r: R<"stat_requests">): StatRequest {
  return {
    id: r.id!,
    requesterId: r.requester_id!,
    ownerId: r.owner_id!,
    status: (r.status ?? "pending") as StatRequest["status"],
    createdAt: isoOr(r.created_at),
    decidedAt: iso(r.decided_at),
  };
}

export function statRequestToRow(q: StatRequest): Row {
  return {
    id: q.id,
    requester_id: q.requesterId,
    owner_id: q.ownerId,
    status: q.status,
    created_at: iso(q.createdAt),
    decided_at: iso(q.decidedAt),
  };
}

// ---------------------------------------------------------------------------
// Your list and the customer pipeline (src/data/customerPipeline)
// ---------------------------------------------------------------------------

export function listEntryFromRow(r: R<"list_entries">): ListEntry {
  return {
    id: r.id!,
    ownerId: r.owner_id!,
    name: r.name ?? "",
    howKnown: r.how_known ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    notes: r.notes ?? null,
    rating: asRating(r.rating) as ListRating | null,
    customerId: r.customer_id ?? null,
    prospectId: r.prospect_id ?? null,
    referredBy: r.referred_by ?? null,
    referredByEntry: r.referred_by_entry ?? null,
    addedBy: r.added_by ?? r.owner_id ?? "",
    createdAt: isoOr(r.created_at),
    updatedAt: isoOr(r.updated_at),
  };
}

/**
 * `customer_id` is the database's (move_customer_card() sets it) and
 * `updated_at` is stamped on every change: neither is sent.
 */
export function listEntryToRow(e: ListEntry): Row {
  return {
    id: e.id,
    owner_id: e.ownerId,
    name: e.name,
    how_known: e.howKnown,
    phone: e.phone,
    email: e.email,
    notes: e.notes,
    rating: e.rating,
    prospect_id: e.prospectId,
    referred_by: e.referredBy ?? null,
    referred_by_entry: e.referredByEntry ?? null,
    added_by: e.addedBy || null,
    created_at: iso(e.createdAt),
  };
}

export function customerStepFromRow(r: R<"customer_steps">): CustomerStep {
  return {
    id: r.id!,
    ownerId: r.owner_id!,
    band: r.band as CustomerStep["band"],
    label: r.label ?? "",
    position: Number(r.position ?? 0),
    createdAt: isoOr(r.created_at),
  };
}

export function customerStepToRow(s: CustomerStep): Row {
  return {
    id: s.id,
    owner_id: s.ownerId,
    band: s.band,
    label: s.label,
    position: s.position,
    created_at: iso(s.createdAt),
  };
}

export function customerHideFromRow(r: R<"customer_step_hides">): StepHide {
  return { personId: r.person_id!, stepId: r.step_id!, createdAt: isoOr(r.created_at) };
}

export function customerHideToRow(h: StepHide): Row {
  return { person_id: h.personId, step_id: h.stepId, created_at: iso(h.createdAt) };
}

/** `column_id` and `entered_at` only change through moves (see the cards binding). */
export function customerCardFromRow(r: R<"customer_cards">): CustomerCard {
  return {
    entryId: r.entry_id!,
    column: r.column_id ?? "not_contacted",
    enteredAt: isoOr(r.entered_at),
    nextColumn: r.next_column ?? null,
    nextStepDate: r.next_step_date ?? null,
    nextStepTime: hhmm(r.next_step_time),
    note: r.note ?? null,
    updatedAt: isoOr(r.updated_at),
  };
}

/** `updated_at` is the database's: never sent. */
export function customerCardToRow(c: CustomerCard): Row {
  return {
    entry_id: c.entryId,
    column_id: c.column,
    entered_at: iso(c.enteredAt),
    next_column: c.nextColumn,
    next_step_date: c.nextStepDate,
    next_step_time: c.nextStepTime,
    note: c.note,
  };
}

export function customerMoveFromRow(r: R<"customer_moves">): CustomerMove {
  return {
    id: r.id!,
    entryId: r.entry_id!,
    ownerId: r.owner_id ?? "",
    from: r.from_column ?? null,
    to: r.to_column!,
    band: r.band as CustomerBand,
    movedAt: isoOr(r.moved_at),
    movedBy: r.moved_by ?? "",
    createdCustomerId: r.created_customer_id ?? null,
    setDitto: !!r.set_ditto,
  };
}

export function customerMoveToRow(m: CustomerMove): Row {
  return {
    id: m.id,
    entry_id: m.entryId,
    owner_id: m.ownerId || null,
    from_column: m.from,
    to_column: m.to,
    band: m.band,
    moved_at: iso(m.movedAt),
    moved_by: m.movedBy || null,
    created_customer_id: m.createdCustomerId,
    set_ditto: m.setDitto,
  };
}

// ---------------------------------------------------------------------------
// Team settings: deputies, feature switches (src/data/team)
// ---------------------------------------------------------------------------

export function deputyFromRow(r: R<"deputies">): Deputy {
  return {
    leaderId: r.leader_id ?? "",
    deputyId: r.deputy_id ?? "",
    addedBy: opt(r.added_by),
    addedAt: iso(r.added_at) ?? undefined,
  };
}

export function deputyToRow(d: Deputy): Row {
  return {
    leader_id: d.leaderId,
    deputy_id: d.deputyId,
    added_by: nul(d.addedBy),
    added_at: iso(d.addedAt),
  };
}

export function featureSwitchFromRow(r: R<"feature_switches">): FeatureSwitch {
  return {
    workspaceId: r.workspace_id ?? "",
    feature: r.feature as FeatureKey,
    enabled: !!r.enabled,
    updatedBy: opt(r.updated_by),
    updatedAt: iso(r.updated_at) ?? undefined,
  };
}

export function featureSwitchToRow(s: FeatureSwitch): Row {
  return {
    workspace_id: s.workspaceId,
    feature: s.feature,
    enabled: s.enabled,
    updated_by: nul(s.updatedBy),
    updated_at: iso(s.updatedAt),
  };
}
