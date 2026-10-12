import { useMemo } from "react";
import {
  parseDate,
  useActivity,
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
 * events, edits, notes), check-ins, learning and (for customers) purchases.
 */
export function usePersonFeed(personId: string): FeedItem[] {
  const activity = useActivity(personId);
  const contacts = useContacts(personId);
  const learning = useLearning(personId);
  const sales = useSales(personId);
  const events = useEvents();
  const people = useVisiblePeople();
  const me = useCurrentUser();

  return useMemo(() => {
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    const personName = new Map(people.map((p) => [p.id, p.name]));
    const out: FeedItem[] = [];

    for (const e of activity) out.push(fromActivity(e, eventName));

    for (const c of contacts) {
      const by =
        c.byId === me.personId
          ? "you"
          : (personName.get(c.byId) ?? (personId === me.personId ? "your upline" : "their upline"));
      out.push({
        id: `contact-${c.id}`,
        at: timeOf(c.date),
        when: c.date,
        text: `Checked in by ${by}`,
        sub: c.note,
        dot: "primary",
      });
    }

    for (const l of learning) {
      const text =
        l.kind === "pages"
          ? `Read ${l.amount} ${l.amount === 1 ? "page" : "pages"} of ${l.title}`
          : l.kind === "podcast"
            ? `Listened to a podcast: ${l.title}`
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
        text: `Bought ${s.product}${s.amount !== undefined ? ` · ${fmtMoney(s.amount)}` : ""}`,
        dot: "amber",
      });
    }

    return out.sort((a, b) => b.at - a.at);
  }, [activity, contacts, learning, sales, events, people, me.personId, personId]);
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
