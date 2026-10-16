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
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  activeFilterCount,
  attentionCounts as countAttention,
  baseFilter,
  filterRows,
  filtersFromSearch,
  inSegment,
  plural,
  searchFromFilters,
  selectableRows,
  selectedShown,
  shownSelection,
  stageCounts as countStages,
  toggleAllShown,
  toggleSelected,
  usePeopleRows,
  type Filters,
  type PeopleSearch,
  type PersonRow,
  type Segment,
} from "./model";
import { PeopleCards } from "./PeopleCards";
import { PeopleTable } from "./PeopleTable";
import { DesktopToolbar, PhoneToolbar } from "./Toolbar";

const PAGE =
  "mx-auto grid w-full max-w-[1400px] content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

/**
 * The People page for leaders, IBOs and apprentices. Filters live in the URL
 * (`search`); the selection for bulk actions is local.
 */
export function PeopleList({
  search,
  onSearch,
}: {
  search: PeopleSearch;
  onSearch: (next: PeopleSearch) => void;
}) {
  const user = useCurrentUser();
  const desktop = useIsDesktop();
  const rows = usePeopleRows();

  const { segment, filters } = useMemo(() => filtersFromSearch(search), [search]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [add, setAdd] = useState<{ open: boolean; path: "business" | "customer"; key: number }>({
    open: false,
    path: "business",
    key: 0,
  });

  const setFilters = (patch: Partial<Filters>) =>
    onSearch(searchFromFilters(segment, { ...filters, ...patch }));
  const changeSegment = (s: Segment) => {
    if (s === segment) return;
    setSelected(new Set());
    onSearch(
      searchFromFilters(s, {
        ...filters,
        stages: [],
        locations: [],
        sort: SORT_OPTIONS[s].some((o) => o.value === filters.sort) ? filters.sort : "name",
      }),
    );
  };
  const clearFilters = () =>
    onSearch(searchFromFilters(segment, { ...DEFAULT_FILTERS, sort: filters.sort }));

  const segmentRows = useMemo(() => rows.filter((r) => inSegment(r, segment)), [rows, segment]);
  const teamCount = rows.filter((r) => inSegment(r, "business") && !r.isSelf).length;
  const businessCount = rows.filter((r) => inSegment(r, "business")).length;
  const customerCount = rows.length - businessCount;

  const base = useMemo(() => baseFilter(rows, segment, filters), [rows, segment, filters]);
  const stageCounts = useMemo(() => countStages(base), [base]);
  const attentionCounts = useMemo(
    () => countAttention(rows, segment, filters),
    [rows, segment, filters],
  );
  const locations = useMemo(
    () =>
      [
        ...new Set(segmentRows.map((r) => r.person.location).filter((l): l is string => !!l)),
      ].sort(),
    [segmentRows],
  );
  const visibleRows = useMemo(() => filterRows(rows, segment, filters), [rows, segment, filters]);
  const selectedRows = selectedShown(selected, visibleRows);
  const allState = shownSelection(selected, visibleRows);

  const toggle = (id: string) => setSelected((s) => toggleSelected(s, id));
  const toggleAll = () => setSelected((s) => toggleAllShown(s, visibleRows));
  // Phones: a long press on a card starts selecting with that person.
  const startSelecting = (id: string) => {
    setSelecting(true);
    setSelected((s) => (s.has(id) ? s : toggleSelected(s, id)));
  };
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
        onLongPress={startSelecting}
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
              <p
                className="min-w-0 truncate text-[12.5px] text-muted-foreground"
                aria-live="polite"
              >
                {selecting ? `${selectedRows.length} of ${listLabel} selected` : listLabel}
              </p>
              <div className="flex shrink-0 items-center gap-1">
                {selecting && selectableRows(visibleRows).length > 0 && (
                  <Button size="sm" variant="ghost" onClick={toggleAll}>
                    {allState === "all" ? "Clear all" : "Select all"}
                  </Button>
                )}
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
        <BulkBar
          rows={selectedRows}
          segment={segment}
          people={rows.map((r) => r.person)}
          viewerId={user.personId}
          shownCount={selectableRows(visibleRows).length}
          onSelectAll={allState === "all" ? undefined : toggleAll}
          onClear={clearSelection}
        />
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
