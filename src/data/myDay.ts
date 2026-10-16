/**
 * "What you did today" (Home): the viewer's own actions today, newest first,
 * merged from the records the app already keeps (no log of its own):
 *
 *  - check-ins and contacts you logged (`Contact.byId`, by hand)
 *  - sales you logged (whose PV it is: you), learning you logged
 *  - recruiting and customer pipeline moves you made (`movedBy`), booked steps
 *    you cancelled (`StepCancellation.cancelledBy`)
 *  - names you added to a list (`ListEntry.addedBy`), "already handled" notes
 *  - the activity timeline's entries by you ("You"): people added, removed or
 *    edited, events created, people added to events, tickets, attendance,
 *    weekly goal edits.
 *
 * Contacts, sales and learning carry `createdAt` since 2026-10-16; older rows
 * only have their day, so they show without a time (after the timed ones).
 * The rules are pure (`myDayItems`) and tested in `myDay.test.ts`.
 */
import { useMemo } from "react";
import { format } from "date-fns";
import { useActivityStore, type ActivityEvent } from "@/stores/activityStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import {
  learningLine,
  useCrmStore,
  type Contact,
  type Learning,
  type Sale,
} from "@/stores/crmStore";
import { useEventsStore, type CrmEvent } from "@/stores/eventsStore";
import { usePeopleStore, type CrmPerson } from "@/stores/peopleStore";
import { localDate } from "@/lib/dates";
import type { MissedEventNote } from "@/stores/attendanceStore";
import { useCustomerPipelineStore } from "./customerPipeline/store";
import { useCustomerColumns } from "./customerPipeline/hooks";
import { CUSTOMER_BAND_LABEL, type CustomerMove, type ListEntry } from "./customerPipeline/types";
import { usePipelineStore } from "./pipeline/store";
import { usePipelineColumns } from "./pipeline/hooks";
import { bookingLabel, cancelSummary } from "./pipeline/booking";
import {
  RECRUITING_BAND_LABEL,
  type PipelineColumn,
  type PipelineMove,
  type StepCancellation,
} from "./pipeline/types";
import { saleSellerId } from "./growth/engine";
import { useViewer } from "./session";

export type MyDayKind =
  | "checkin"
  | "sale"
  | "learning"
  | "pipeline"
  | "customer_pipeline"
  | "step"
  | "list"
  | "person"
  | "event"
  | "goal"
  | "note";

export interface MyDayItem {
  id: string;
  kind: MyDayKind;
  text: string;
  /** ISO time it happened; null when only the day is known. */
  at: string | null;
  /** "3:05 PM" (local), or null. */
  time: string | null;
  /** The person it's about, when there's one to open. */
  personId?: string;
  eventId?: string;
}

export interface MyDayInput {
  viewerId: string;
  /** "YYYY-MM-DD", the viewer's today. */
  today: string;
  people: readonly CrmPerson[];
  events: readonly CrmEvent[];
  activity: readonly ActivityEvent[];
  contacts: readonly Contact[];
  sales: readonly Sale[];
  learning: readonly Learning[];
  pipelineMoves: readonly PipelineMove[];
  cancellations: readonly StepCancellation[];
  customerMoves: readonly CustomerMove[];
  entries: readonly ListEntry[];
  missedNotes: readonly MissedEventNote[];
  /** The viewer's boards, for column names (others fall back to the band). */
  recruitingColumns?: readonly PipelineColumn<string>[];
  customerColumns?: readonly PipelineColumn<string>[];
}

/** The local day of an ISO time (or a "YYYY-MM-DD" day as is). */
const dayOf = (s: string) => (s.length <= 10 ? s : localDate(new Date(s)));
const timeOf = (iso: string | null) => (iso ? format(new Date(iso), "h:mm a") : null);

