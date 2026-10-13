/**
 * Missed-event follow-ups on the event page (who came last time and not to
 * this one) and on a person's profile (which events they've stopped coming
 * to), with how each was handled: a check-in, or an upline's note.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, NotebookPen, Trash2, UserX } from "lucide-react";
import { PersonAvatar, SectionCard, ToneChip } from "@/components/brand";
import { quickCheckIn } from "@/components/log/quickLog";
import { Button } from "@/components/ui/button";
import {
  EVENT_TYPE_LABEL,
  effectiveBizClass,
  removeMissedNote,
  useCanCoach,
  useChatPeople,
  useCurrentUser,
  useMissedAtEvent,
  useMissedForPerson,
  type CrmEvent,
  type CrmPerson,
  type MissedStreak,
} from "@/data";
import { usePeopleMap } from "./hooks";
import { shortDate } from "./lib";
import { MissedNoteDialog } from "./MissedNoteDialog";
import { EVENT_TYPE_ICON } from "./typeIcons";

/** How a streak stands: the note (with its author), the check-in, or open. */
function MissedStatus({ s }: { s: MissedStreak }) {
  const me = useCurrentUser();
  // Authors are uplines, often outside the viewer's CRM view: use the team directory.
  const names = useChatPeople();
  const who = (id: string | null | undefined) =>
    !id ? "an upline" : id === me.personId ? "you" : (names.get(id)?.name ?? "an upline");
  if (s.handled?.kind === "note") {
    const n = s.handled.note;
    return (
      <div className="mt-1.5 grid gap-1 rounded-lg bg-surface-2 px-2.5 py-2 text-[12.5px]">
        <p className="break-words">“{n.note}”</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>
            Handled by {who(n.byId)} · {shortDate(n.createdAt.slice(0, 10))}
          </span>
          {n.byId === me.personId && (
            <button
              type="button"
              onClick={() => removeMissedNote(n.id)}
              className="inline-flex items-center gap-1 rounded-sm font-semibold text-muted-foreground hover:text-bad focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Trash2 className="size-3" aria-hidden="true" /> Remove note
            </button>
          )}
        </p>
      </div>
    );
  }
  if (s.handled?.kind === "contact")
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        <ToneChip tone="good" className="mr-1.5">
          Followed up
        </ToneChip>
        Checked in by {who(s.handled.byId)} on {shortDate(s.handled.date)}
      </p>
    );
  return (
    <div className="mt-1">
      <ToneChip tone="warn">Needs a follow-up</ToneChip>
    </div>
  );
}

/** Check in / note buttons for an open streak (uplines only). */
function MissedActions({ s, person }: { s: MissedStreak; person: CrmPerson }) {
  const coach = useCanCoach(person.id);
  const [noteOpen, setNoteOpen] = useState(false);
  if (!coach || s.handled) return null;
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="soft"
        onClick={() => quickCheckIn(person.id, `Check-in with ${person.name} logged`)}
      >
        <Check /> Check in
      </Button>
      <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
        <NotebookPen /> Already handled
      </Button>
      <MissedNoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        personId={person.id}
        personName={person.name}
        eventId={s.latest.id}
        eventName={s.latest.name}
      />
    </div>
  );
}

/**
 * Finished event: the people who came to the previous one of this type and
 * missed this one (recent misses only), with their follow-up status.
 */
export function EventMissedPanel({ event }: { event: CrmEvent }) {
  const streaks = useMissedAtEvent(event.id);
  const people = usePeopleMap();
  const rows = streaks
    .map((s) => ({ s, p: people.get(s.personId) }))
    .filter((r): r is { s: MissedStreak; p: CrmPerson } => !!r.p)
    .sort(
      (a, b) => Number(!!a.s.handled) - Number(!!b.s.handled) || a.p.name.localeCompare(b.p.name),
    );
  if (!rows.length) return null;
  const open = rows.filter((r) => !r.s.handled).length;
  return (
    <SectionCard
      title="Came last time, missed this one"
      action={open > 0 ? <ToneChip tone="warn">{open} to follow up</ToneChip> : undefined}
    >
      <ul>
        {rows.map(({ s, p }) => (
          <li
            key={s.key}
            className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0"
          >
            <PersonAvatar name={p.name} stage={effectiveBizClass(p)} />
            <div className="min-w-0">
              <Link
                to="/people/$id"
                params={{ id: p.id }}
                className="rounded-sm text-[13.5px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {p.name}
              </Link>
              <p className="text-xs text-muted-foreground">
                Came {shortDate(s.lastAttended.date)}
                {s.missed.length > 1 ? ` · missed the last ${s.missed.length}` : ""}
              </p>
              <MissedStatus s={s} />
            </div>
            <div className="col-start-2">
              <MissedActions s={s} person={p} />
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/** Profile: events this person has recently stopped coming to, and how each was followed up. */
export function PersonMissedCard({ person }: { person: CrmPerson }) {
  const streaks = useMissedForPerson(person.id);
  const people = usePeopleMap();
  if (!streaks.length) return null;
  return (
    <SectionCard title="Missed events">
      <ul>
        {streaks.map((s) => {
          const Icon = EVENT_TYPE_ICON[s.type];
          return (
            <li
              key={s.key}
              className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-3 gap-y-2 border-t border-line py-3 first:border-t-0 first:pt-0"
            >
              <span className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground">
                {s.handled ? (
                  <Icon className="size-4" aria-hidden="true" />
                ) : (
                  <UserX className="size-4 text-warn-ink" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0">
                <Link
                  to="/events/$id"
                  params={{ id: s.latest.id }}
                  className="rounded-sm text-[13.5px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Missed {s.latest.name} · {shortDate(s.latest.date)}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {EVENT_TYPE_LABEL[s.type]} · came {shortDate(s.lastAttended.date)}
                  {s.missed.length > 1 ? ` · missed the last ${s.missed.length}` : ""}
                </p>
                <MissedStatus s={s} />
              </div>
              <div className="col-start-2">
                <MissedActions s={s} person={person} />
              </div>
            </li>
          );
        })}
      </ul>
    </SectionCard>
  );
}
