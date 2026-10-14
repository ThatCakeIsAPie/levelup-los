import { useMemo, useState } from "react";
import { Contact, Download, Info, ListChecks, Plus, SearchX, UserPlus, Users } from "lucide-react";
import { EmptyState, PageHeader, SectionCard, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/data";
import { cn } from "@/lib/utils";
import { InviteButton } from "@/modules/invites/InviteDialog";
import { AddPersonDialog } from "./AddPersonDialog";
import { BulkBar } from "./BulkBar";
import { exportRowsCsv } from "./exportCsv";
import {
  ATTENTION_OPTIONS,
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  baseFilter,
  inSegment,
  matchesAttention,
  plural,
  sortRows,
  usePeopleRows,
  type AttentionFilter,
  type Filters,
  type PersonRow,
  type Segment,
  type StageFilter,
} from "./model";
import { PeopleCards } from "./PeopleCards";
import { PeopleTable } from "./PeopleTable";
import { DesktopToolbar, PhoneToolbar } from "./Toolbar";

const PAGE =
  "mx-auto grid w-full max-w-[1400px] content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

/** The People page for leaders, IBOs and apprentices. */
export function PeopleList() {
  const user = useCurrentUser();
  const desktop = useIsDesktop();
  const rows = usePeopleRows();

  const [segment, setSegment] = useState<Segment>("business");
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [add, setAdd] = useState<{ open: boolean; path: "business" | "customer"; key: number }>({
    open: false,
    path: "business",
    key: 0,
  });

  const setFilters = (patch: Partial<Filters>) => setFiltersState((f) => ({ ...f, ...patch }));
  const changeSegment = (s: Segment) => {
    if (s === segment) return;
    setSegment(s);
    setSelected(new Set());
    setFiltersState((f) => ({
      ...f,
      stage: "all",
      location: "all",
      sort: SORT_OPTIONS[s].some((o) => o.value === f.sort) ? f.sort : "name",
    }));
  };
  const clearFilters = () => setFiltersState({ ...DEFAULT_FILTERS, sort: filters.sort });

  const segmentRows = useMemo(() => rows.filter((r) => inSegment(r, segment)), [rows, segment]);
  const teamCount = rows.filter((r) => inSegment(r, "business") && !r.isSelf).length;
  const businessCount = rows.filter((r) => inSegment(r, "business")).length;
  const customerCount = rows.length - businessCount;

  const base = useMemo(() => baseFilter(rows, segment, filters), [rows, segment, filters]);
  const stageCounts = useMemo(() => {
    const c: Record<StageFilter, number> = { all: base.length, prospect: 0, apprentice: 0, ibo: 0 };
    for (const r of base) if (r.stage !== "customer") c[r.stage]++;
    return c;
  }, [base]);
  const attentionCounts = useMemo(() => {
    const pool = baseFilter(rows, segment, { ...filters, attention: null }).filter(
      (r) => filters.stage === "all" || segment === "customers" || r.stage === filters.stage,
    );
    const c = {} as Record<AttentionFilter, number>;
    for (const o of ATTENTION_OPTIONS)
      c[o.value] = pool.filter((r) => matchesAttention(r, o.value)).length;
    return c;
  }, [rows, segment, filters]);
  const locations = useMemo(
    () =>
      [
        ...new Set(segmentRows.map((r) => r.person.location).filter((l): l is string => !!l)),
      ].sort(),
    [segmentRows],
  );
  const visibleRows = useMemo(
    () =>
      sortRows(
        segment === "business" && filters.stage !== "all"
          ? base.filter((r) => r.stage === filters.stage)
          : base,
        filters.sort,
      ),
    [base, segment, filters.stage, filters.sort],
  );
  const selectedRows = visibleRows.filter((r) => selected.has(r.person.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectable = visibleRows.filter((r) => !r.isSelf);
  const toggleAll = () =>
    setSelected(
      selectable.length > 0 && selectable.every((r) => selected.has(r.person.id))
        ? new Set()
        : new Set(selectable.map((r) => r.person.id)),
    );
  const clearSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const openAdd = (path: "business" | "customer") =>
    setAdd((a) => ({ open: true, path, key: a.key + 1 }));
  const filtersActive =
    filters.q.trim() !== "" ||
    activeFilterCount({ ...filters, sort: DEFAULT_FILTERS.sort }, segment) > 0;

  const toolbarProps = {
    segment,
    onSegment: changeSegment,
    segmentCounts: { business: businessCount, customers: customerCount },
    filters,
    setFilters,
    stageCounts,
    attentionCounts,
    locations,
    resultCount: visibleRows.length,
  };

  let body: React.ReactNode;
  if (segment === "customers" && segmentRows.length === 0) {
    body = (
      <EmptyState
        icon={<Contact />}
        title="No customers yet"
        body="Customers you add are private to you. Track what they buy, their monthly volume and when you last checked in."
        action={
          <Button onClick={() => openAdd("customer")}>
            <Plus /> Add a customer
          </Button>
        }
      />
    );
  } else if (visibleRows.length === 0) {
    body = (
      <EmptyState
        icon={<SearchX />}
        title={segment === "customers" ? "No customers match" : "No one matches"}
        body="Try a different search, or clear the filters to see everyone again."
        action={
          <Button variant="outline" onClick={clearFilters}>
            Clear filters
          </Button>
        }
      />
    );
  } else if (desktop) {
    body = (
      <PeopleTable
        rows={visibleRows}
        segment={segment}
        viewerId={user.personId}
        selected={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
      />
    );
  } else {
    body = (
      <PeopleCards
        rows={visibleRows}
        viewerId={user.personId}
        selecting={selecting}
        selected={selected}
        onToggle={toggle}
      />
    );
  }

  const showTeamHint =
    segment === "business" && teamCount === 0 && !filtersActive && visibleRows.length > 0;
  const listLabel = `${visibleRows.length} ${
    segment === "customers"
      ? visibleRows.length === 1
        ? "customer"
        : "customers"
      : visibleRows.length === 1
        ? "person"
        : "people"
  }`;

  return (
    <div className={PAGE}>
      <PageHeader
        title="People"
        subtitle={`${teamCount ? `${teamCount} on your team` : "No team members yet"} · ${plural(customerCount, "customer")}`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() =>
                exportRowsCsv(visibleRows, segment === "customers" ? "customers" : "people")
              }
              aria-label="Export this list as CSV"
            >
              <Download />
              <span className="hidden sm:inline">Export</span>
            </Button>
            <InviteButton />
            <Button onClick={() => openAdd(segment === "customers" ? "customer" : "business")}>
              <UserPlus /> Add person
            </Button>
          </>
        }
      />

      {desktop ? (
        <SectionCard className="gap-4">
          <DesktopToolbar {...toolbarProps} />
          {visibleRows.length > 0 && (
            <p className="-mb-1 text-[12px] text-muted-foreground" aria-live="polite">
              {filtersActive ? `${listLabel} match` : `Showing ${listLabel}`}
              {selectedRows.length > 0 && ` · ${selectedRows.length} selected`}
            </p>
          )}
          {body}
        </SectionCard>
      ) : (
        <>
          <PhoneToolbar {...toolbarProps} />
          {visibleRows.length > 0 && (
            <div className="-mb-1 flex items-center justify-between gap-2">
              <p className="text-[12.5px] text-muted-foreground" aria-live="polite">
                {listLabel}
              </p>
              <Button
                size="sm"
                variant={selecting ? "soft" : "ghost"}
                onClick={() => (selecting ? clearSelection() : setSelecting(true))}
                aria-pressed={selecting}
              >
                <ListChecks />
                {selecting ? "Done" : "Select"}
              </Button>
            </div>
          )}
          {body}
        </>
      )}

      {showTeamHint && (
        <div className="flex items-start gap-2.5 rounded-card bg-info-soft px-4 py-3 text-[13px] text-info-ink">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            Your team starts here. Add a prospect you're talking with, and they'll show up under
            you.{" "}
            <button
              type="button"
              onClick={() => openAdd("business")}
              className="rounded-sm font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Add a prospect
            </button>
          </p>
        </div>
      )}

      {selectedRows.length > 0 && (
        <BulkBar rows={selectedRows} segment={segment} onClear={clearSelection} />
      )}

      <AddPersonDialog
        open={add.open}
        onOpenChange={(open) => setAdd((a) => ({ ...a, open }))}
        defaultPath={add.path}
        formKey={add.key}
      />
    </div>
  );
}

/** Candidates only see their own record. */
export function CandidatePeople() {
  const user = useCurrentUser();
  const rows = usePeopleRows();
  const self: PersonRow[] = rows.filter((r) => r.isSelf);
  return (
    <div className={cn(PAGE, "max-w-3xl")}>
      <PageHeader title="People" subtitle="Just you for now" />
      {self.length > 0 ? (
        <PeopleCards
          rows={self}
          viewerId={user.personId}
          selecting={false}
          selected={new Set()}
          onToggle={() => {}}
        />
      ) : (
        <EmptyState title="Your record isn't set up yet" body="Ask your sponsor to add you." />
      )}
      <div className="flex items-start gap-3 rounded-card border border-line bg-card px-4 py-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-info-soft text-info-ink">
          <Users className="size-4" aria-hidden="true" />
        </span>
        <div className="grid gap-1">
          <p className="text-[13.5px] font-semibold">Your team will show up here</p>
          <p className="text-[13px] text-muted-foreground">
            As a candidate you see only your own record. Once you start your business, the people
            you sponsor and the customers you serve will be listed on this page.
          </p>
        </div>
      </div>
    </div>
  );
}
