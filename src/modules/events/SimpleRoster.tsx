/**
 * The light roster for events without tickets (Night Owls, work sessions,
 * info sessions, trainings): before the event, who's coming; from the day of
 * the event, who came and how (in person or virtual). One tap per person.
 */
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCheck, Search, UserPlus, Users, X } from "lucide-react";
import { EmptyState, PersonAvatar, SectionCard, StageChip } from "@/components/brand";
import { toastWithUndo } from "@/components/log/quickLog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MODE_LABEL,
  assignToEvent,
  effectiveBizClass,
  eventModes,
  useEventCategory,
  removeAttendance,
  setEventAttendance,
  updateAttendance,
  type AttendMode,
  type Attendance,
  type BizClass,
  type CrmEvent,
  type DesireLevel,
} from "@/data";
import { StageFilterChips } from "@/components/filters/StageFilterChips";
import { AddAttendeeDialog } from "./AddAttendeeDialog";
import { usePeopleMap } from "./hooks";
import { Segmented } from "./Segmented";
import { cameOptions, cameValue, type Came } from "./attendance";
import { countByStage, filterByStage, stageChips } from "./stageFilter";

export function SimpleRoster({
  event,
  rows,
  started,
  stages = [],
  onStages,
}: {
  event: CrmEvent;
  rows: Attendance[];
  /** The event day has come: record who came instead of who's coming. */
  started: boolean;
  /** Stages shown together (`?stage=apprentice,ibo`); empty = everyone. */
  stages?: BizClass[];
  onStages?: (next: BizClass[]) => void;
}) {
  const people = usePeopleMap();
  const [query, setQuery] = useState("");
  const modes = eventModes(event, useEventCategory(event));
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((a) => people.has(a.personId))
      .filter((a) => !q || people.get(a.personId)!.name.toLowerCase().includes(q));
  }, [rows, people, query]);
  const stageCounts = useMemo(() => countByStage(matching, people), [matching, people]);
  const sorted = useMemo(
    () =>
      [...filterByStage(matching, people, stages)].sort((a, b) =>
        people.get(a.personId)!.name.localeCompare(people.get(b.personId)!.name),
      ),
    [matching, people, stages],
  );
  const existing = rows.map((a) => a.personId);

  const came = rows.filter((a) => a.attended === true).length;
  const going = rows.filter((a) => a.desireToAttend === "yes").length;
  // "Everyone who said yes came" for the ones not recorded yet.
  const unrecordedYes = rows.filter((a) => a.desireToAttend === "yes" && a.attended === undefined);

  const markAllCame = () => {
    const before = unrecordedYes.map((a) => [a.id, a.mode] as const);
    for (const a of unrecordedYes)
      updateAttendance(a.id, {
        attended: true,
        mode: a.mode && modes.includes(a.mode) ? a.mode : modes[0],
      });
    toastWithUndo(`Marked ${unrecordedYes.length} as there`, () =>
      before.forEach(([id, mode]) => updateAttendance(id, { attended: undefined, mode })),
    );
  };

  const remove = (a: Attendance) => {
    const name = people.get(a.personId)?.name ?? "them";
    const snapshot = { ...a };
    removeAttendance(a.id);
    toastWithUndo(`Removed ${name} from the list`, () => {
      const back = assignToEvent(snapshot.eventId, snapshot.personId);
      const { id: _id, eventId: _e, personId: _p, updatedAt: _u, ...rest } = snapshot;
      updateAttendance(back.id, rest);
    });
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-[1_1_14rem]">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find someone"
            aria-label="Find someone on the list"
            className="pl-9"
          />
        </div>
        {started && unrecordedYes.length > 0 && (
          <Button variant="outline" onClick={markAllCame}>
            <CheckCheck /> Everyone coming was there
          </Button>
        )}
        <AddAttendeeDialog eventId={event.id} existingPersonIds={existing}>
          {(open) => (
            <Button onClick={open}>
              <UserPlus /> Add people
            </Button>
          )}
        </AddAttendeeDialog>
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {started
          ? `${came} of ${rows.length} on the list came. Tap how each person came.`
          : `${going} coming. Tap to change anyone's answer.`}
      </p>

      {onStages && rows.length > 0 && (
        <StageFilterChips
          label="Show"
          stages={stageChips(stageCounts, stages)}
          value={stages}
          onChange={onStages}
          counts={stageCounts}
          total={matching.length}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody on the list yet"
          body={
            started
              ? "Add the people who came, then tap how each one joined."
              : "Add people from your team to see who's coming."
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No matches"
          body={
            query
              ? `Nobody on the list matches “${query}”.`
              : "Nobody in the groups you picked. Tap All to see everyone."
          }
        />
      ) : (
        <SectionCard className="py-1 sm:py-1">
          <ul>
            {sorted.map((a) => {
              const p = people.get(a.personId)!;
              const stage = effectiveBizClass(p);
              return (
                <li
                  key={a.id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-line py-2.5 first:border-t-0"
                >
                  <PersonAvatar name={p.name} stage={stage} />
                  <div className="min-w-0">
                    <Link
                      to="/people/$id"
                      params={{ id: p.id }}
                      className="block truncate rounded-sm text-[13.5px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {p.name}
                    </Link>
                    <StageChip stage={stage} className="mt-0.5" />
                  </div>
                  <div className="col-span-2 col-start-2 row-start-2 sm:max-w-sm">
                    {started ? (
                      <Segmented<Came>
                        label={`Was ${p.name} there?`}
                        size="sm"
                        allowEmpty
                        value={cameValue(a)}
                        onChange={(v) =>
                          setEventAttendance(
                            event.id,
                            p.id,
                            v === undefined ? null : v === "no" ? false : v,
                          )
                        }
                        options={cameOptions(modes)}
                      />
                    ) : (
                      <Segmented<DesireLevel>
                        label={`Is ${p.name} coming?`}
                        size="sm"
                        allowEmpty
                        value={a.desireToAttend}
                        onChange={(v) => updateAttendance(a.id, { desireToAttend: v })}
                        options={[
                          { value: "yes", label: "Coming" },
                          { value: "maybe", label: "Maybe" },
                          { value: "no", label: "Can't" },
                        ]}
                      />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="col-start-3 row-start-1 size-8 text-muted-foreground"
                    aria-label={`Remove ${p.name} from the list`}
                    onClick={() => remove(a)}
                  >
                    <X />
                  </Button>
                </li>
              );
            })}
          </ul>
        </SectionCard>
      )}
    </div>
  );
}