/** The viewer's own actions today, newest first (untimed ones last). */
export function myDayItems(input: MyDayInput): MyDayItem[] {
  const { viewerId: me, today } = input;
  const isToday = (s: string | null | undefined) => !!s && dayOf(s) === today;
  const people = new Map(input.people.map((p) => [p.id, p] as const));
  const nameOf = (id: string | null | undefined, fallback = "someone") =>
    id === me ? "yourself" : ((id && people.get(id)?.name) ?? fallback);
  const eventName = new Map(input.events.map((e) => [e.id, e.name] as const));
  const entries = new Map(input.entries.map((e) => [e.id, e] as const));
  const recruitingCols = new Map((input.recruitingColumns ?? []).map((c) => [c.id, c]));
  const customerCols = new Map((input.customerColumns ?? []).map((c) => [c.id, c]));
  const out: MyDayItem[] = [];
  const push = (it: Omit<MyDayItem, "time">) => out.push({ ...it, time: timeOf(it.at) });

  // Check-ins and contacts you logged by hand.
  for (const c of input.contacts) {
    if (c.byId !== me || c.date !== today || (c.source && c.source !== "manual")) continue;
    const p = people.get(c.personId);
    const customer = p?.bizClass === "customer";
    push({
      id: `contact:${c.id}`,
      kind: "checkin",
      text: `${customer ? "Got in touch with" : "Checked in with"} ${nameOf(c.personId)}`,
      at: c.createdAt ?? null,
      personId: c.personId,
    });
  }

  // Sales you logged (PV that counts toward you), including your own orders.
  for (const s of input.sales) {
    if (s.date !== today || saleSellerId(s, people) !== me) continue;
    const own = s.customerId === me;
    const extra = [
      s.amount !== undefined ? `$${s.amount.toLocaleString("en-US")}` : null,
      s.pv ? `${s.pv} PV` : null,
    ].filter(Boolean);
    push({
      id: `sale:${s.id}`,
      kind: "sale",
      text: `${own ? "Logged your own order" : `Logged a sale to ${nameOf(s.customerId)}`}: ${s.product}${
        extra.length ? ` · ${extra.join(" · ")}` : ""
      }`,
      at: s.createdAt ?? null,
      personId: own ? undefined : s.customerId,
    });
  }

  for (const l of input.learning) {
    if (l.personId !== me || l.date !== today) continue;
    push({
      id: `learning:${l.id}`,
      kind: "learning",
      text: learningLine(l),
      at: l.createdAt ?? null,
    });
  }

  // Recruiting pipeline moves you made.
  const movedToday = new Set<string>();
  for (const m of input.pipelineMoves) {
    if (m.movedBy !== me || !isToday(m.movedAt)) continue;
    movedToday.add(m.personId);
    // Someone no longer here (removed since): nothing to show.
    if (!people.has(m.personId)) continue;
    const name = nameOf(m.personId);
    const col = recruitingCols.get(m.to);
    const label = col?.label ?? RECRUITING_BAND_LABEL[m.milestone] ?? m.to;
    push({
      id: `move:${m.id}`,
      kind: "pipeline",
      text:
        m.to === "registered"
          ? `${name} registered`
          : m.from === null
            ? `Put ${name} on the recruiting pipeline (${label})`
            : `Moved ${name} to ${label}`,
      at: m.movedAt,
      personId: m.personId,
    });
  }

  // Customer pipeline moves you made.
  for (const m of input.customerMoves) {
    if (m.movedBy !== me || !isToday(m.movedAt)) continue;
    const entry = entries.get(m.entryId);
    if (!entry) continue;
    const name = entry.name;
    const label = customerCols.get(m.to)?.label ?? CUSTOMER_BAND_LABEL[m.band] ?? m.to;
    push({
      id: `cmove:${m.id}`,
      kind: "customer_pipeline",
      text:
        m.from === null
          ? `Started ${name} on the customer pipeline (${label})`
          : `Moved ${name} to ${label} on the customer pipeline`,
      at: m.movedAt,
      personId: m.createdCustomerId ?? entry.customerId ?? undefined,
    });
  }

  // Booked steps you cancelled.
  for (const c of input.cancellations) {
    if (c.cancelledBy !== me || !isToday(c.cancelledAt)) continue;
    const name =
      c.board === "customer"
        ? (entries.get(c.cardId)?.name ?? "a name on your list")
        : nameOf(c.cardId, "a prospect");
    const col = (c.board === "customer" ? customerCols : recruitingCols).get(c.column);
    const step = col ? bookingLabel(col) : "Next step";
    push({
      id: `cancel:${c.id}`,
      kind: "step",
      text: `${name}: ${cancelSummary(step, c.reason, c.reasonText)}`,
      at: c.cancelledAt,
      personId: c.board === "recruiting" ? c.cardId : undefined,
    });
  }

  // Names you added to a list (yours or a downline's).
  for (const e of input.entries) {
    if (e.addedBy !== me || !isToday(e.createdAt)) continue;
    push({
      id: `entry:${e.id}`,
      kind: "list",
      text:
        e.ownerId === me
          ? `Added ${e.name} to your list`
          : `Added ${e.name} to ${nameOf(e.ownerId, "a teammate")}'s list`,
      at: e.createdAt,
    });
  }

  // "Already handled" notes on missed events.
  for (const n of input.missedNotes) {
    if (n.byId !== me || !isToday(n.createdAt)) continue;
    push({
      id: `missed:${n.id}`,
      kind: "note",
      text: `Noted ${nameOf(n.personId)} missing ${eventName.get(n.eventId) ?? "an event"}: ${n.note}`,
      at: n.createdAt,
      personId: n.personId,
    });
  }

  // The activity timeline: what you did to people and events.
  for (const a of input.activity) {
    const mine = a.actorId ? a.actorId === me : a.actorName === "You";
    if (!mine || !isToday(a.timestamp)) continue;
    const it = fromActivity(a, me, nameOf, eventName, movedToday);
    if (it) push({ ...it, id: `activity:${a.id}`, at: a.timestamp });
  }

  return out.sort((a, b) => {
    if (a.at && b.at) return b.at.localeCompare(a.at);
    if (a.at || b.at) return a.at ? -1 : 1;
    return a.text.localeCompare(b.text);
  });
}

