/**
 * All talks: the full catalog, filtered by speaker, format, topic, type and
 * event, with topic chips (counts), sorting and search. Filters live in the
 * URL (/library/talks?topic=t-recruiting&sort=oldest).
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import {
  ArrowDownUp,
  Calendar,
  FileAudio,
  Search,
  SlidersHorizontal,
  Tag,
  User,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { EmptyState, PageHeader, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  CATALOG_FORMATS,
  CATALOG_KINDS,
  FORMAT_LABEL,
  KIND_LABEL,
  SORT_LABEL,
  filterCatalog,
  itemDate,
  lengthLabel,
  parseDate,
  speakerKey,
  speakerLine,
  topicCounts,
  useCatalog,
  useEvents,
  useLibraryAccess,
  useLibraryPeople,
  useLibraryTopics,
  useMyLibraryProgress,
  type CatalogFilters,
  type CatalogSort,
} from "@/data";
import { KindIcon } from "./icons";
import { itemHref } from "./links";
import { LibraryActions } from "./LibraryPage";
import { ItemStatus, LibraryTabs, TopicPill, statusText } from "./parts";
import { TopicsDialog } from "./TopicsDialog";
import { FormSheet } from "./FormSheet";

const ANY = "__any";

export function TalksPage({ filters }: { filters: CatalogFilters }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate({ from: "/library/talks" });
  const catalog = useCatalog();
  const topics = useLibraryTopics();
  const events = useEvents();
  const people = useLibraryPeople();
  const progress = useMyLibraryProgress();
  const { canManageTopics } = useLibraryAccess();
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [q, setQ] = useState(filters.q ?? "");
  useEffect(() => setQ(filters.q ?? ""), [filters.q]);

  const set = (patch: Partial<CatalogFilters>) =>
    void navigate({
      to: "/library/talks",
      search: (prev: CatalogFilters) => clean({ ...prev, ...patch }),
      replace: true,
    });

  const topicName = useMemo(() => new Map(topics.map((t) => [t.id, t.name])), [topics]);
  const eventName = useMemo(() => new Map(events.map((e) => [e.id, e.name])), [events]);
  const names = useMemo(
    () => ({
      person: (id: string) => people.get(id)?.name,
      topic: (id: string) => topicName.get(id),
      event: (id: string) => eventName.get(id),
    }),
    [people, topicName, eventName],
  );
  const results = useMemo(() => filterCatalog(catalog, filters, names), [catalog, filters, names]);
  // Topic counts follow every filter except the topic itself.
  const counts = useMemo(
    () => topicCounts(filterCatalog(catalog, { ...filters, topic: undefined }, names)),
    [catalog, filters, names],
  );

  const allCounts = useMemo(() => topicCounts(catalog), [catalog]);

  // Filter options from what's in the catalog.
  const speakers = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of catalog)
      for (const s of i.speakers)
        m.set(
          speakerKey(s),
          s.personId ? (people.get(s.personId)?.name ?? "Team member") : `${s.name} (guest)`,
        );
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [catalog, people]);
  const eventOptions = useMemo(() => {
    const ids = new Set(catalog.map((i) => i.eventId).filter(Boolean) as string[]);
    return events.filter((e) => ids.has(e.id)).reverse();
  }, [catalog, events]);

  const activeCount = [
    filters.speaker,
    filters.format,
    filters.topic,
    filters.kind,
    filters.event,
  ].filter(Boolean).length;
  const n = catalog.length;

  const filterSelects = (
    <>
      <FilterSelect
        icon={User}
        label="Speaker"
        value={filters.speaker}
        onChange={(v) => set({ speaker: v })}
        options={speakers.map(([k, name]) => [k, name])}
      />
      <FilterSelect
        icon={Users}
        label="Format"
        value={filters.format}
        onChange={(v) => set({ format: v as CatalogFilters["format"] })}
        options={CATALOG_FORMATS.map((f) => [f, FORMAT_LABEL[f]])}
      />
      <FilterSelect
        icon={Tag}
        label="Topic"
        value={filters.topic}
        onChange={(v) => set({ topic: v })}
        options={topics.map((t) => [t.id, t.name])}
      />
      <FilterSelect
        icon={FileAudio}
        label="Type"
        value={filters.kind}
        onChange={(v) => set({ kind: v as CatalogFilters["kind"] })}
        options={CATALOG_KINDS.map((k) => [k, KIND_LABEL[k]])}
      />
      <FilterSelect
        icon={Calendar}
        label="Event"
        value={filters.event}
        onChange={(v) => set({ event: v })}
        options={eventOptions.map((e) => [e.id, e.name])}
      />
    </>
  );

  return (
    <div className="mx-auto grid w-full max-w-6xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Library"
        subtitle={`${n} ${n === 1 ? "talk" : "talks, panels and workshops"}`}
        actions={
          <>
            {canManageTopics && (
              <Button variant="outline" onClick={() => setTopicsOpen(true)}>
                <Tag /> Topics
              </Button>
            )}
            <LibraryActions talk />
          </>
        }
      />
      <LibraryTabs current="talks" />

      {/* Search + filters */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          role="search"
          className="relative min-w-0 flex-[1_1_240px] lg:max-w-[300px]"
          onSubmit={(e) => e.preventDefault()}
        >
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              set({ q: e.target.value || undefined });
            }}
            placeholder={desktop ? "Search titles, speakers, topics" : "Search talks"}
            aria-label="Search talks"
            className="pl-9"
          />
        </form>
        {desktop ? (
          <>
            {filterSelects}
            <span className="flex-1" />
            <SortSelect value={filters.sort} onChange={(v) => set({ sort: v })} />
          </>
        ) : (
          <Button
            variant="outline"
            onClick={() => setSheetOpen(true)}
            aria-label="Filters and sort"
          >
            <SlidersHorizontal />
            {activeCount ? `Filters (${activeCount})` : "Filters"}
          </Button>
        )}
      </div>

      {/* Topic chips */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Topics">
        <Chip on={!filters.topic} onClick={() => set({ topic: undefined })}>
          All topics
        </Chip>
        {topics.map((t) => (
          <Chip
            key={t.id}
            on={filters.topic === t.id}
            onClick={() => set({ topic: filters.topic === t.id ? undefined : t.id })}
          >
            {t.name} <span className="opacity-70">{counts.get(t.id) ?? 0}</span>
          </Chip>
        ))}
      </div>

      {!desktop && activeCount > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {filters.speaker && (
            <ActiveChip onClear={() => set({ speaker: undefined })}>
              {speakers.find(([k]) => k === filters.speaker)?.[1] ?? "Speaker"}
            </ActiveChip>
          )}
          {filters.format && (
            <ActiveChip onClear={() => set({ format: undefined })}>
              {FORMAT_LABEL[filters.format]}
            </ActiveChip>
          )}
          {filters.kind && (
            <ActiveChip onClear={() => set({ kind: undefined })}>
              {KIND_LABEL[filters.kind]}
            </ActiveChip>
          )}
          {filters.event && (
            <ActiveChip onClear={() => set({ event: undefined })}>
              {eventName.get(filters.event) ?? "Event"}
            </ActiveChip>
          )}
        </div>
      )}

      {results.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={n ? "Nothing matches" : "No talks yet"}
          body={
            n
              ? "Try fewer filters or another search."
              : "Talks, panels and workshops you can open will show up here."
          }
          action={
            n ? (
              <Button
                variant="soft"
                onClick={() => void navigate({ to: "/library/talks", search: {} })}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : desktop ? (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div
            className={cn(
              GRID,
              "border-b border-line text-[11px] font-bold uppercase tracking-[.06em] text-faint",
            )}
            aria-hidden="true"
          >
            <span />
            <span>Title and speaker</span>
            <span>Format</span>
            <span>Topics</span>
            <span>Recorded at</span>
            <span>Length</span>
            <span>Date</span>
            <span />
          </div>
          <ul>
            {results.map((i) => (
              <li
                key={i.id}
                className={cn(
                  GRID,
                  "relative border-t border-line text-[13px] first:border-t-0 hover:bg-surface-2/60",
                )}
              >
                <KindIcon kind={i.kind} />
                <div className="min-w-0">
                  <Link
                    {...itemHref(i.id)}
                    className="block truncate font-bold after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {i.title}
                  </Link>
                  <small className="block truncate text-[11.5px] text-muted-foreground">
                    {speakerLine(i.speakers, people)}
                  </small>
                </div>
                <span className="text-[12.5px]">{FORMAT_LABEL[i.format]}</span>
                <div className="flex flex-wrap gap-1">
                  {i.topicIds.map(
                    (t) => topicName.get(t) && <TopicPill key={t}>{topicName.get(t)}</TopicPill>,
                  )}
                </div>
                <small className="truncate text-[11.5px] text-muted-foreground">
                  {i.eventId ? (eventName.get(i.eventId) ?? "—") : "—"}
                </small>
                <small className="text-[11.5px] text-muted-foreground">{lengthLabel(i)}</small>
                <small className="text-[11.5px] text-muted-foreground">
                  {format(parseDate(itemDate(i)), "MMM yyyy")}
                </small>
                <ItemStatus item={i} progress={progress.get(i.id)} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ul className="grid rounded-card border border-line bg-surface px-3 py-1">
          {results.map((i) => {
            const st = statusText(i, progress.get(i.id));
            const len = lengthLabel(i).split(" · ")[1] ?? "";
            return (
              <li key={i.id} className="border-t border-line first:border-t-0">
                <Link
                  {...itemHref(i.id)}
                  className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 py-2.5"
                >
                  <KindIcon kind={i.kind} />
                  <span className="min-w-0">
                    <b className="block truncate text-[13px]">{i.title}</b>
                    <small className="block truncate text-[11.5px] text-muted-foreground">
                      {[
                        FORMAT_LABEL[i.format],
                        speakerLine(i.speakers, people, i.speakers.length > 1),
                        len,
                        st,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </small>
                  </span>
                  {!st && <ItemStatus item={i} progress={progress.get(i.id)} />}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <TopicsDialog open={topicsOpen} onOpenChange={setTopicsOpen} counts={allCounts} />
      <FormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Filters"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() =>
                set({
                  speaker: undefined,
                  format: undefined,
                  topic: undefined,
                  kind: undefined,
                  event: undefined,
                })
              }
            >
              Clear
            </Button>
            <Button onClick={() => setSheetOpen(false)}>
              Show {results.length} {results.length === 1 ? "talk" : "talks"}
            </Button>
          </>
        }
      >
        <div className="grid gap-2 [&>button]:w-full">
          {filterSelects}
          <SortSelect value={filters.sort} onChange={(v) => set({ sort: v })} />
        </div>
      </FormSheet>
    </div>
  );
}

const GRID =
  "grid grid-cols-[34px_minmax(0,2.2fr)_84px_minmax(0,1.3fr)_minmax(0,1.3fr)_110px_72px_86px] items-center gap-3.5 px-4 py-2.5";

/** Drop empty values so the URL stays short. */
function clean(f: CatalogFilters): CatalogFilters {
  const out: CatalogFilters = {};
  for (const [k, v] of Object.entries(f)) if (v) (out as Record<string, unknown>)[k] = v;
  if (out.sort === "newest") delete out.sort;
  return out;
}

function FilterSelect({
  icon: Icon,
  label,
  value,
  onChange,
  options,
}: {
  icon: LucideIcon;
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: [string, string][];
}) {
  const current = options.find(([k]) => k === value)?.[1];
  return (
    <Select value={value ?? ANY} onValueChange={(v) => onChange(v === ANY ? undefined : v)}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          "h-9 w-auto gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold",
          value && "border-transparent bg-primary-soft text-primary-ink",
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="max-w-[180px] truncate">
          {label}: {current ?? "Any"}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>Any {label.toLowerCase()}</SelectItem>
        {options.map(([k, name]) => (
          <SelectItem key={k} value={k}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortSelect({
  value,
  onChange,
}: {
  value: CatalogSort | undefined;
  onChange: (v: CatalogSort) => void;
}) {
  return (
    <Select value={value ?? "newest"} onValueChange={(v) => onChange(v as CatalogSort)}>
      <SelectTrigger
        aria-label="Sort"
        className="h-9 w-auto gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold"
      >
        <ArrowDownUp className="size-3.5" aria-hidden="true" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(SORT_LABEL) as CatalogSort[]).map((s) => (
          <SelectItem key={s} value={s}>
            {SORT_LABEL[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-full border border-line bg-surface px-[11px] py-1 text-[12px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
        on && "border-foreground bg-foreground text-background",
      )}
    >
      {children}
    </button>
  );
}

function ActiveChip({ onClear, children }: { onClear: () => void; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-0.5 pr-1 pl-2.5 text-[12px] font-semibold text-primary-ink">
      {children}
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove filter"
        className="grid size-5 place-items-center rounded-full hover:bg-primary/15"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
