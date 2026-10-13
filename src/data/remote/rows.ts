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
import type { Attendance } from "@/stores/attendanceStore";
import type { Contact, Learning, LearningGoal, Sale, Settings } from "@/stores/crmStore";
import type { Campaign, Logistics, Payment, ReportSchedule, SharedCost } from "@/stores/opsStore";
import type { ActivityEvent } from "@/stores/activityStore";
import type {
  AnnouncementDraft,
  Attachment,
  Block,
  Conversation,
  ConversationMember,
  LibraryItem,
  Mention,
  Message,
  MessageCard,
  Notification,
  Reaction,
  Report,
  WorkspaceMember,
} from "@/data/chat/types";

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
  };
}

export function eventFromRow(r: R<"events">): CrmEvent {
  return {
    id: r.id!,
    name: r.name ?? "",
    type: r.type as CrmEvent["type"],
    date: r.date ?? "",
    endDate: opt(r.end_date),
    location: opt(r.location),
    notes: opt(r.notes),
  };
}

export function eventToRow(e: CrmEvent): Row {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    date: e.date,
    end_date: nul(e.endDate),
    location: nul(e.location),
    notes: nul(e.notes),
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
    ticketType: opt(r.ticket_type) as Attendance["ticketType"],
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
    ticket_type: nul(a.ticketType),
    planned_purchase_date: nul(a.plannedPurchaseDate),
    helper_id: a.helperId ?? null,
    leadership_qualified: !!a.leadershipQualified,
    special_event_qualified: !!a.specialEventQualified,
    notes: nul(a.notes),
    attended: nul(a.attended),
    updated_at: a.updatedAt ? iso(a.updatedAt) : undefined,
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
  };
}

export function saleFromRow(r: R<"sales">): Sale {
  return {
    id: r.id!,
    customerId: r.customer_id!,
    product: r.product ?? "",
    date: r.date ?? "",
    amount: num(r.amount),
  };
}

export function saleToRow(s: Sale): Row {
  return {
    id: s.id,
    customer_id: s.customerId,
    product: s.product,
    date: s.date,
    amount: nul(s.amount),
  };
}

export function learningFromRow(r: R<"learning">): Learning {
  return {
    id: r.id!,
    personId: r.person_id!,
    kind: r.kind as Learning["kind"],
    title: r.title ?? "",
    amount: Number(r.amount ?? 1),
    date: r.date ?? "",
  };
}

export function learningToRow(l: Learning): Row {
  return {
    id: l.id,
    person_id: l.personId,
    kind: l.kind,
    title: l.title,
    amount: l.amount,
    date: l.date,
  };
}

export function goalFromRow(r: R<"learning_goals">): [string, LearningGoal] {
  return [
    r.person_id!,
    {
      pages: Number(r.pages ?? 60),
      podcasts: Number(r.podcasts ?? 3),
      workshops: Number(r.workshops ?? 1),
    },
  ];
}

export function goalToRow(personId: string, g: LearningGoal): Row {
  return { person_id: personId, pages: g.pages, podcasts: g.podcasts, workshops: g.workshops };
}

export function settingsFromRow(r: R<"contact_settings">): Settings {
  return { customerDays: Number(r.customer_days ?? 30), teamDays: Number(r.team_days ?? 14) };
}

export function settingsToRow(personId: string, s: Settings): Row {
  return { person_id: personId, customer_days: s.customerDays, team_days: s.teamDays };
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

export function libraryFromRow(r: R<"library_items">): LibraryItem {
  return {
    id: r.id!,
    workspaceId: r.workspace_id!,
    kind: r.kind as LibraryItem["kind"],
    title: r.title ?? "",
    durationSec: r.duration_sec ?? null,
    url: r.url ?? "",
    createdBy: r.created_by ?? "",
    createdAt: isoOr(r.created_at),
  };
}

export function libraryToRow(l: LibraryItem): Row {
  return {
    id: l.id,
    workspace_id: l.workspaceId,
    kind: l.kind,
    title: l.title,
    duration_sec: l.durationSec,
    url: l.url,
    created_by: l.createdBy || null,
    created_at: iso(l.createdAt),
  };
}