function fromActivity(
  a: ActivityEvent,
  me: string,
  nameOf: (id: string | null | undefined, fallback?: string) => string,
  eventName: Map<string, string>,
  movedToday: Set<string>,
): Pick<MyDayItem, "kind" | "text" | "personId" | "eventId"> | null {
  const personId = a.relatedPersonId;
  const who = nameOf(personId);
  const ev = a.relatedEventId ? (eventName.get(a.relatedEventId) ?? "an event") : "an event";
  const self = personId === me;
  switch (a.kind) {
    case "created":
      return a.entityType === "event"
        ? { kind: "event", text: a.summary || `Created ${ev}`, eventId: a.entityId }
        : { kind: "person", text: a.summary || `Added ${who}`, personId };
    case "deleted":
      if (a.entityType === "attendance")
        return { kind: "event", text: `Took ${who} off ${ev}`, eventId: a.relatedEventId };
      return { kind: a.entityType === "event" ? "event" : "person", text: a.summary };
    case "assigned_event":
      return {
        kind: "event",
        text: self ? `Signed up for ${ev}` : `Added ${who} to ${ev}`,
        personId,
        eventId: a.relatedEventId,
      };
    case "ticket_purchased":
      return {
        kind: "event",
        text: self ? `Got your ticket for ${ev}` : `Marked ${who}'s ticket for ${ev} as bought`,
        personId,
        eventId: a.relatedEventId,
      };
    case "marked_attended":
      return {
        kind: "event",
        text: self ? `Went to ${ev}` : `Marked ${who} as at ${ev}`,
        personId,
        eventId: a.relatedEventId,
      };
    case "marked_no_show":
      return {
        kind: "event",
        text: `Marked ${who} as a no-show at ${ev}`,
        personId,
        eventId: a.relatedEventId,
      };
    case "stage_changed":
      // A pipeline move says it better.
      if (personId && movedToday.has(personId)) return null;
      return { kind: "person", text: `Changed ${who}'s stage`, personId };
    case "updated":
      if (a.meta?.goal) {
        return {
          kind: "goal",
          text: self ? "Updated your weekly goal" : `Updated ${who}'s weekly goal`,
          personId,
        };
      }
      if (a.entityType === "event")
        return { kind: "event", text: `Edited ${ev}`, eventId: a.entityId };
      // Only edits by hand ("Edited phone, email"), not moves after a removal or undos.
      if (!a.summary.startsWith("Edited ")) return null;
      return {
        kind: "person",
        text: self ? "Updated your details" : `Updated ${who}'s details`,
        personId,
      };
    case "note":
      // Cancelled steps come from the cancellations themselves.
      if (a.meta?.cancellationId) return null;
      return { kind: "note", text: a.summary, personId };
  }
  return null;
}

/** Home's "What you did today" for the signed-in person. */
export function useMyDay(): MyDayItem[] {
  const viewer = useViewer();
  const me = viewer?.personId ?? "";
  const people = usePeopleStore((s) => s.people);
  const events = useEventsStore((s) => s.events);
  const activity = useActivityStore((s) => s.events);
  const contacts = useCrmStore((s) => s.contacts);
  const sales = useCrmStore((s) => s.sales);
  const learning = useCrmStore((s) => s.learning);
  const pipelineMoves = usePipelineStore((s) => s.moves);
  const cancellations = usePipelineStore((s) => s.cancellations);
  const customerMoves = useCustomerPipelineStore((s) => s.moves);
  const entries = useCustomerPipelineStore((s) => s.entries);
  const missedNotes = useAttendanceStore((s) => s.missedNotes);
  const candidate = viewer?.role === "candidate";
  const recruitingColumns = usePipelineColumns(candidate ? undefined : me);
  const customerColumns = useCustomerColumns(candidate ? undefined : me);
  const today = localDate();
  return useMemo(
    () =>
      me
        ? myDayItems({
            viewerId: me,
            today,
            people,
            events,
            activity,
            contacts,
            sales,
            learning,
            pipelineMoves,
            cancellations,
            customerMoves,
            entries,
            missedNotes,
            recruitingColumns,
            customerColumns,
          })
        : [],
    [
      me,
      today,
      people,
      events,
      activity,
      contacts,
      sales,
      learning,
      pipelineMoves,
      cancellations,
      customerMoves,
      entries,
      missedNotes,
      recruitingColumns,
      customerColumns,
    ],
  );
}
