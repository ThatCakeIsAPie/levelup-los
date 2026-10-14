import { useMemo } from "react";
import {
  learningUnit,
  parseDate,
  unitAmount,
  useActivity,
  useAttendancesForPerson,
  useChatPeople,
  useMissedNotes,
  useContacts,
  useCurrentUser,
  useEvents,
  useLearning,
  useSales,
  useVisiblePeople,
  type ActivityEvent,
} from "@/data";
import { fmtMoney } from "./format";

export type Dot = "primary" | "sky" | "amber" | "navy" | "neutral";

export interface FeedItem {
  id: string;
  at: number;
  /** "YYYY-MM-DD" or ISO timestamp. */
  when: string;
  text: string;
  sub?: string;
  dot: Dot;
  /** A logged check-in or sale the current user may delete. */
  remove?: { kind: "contact" | "sale"; id: string; label: string };
}

const STAGE_NAME: Record<string, string> = {
  prospect: "Prospect",
  apprentice: "Apprentice",
  ibo: "IBO",
};

/** Date-only strings sort as midday local time so same-day timestamps interleave sensibly. */
const timeOf = (s: string) => (s.length <= 10 ? parseDate(`${s}T12:00:00`) : new Date(s)).getTime();

/**
 * One merged, newest-first timeline for a person: activity log (stage changes,
 * events, edits, notes), check-ins, learning, events they came to (on the
 * event's day, in person or virtual), missed-event notes and (for customers)
 * purchases.
 */
export function usePersonFeed(personId: string): FeedItem[] {
  const activity = useActivity(personId);
  const contacts = useContacts(personId);
  const learning = useLearning(personId);
  const sales = useSales(personId);
  const events = useEvents();
  const people = useVisiblePeople();
  const me = useCurrentUser();
  const attendances = useAttendancesForPerson(personId);
  const allNotes = useMissedNotes();
  // Note authors are uplines, often outside the viewer's CRM view.
  const directory = useChatPeople();

  return useMemo(() => {
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const personName = new Map(people.map((p) => [p.id, p.name]));
    const out: FeedItem[] = [];

    // Attendance shows on the event's day (below), not when it was recorded.
    for (const e of activity)
      if (e.kind !== "marked_attended") out.push(fromActivity(e, eventName));

    const eventById = new Map(events.map((e) => [e.id, e]));
    for (const a of attendances) {
      const ev = eventById.get(a.eventId);
      if (a.attended !== true || !ev) continue;
      out.push({
        id: `came-${a.id}`,
        at: timeOf(ev.date),
        when: ev.date,
        text: `Came to ${ev.name}${a.mode === "virtual" ? " (virtual)" : a.mode === "in_person" ? " in person" : ""}`,
        dot: "amber",
      });
    }

    for (const n of allNotes) {
      if (n.personId !== personId) continue;
      const by =
        n.byId === me.personId
          ? "you"
          : n.byId
            ? (directory.get(n.byId)?.name ?? "an upline")
            : "an upline";
      out.push({
        id: `missed-note-${n.id}`,
        at: timeOf(n.createdAt),
        when: n.createdAt,
        text: `Missed ${eventName.get(n.eventId) ?? "an event"}: followed up by ${by}`,
        sub: n.note,
        dot: "primary",
      });
    }

    for (const c of contacts) {
      const by =
        c.byId === me.personId
          ? "you"
          : (personName.get(c.byId) ?? (personId === me.personId ? "your upline" : "their upline"));
      out.push({
        id: `contact-${c.id}`,
        at: timeOf(c.date),
        when: c.date,
        text: `Checked in by ${by}${c.source === "message" ? " via chat" : ""}`,
        sub: c.note,
        dot: "primary",
        // You can remove check-ins you logged; leaders can remove any.
        remove:
          c.byId === me.personId || me.role === "leader"
            ? { kind: "contact", id: c.id, label: "check-in" }
            : undefined,
      });
    }

    for (const l of learning) {
      const text =
        l.kind === "pages"
          ? learningUnit(l) === "minutes"
            ? `Read ${l.title} for ${unitAmount(l.amount, "minutes")}`
            : `Read ${unitAmount(l.amount, learningUnit(l)!)} of ${l.title}`
          : l.kind === "podcast"
            ? learningUnit(l) === "minutes"
              ? `Listened to ${l.title} for ${unitAmount(l.amount, "minutes")}`
              : l.amount === 1
                ? `Listened to a podcast: ${l.title}`
                : `Listened to ${unitAmount(l.amount, "episodes")}: ${l.title}`
            : l.kind === "workshop"
              ? `Went to a workshop: ${l.title}`
              : `Went to a conference: ${l.title}`;
      out.push({ id: `learn-${l.id}`, at: timeOf(l.date), when: l.date, text, dot: "sky" });
    }

    for (const s of sales) {
      out.push({
        id: `sale-${s.id}`,
        at: timeOf(s.date),
        when: s.date,
        text: `Bought ${s.product}${s.amount !== undefined ? ` · ${fmtMoney(s.amount)}` : ""}${s.pv ? ` · ${s.pv} PV` : ""}`,
        dot: "amber",
        remove: me.role !== "candidate" ? { kind: "sale", id: s.id, label: "sale" } : undefined,
      });
    }

    return out.sort((a, b) => b.at - a.at);
  }, [
    activity,
    contacts,
    learning,
    sales,
    events,
    people,
    me.personId,
    me.role,
    personId,
    attendances,
    allNotes,
    directory,
  ]);
}

function fromActivity(e: ActivityEvent, eventName: Map<string, string>): FeedItem {
  const ev = e.relatedEventId ? (eventName.get(e.relatedEventId) ?? "an event") : "an event";
  let text = e.summary;
  let dot: Dot = "neutral";
  switch (e.kind) {
    case "stage_changed": {
      const to = typeof e.meta?.to === "string" ? e.meta.to : undefined;
      text = to ? `Became ${to === "ibo" ? "an" : "a"} ${STAGE_NAME[to] ?? to}` : "Stage changed";
      dot = "navy";
      break;
    }
    case "assigned_event":
      text = `Added to ${ev}`;
      dot = "amber";
      break;
    case "ticket_purchased":
      text = `Bought a ticket for ${ev}`;
      dot = "amber";
      break;
    case "marked_attended":
      text = `Attended ${ev}`;
      dot = "amber";
      break;
    case "marked_no_show":
      text = `Didn't show at ${ev}`;
      dot = "amber";
      break;
    case "created":
      text = "Added to the team list";
      break;
    case "updated":
      text = e.summary.replace(/^Edited /, "Updated ");
      break;
    case "note":
      text = e.summary;
      dot = "primary";
      break;
  }
  return {
    id: e.id,
    at: timeOf(e.timestamp),
    when: e.timestamp,
    text,
    sub: e.actorName && e.actorName !== "You" ? `by ${e.actorName}` : undefined,
    dot,
  };
}
