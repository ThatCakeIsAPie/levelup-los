import { useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  LayoutGrid,
  List,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Search,
  UserPlus,
  UserX,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  PersonAvatar,
  SectionCard,
  StageChip,
  STAGE_LABEL,
  ToneChip,
  useIsDesktop,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  bulkUpdateAttendances,
  effectiveBizClass,
  type BizClass,
  needsTicket,
  updateAttendance,
  type Attendance,
  type CrmEvent,
  type CrmPerson,
  type DesireLevel,
} from "@/data";
import { downloadCsv, toCsv } from "@/lib/csvExport";
import { StageFilterChips } from "@/components/filters/StageFilterChips";
import { AddAttendeeDialog } from "./AddAttendeeDialog";
import { AttendeeKanban } from "./AttendeeKanban";
import { usePeopleMap } from "./hooks";
import { DESIRE_LABEL, DESIRE_TONE, shortDate, ticketStatus } from "./lib";
import { RiskBadge } from "./RiskFlags";
import { Segmented } from "./Segmented";
import { countByStage, filterByStage, stageChips } from "./stageFilter";

type View = "table" | "board";

/** Roster filters reachable by link (`/events/$id?tab=attendees&filter=no-ticket`). */
export type AttendeeFilter = "no-ticket";

export function AttendeesTab({
  event,
  rows,
  finished,
  onEdit,
  filter,
  onClearFilter,
  stages = [],
  onStages,
}: {
  event: CrmEvent;
  rows: Attendance[];
  finished: boolean;
  onEdit: (attendanceId: string) => void;
  /** "no-ticket": only people who still need a ticket (no ticket, haven't said no). */
  filter?: AttendeeFilter;
  onClearFilter?: () => void;
  /** Stages shown together (`?stage=apprentice,ibo`); empty = everyone. */
  stages?: BizClass[];
  onStages?: (next: BizClass[]) => void;
}) {
  const desktop = useIsDesktop();
  const people = usePeopleMap();
  const [view, setView] = useState<View>("table");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Everything but the stage filter (the stage chips count from these).
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((a) => filter !== "no-ticket" || needsTicket(a))
      .filter((a) => !q || (people.get(a.personId)?.name ?? "").toLowerCase().includes(q));
  }, [rows, people, query, filter]);
  const stageCounts = useMemo(() => countByStage(matching, people), [matching, people]);
  const sorted = useMemo(
    () =>
      [...filterByStage(matching, people, stages)].sort((a, b) =>
        (people.get(a.personId)?.name ?? "").localeCompare(people.get(b.personId)?.name ?? ""),
      ),
    [matching, people, stages],
  );

  // Drop selections that are no longer on the roster.
  const selectedIds = rows.filter((a) => selected.has(a.id)).map((a) => a.id);
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  const allShownSelected = sorted.length > 0 && sorted.every((a) => selected.has(a.id));

  const markSelected = (attended: boolean) => {
    const chosen = rows.filter((a) => selected.has(a.id));
    const eligible = chosen.filter((a) => a.hasTicket);
    const skipped = chosen.length - eligible.length;
    if (eligible.length === 0) {
      toast.info("Only people with a ticket can be marked attended or no-show");
      return;
    }
    const before = eligible.map((a) => [a.id, a.attended] as const);
    bulkUpdateAttendances(
      eligible.map((a) => a.id),
      { attended },
    );
    setSelected(new Set());
    toast.success(
      `Marked ${eligible.length} as ${attended ? "attended" : "no-show"}${
        skipped ? ` · ${skipped} without a ticket skipped` : ""
      }`,
      {
        action: {
          label: "Undo",
          onClick: () => before.forEach(([id, v]) => updateAttendance(id, { attended: v })),
        },
      },
    );
  };

  const markRemainingNoShow = () => {
    const targets = rows.filter((a) => a.hasTicket && a.attended === undefined);
    if (targets.length === 0) {
      toast.info("Everyone with a ticket already has attendance recorded");
      return;
    }
    bulkUpdateAttendances(
      targets.map((a) => a.id),
      { attended: false },
    );
    toast.success(`Marked ${targets.length} as no-show`, {
      action: {
        label: "Undo",
        onClick: () =>
          bulkUpdateAttendances(
            targets.map((a) => a.id),
            { attended: undefined },
          ),
      },
    });
  };

  const exportCsv = () => {
    const out = rows.map((a) => {
      const p = people.get(a.personId);
      return {
        Name: p?.name ?? "",
        Stage: p ? STAGE_LABEL[effectiveBizClass(p)] : "",
        "Wants to go": a.desireToAttend ? DESIRE_LABEL[a.desireToAttend] : "",
        "Follow-up": a.followUpDate ?? "",
        Ticket: a.hasTicket ? "Yes" : "",
        "Ticket type": a.hasTicket ? (a.mode === "virtual" ? "Virtual" : "In person") : "",
        "Plans to buy by": a.hasTicket ? "" : (a.plannedPurchaseDate ?? ""),
        Helper: a.helperId ? (people.get(a.helperId)?.name ?? "") : "",
        Leadership: a.leadershipQualified ? "Yes" : "",
        "Additional event": a.specialEventQualified ? "Yes" : "",
        Attended: a.attended === true ? "Yes" : a.attended === false ? "No" : "",
        Notes: a.notes ?? "",
      };
    });
    const slug = event.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    downloadCsv(`${slug || "event"}-attendees.csv`, toCsv(out));
    toast.success(`Exported ${out.length} attendees`);
  };

  const existing = rows.map((a) => a.personId);

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
            placeholder="Find an attendee"
            aria-label="Find an attendee"
            className="pl-9"
          />
        </div>
        <Segmented<View>
          label="View"
          className="w-auto max-lg:order-2"
          value={view}
          onChange={(v) => v && setView(v)}
          options={[
            { value: "table", label: desktop ? "Table" : "List", icon: List },
            { value: "board", label: "Board", icon: LayoutGrid },
          ]}
        />
        <AddAttendeeDialog eventId={event.id} existingPersonIds={existing}>
          {(open) => (
            <Button onClick={open} className="max-lg:order-2">
              <UserPlus /> Add attendee
            </Button>
          )}
        </AddAttendeeDialog>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="More attendee actions"
              className="max-lg:order-1"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={exportCsv} disabled={rows.length === 0}>
              <Download /> Export CSV
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={markRemainingNoShow} disabled={rows.length === 0}>
              <UserX /> Mark unrecorded ticket holders as no-show
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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

      {filter === "no-ticket" && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>
            Showing the{" "}
            <b className="text-foreground tabular-nums">{rows.filter(needsTicket).length}</b>{" "}
            {rows.filter(needsTicket).length === 1 ? "person" : "people"} who still need a ticket
          </span>
          {onClearFilter && (
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onClearFilter}>
              <X /> Show everyone
            </Button>
          )}
        </div>
      )}

      {selectedIds.length > 0 && view === "table" && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-primary-soft px-3 py-2 text-[13px] text-primary-ink"
          role="region"
          aria-label="Bulk actions"
        >
          <b className="tabular-nums">{selectedIds.length} selected</b>
          <span className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => markSelected(true)}>
            Mark attended
          </Button>
          <Button size="sm" variant="outline" onClick={() => markSelected(false)}>
            <UserX /> Mark no-show
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nobody on this event yet"
          body="Add people from your team to track who wants to go, tickets and follow-ups."
          action={
            <AddAttendeeDialog eventId={event.id} existingPersonIds={existing}>
              {(open) => (
                <Button onClick={open}>
                  <UserPlus /> Add attendee
                </Button>
              )}
            </AddAttendeeDialog>
          }
        />
      ) : view === "board" ? (
        <AttendeeKanban rows={sorted} onEdit={onEdit} finished={finished} />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title="No matches"
          body={
            query
              ? `Nobody${filter ? " who still needs a ticket" : " on the roster"} matches “${query}”.`
              : stages.length && matching.length
                ? "Nobody in the groups you picked. Tap All to see everyone."
                : "Everyone on the roster has a ticket or has said they're not going."
          }
        />
      ) : desktop ? (
        <SectionCard className="px-0 py-1 sm:px-0">
          <div className="overflow-x-auto">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="border-line hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      aria-label="Select everyone shown"
                      checked={allShownSelected}
                      onCheckedChange={(v) =>
                        setSelected(v ? new Set(sorted.map((a) => a.id)) : new Set())
                      }
                    />
                  </TableHead>
                  <TableHead>Person</TableHead>
                  <TableHead>Wants to go</TableHead>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Follow-up</TableHead>
                  <TableHead>Helper</TableHead>
                  <TableHead className="text-center">Attended</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Edit</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((a) => (
                  <AttendeeRow
                    key={a.id}
                    a={a}
                    person={people.get(a.personId)}
                    helper={a.helperId ? people.get(a.helperId) : undefined}
                    selected={selected.has(a.id)}
                    onSelect={(v) => toggle(a.id, v)}
                    onEdit={() => onEdit(a.id)}
                    finished={finished}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ) : (
        <ul className="grid gap-2">
          {sorted.map((a) => (
            <AttendeeCard
              key={a.id}
              a={a}
              person={people.get(a.personId)}
              helper={a.helperId ? people.get(a.helperId) : undefined}
              selected={selected.has(a.id)}
              onSelect={(v) => toggle(a.id, v)}
              onEdit={() => onEdit(a.id)}
              finished={finished}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const TICKET_VALUE = (a: Attendance) =>
  a.hasTicket ? (a.mode === "virtual" ? "virtual" : "in_person") : "none";

function AttendeeRow({
  a,
  person,
  helper,
  selected,
  onSelect,
  onEdit,
  finished,
}: {
  a: Attendance;
  person?: CrmPerson;
  helper?: CrmPerson;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onEdit: () => void;
  finished: boolean;
}) {
  const name = person?.name ?? "Unknown person";
  const stage = person ? effectiveBizClass(person) : undefined;
  const overdue = ticketStatus(a).tone === "bad";
  return (
    <TableRow data-state={selected ? "selected" : undefined} className="border-line">
      <TableCell className="pl-4">
        <Checkbox
          aria-label={`Select ${name}`}
          checked={selected}
          onCheckedChange={(v) => onSelect(!!v)}
        />
      </TableCell>
      <TableCell className="max-w-[240px]">
        <div className="flex items-center gap-2.5">
          <PersonAvatar name={name} stage={stage} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onEdit}
                className="truncate rounded-sm text-left font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {name}
              </button>
              <RiskBadge attendance={a} finished={finished} />
            </div>
            {stage && <StageChip stage={stage} className="mt-0.5" />}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Select
          value={a.desireToAttend ?? "unset"}
          onValueChange={(v) =>
            updateAttendance(a.id, {
              desireToAttend: v === "unset" ? undefined : (v as DesireLevel),
            })
          }
        >
          <SelectTrigger className="h-8 w-[128px] text-[12.5px]" aria-label={`${name} wants to go`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unset">Not asked</SelectItem>
            <SelectItem value="yes">Wants to go</SelectItem>
            <SelectItem value="maybe">Maybe</SelectItem>
            <SelectItem value="no">Not going</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={TICKET_VALUE(a)}
          onValueChange={(v) =>
            updateAttendance(
              a.id,
              v === "none"
                ? { hasTicket: false, attended: undefined }
                : { hasTicket: true, mode: v as "in_person" | "virtual" },
            )
          }
        >
          <SelectTrigger className="h-8 w-[118px] text-[12.5px]" aria-label={`${name} ticket`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No ticket</SelectItem>
            <SelectItem value="in_person">In person</SelectItem>
            <SelectItem value="virtual">Virtual</SelectItem>
          </SelectContent>
        </Select>
        {!a.hasTicket && a.plannedPurchaseDate && (
          <div
            className={
              overdue
                ? "mt-0.5 text-[11.5px] font-semibold text-bad"
                : "mt-0.5 text-[11.5px] text-muted-foreground"
            }
          >
            Plans {shortDate(a.plannedPurchaseDate)}
          </div>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {a.followUpDate ? shortDate(a.followUpDate) : <span className="text-faint">None</span>}
      </TableCell>
      <TableCell className="max-w-[140px] truncate text-muted-foreground">
        {helper?.name ?? <span className="text-faint">None</span>}
      </TableCell>
      <TableCell className="text-center">
        {a.hasTicket ? (
          <Checkbox
            aria-label={`${name} attended`}
            checked={a.attended === true}
            onCheckedChange={(v) =>
              updateAttendance(a.id, { attended: v ? true : finished ? false : undefined })
            }
          />
        ) : (
          <span className="text-faint" aria-label="No ticket">
            –
          </span>
        )}
        {a.hasTicket && a.attended === false && (
          <div className="mt-0.5 text-[10.5px] font-semibold text-bad">No-show</div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap items-center gap-1">
          {a.leadershipQualified && <ToneChip tone="good">Leadership</ToneChip>}
          {a.specialEventQualified && <ToneChip tone="info">Additional event</ToneChip>}
          {a.notes && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex text-muted-foreground">
                  <NotebookPen className="size-3.5" aria-hidden="true" />
                  <span className="sr-only">Note: {a.notes}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent aria-hidden="true" className="max-w-64 whitespace-pre-wrap">
                {a.notes}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className="pr-4">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
        >
          <Pencil />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function AttendeeCard({
  a,
  person,
  helper,
  selected,
  onSelect,
  onEdit,
  finished,
}: {
  a: Attendance;
  person?: CrmPerson;
  helper?: CrmPerson;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onEdit: () => void;
  finished: boolean;
}) {
  const name = person?.name ?? "Unknown person";
  const stage = person ? effectiveBizClass(person) : undefined;
  const ts = ticketStatus(a);
  const meta = [
    a.followUpDate ? `Follow up ${shortDate(a.followUpDate)}` : null,
    helper ? `Helper ${helper.name}` : null,
  ].filter(Boolean);
  return (
    <li className="relative flex items-start gap-3 rounded-card border border-line bg-card px-3 py-3">
      <Checkbox
        aria-label={`Select ${name}`}
        checked={selected}
        onCheckedChange={(v) => onSelect(!!v)}
        className="relative z-10 mt-2"
      />
      <PersonAvatar name={name} stage={stage} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onEdit}
            className="truncate rounded-sm text-left text-[13.5px] font-semibold after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
          >
            {name}
          </button>
          <RiskBadge attendance={a} finished={finished} />
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {stage && <StageChip stage={stage} />}
          {a.desireToAttend && (
            <ToneChip tone={DESIRE_TONE[a.desireToAttend]}>
              {DESIRE_LABEL[a.desireToAttend]}
            </ToneChip>
          )}
          <ToneChip tone={ts.tone}>{ts.label}</ToneChip>
          {a.attended === true && <ToneChip tone="good">Attended</ToneChip>}
          {a.hasTicket && a.attended === false && <ToneChip tone="bad">No-show</ToneChip>}
        </div>
        {meta.length > 0 && (
          <p className="mt-1 truncate text-xs text-muted-foreground">{meta.join(" · ")}</p>
        )}
      </div>
      <ChevronRight className="mt-2 size-4 shrink-0 text-faint" aria-hidden="true" />
    </li>
  );
}
