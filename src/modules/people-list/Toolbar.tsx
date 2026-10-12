import { useState } from "react";
import { AlertTriangle, Search, SlidersHorizontal, X } from "lucide-react";
import { STAGE_CHIP_CLASS, STAGE_SOLID_CLASS } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ATTENTION_OPTIONS,
  DEFAULT_FILTERS,
  activeFilterCount,
  SORT_OPTIONS,
  type AttentionFilter,
  type Filters,
  type Segment,
  type SortKey,
  type StageFilter,
} from "./model";

export interface ToolbarProps {
  segment: Segment;
  onSegment: (s: Segment) => void;
  segmentCounts: Record<Segment, number>;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  stageCounts: Record<StageFilter, number>;
  attentionCounts: Record<AttentionFilter, number>;
  locations: string[];
  resultCount: number;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SegmentedControl({
  segment,
  onSegment,
  counts,
  className,
}: {
  segment: Segment;
  onSegment: (s: Segment) => void;
  counts: Record<Segment, number>;
  className?: string;
}) {
  const items: { value: Segment; label: string }[] = [
    { value: "business", label: "Business" },
    { value: "customers", label: "Customers" },
  ];
  return (
    <div
      role="group"
      aria-label="Relationship path"
      className={cn("grid grid-cols-2 gap-0.5 rounded-[10px] bg-surface-2 p-[3px]", className)}
    >
      {items.map((it) => {
        const on = segment === it.value;
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={on}
            onClick={() => onSegment(it.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
              on && "bg-surface text-foreground shadow-[0_1px_2px_rgba(0,0,0,.08)]",
              FOCUS,
            )}
          >
            {it.label}
            <span className="tabular-nums text-faint">{counts[it.value]}</span>
          </button>
        );
      })}
    </div>
  );
}

const STAGES: { value: StageFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "prospect", label: "Prospect" },
  { value: "apprentice", label: "Apprentice" },
  { value: "ibo", label: "IBO" },
];

function StageChips({
  value,
  onChange,
  counts,
}: {
  value: StageFilter;
  onChange: (s: StageFilter) => void;
  counts: Record<StageFilter, number>;
}) {
  return (
    <div role="group" aria-label="Stage" className="flex flex-wrap gap-1.5">
      {STAGES.map((s) => {
        const on = value === s.value;
        return (
          <button
            key={s.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(s.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
              on
                ? s.value === "all"
                  ? "border-foreground bg-foreground text-background"
                  : cn("border-transparent", STAGE_CHIP_CLASS[s.value])
                : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              FOCUS,
            )}
          >
            {s.value !== "all" && (
              <span
                className={cn(
                  "size-2 rounded-full",
                  STAGE_SOLID_CLASS[s.value],
                  on && "ring-1 ring-current/40",
                )}
                aria-hidden="true"
              />
            )}
            {s.label}
            <span className={cn("tabular-nums", on ? "opacity-80" : "text-faint")}>
              {counts[s.value]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function AttentionToggle({
  value,
  onChange,
  count,
}: {
  value: AttentionFilter | null;
  onChange: (v: AttentionFilter | null) => void;
  count: number;
}) {
  const on = value !== null;
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(on ? null : "any")}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
        on
          ? "border-transparent bg-warn-soft text-warn-ink"
          : "border-line text-muted-foreground hover:border-foreground/30 hover:text-foreground",
        FOCUS,
      )}
    >
      <AlertTriangle className="size-3.5" aria-hidden="true" />
      Needs attention
      <span className={cn("tabular-nums", on ? "opacity-80" : "text-faint")}>{count}</span>
    </button>
  );
}

function AttentionReasons({
  value,
  onChange,
  counts,
}: {
  value: AttentionFilter;
  onChange: (v: AttentionFilter) => void;
  counts: Record<AttentionFilter, number>;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AttentionFilter)}>
      <SelectTrigger className="h-8 w-auto min-w-[170px] text-xs" aria-label="Attention reason">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ATTENTION_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label} · {counts[o.value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SortSelect({
  segment,
  value,
  onChange,
  className,
}: {
  segment: Segment;
  value: SortKey;
  onChange: (v: SortKey) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as SortKey)}>
      <SelectTrigger className={cn("h-9 text-[12.5px]", className)} aria-label="Sort by">
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <span className="mr-1 text-muted-foreground">Sort:</span>
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {SORT_OPTIONS[segment].map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function LocationSelect({
  value,
  onChange,
  locations,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  locations: string[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 text-[12.5px]", className)} aria-label="Location">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All locations</SelectItem>
        {locations.map((l) => (
          <SelectItem key={l} value={l}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SearchBox({
  value,
  onChange,
  segment,
  className,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  segment: Segment;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          segment === "customers"
            ? "Search customers"
            : compact
              ? "Search people"
              : "Search name, email, IBO#, location"
        }
        aria-label={segment === "customers" ? "Search customers" : "Search people"}
        className="h-9 pl-9 pr-8 text-[13px] [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className={cn(
            "absolute right-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-surface-2",
            FOCUS,
          )}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop toolbar (lg+)
// ---------------------------------------------------------------------------

export function DesktopToolbar(p: ToolbarProps) {
  const { segment, filters, setFilters } = p;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl segment={segment} onSegment={p.onSegment} counts={p.segmentCounts} />
        <SearchBox
          value={filters.q}
          onChange={(q) => setFilters({ q })}
          segment={segment}
          className="w-[300px] max-w-full flex-[0_1_300px]"
        />
        <div className="ml-auto flex items-center gap-2">
          {p.locations.length > 1 && (
            <LocationSelect
              value={filters.location}
              onChange={(location) => setFilters({ location })}
              locations={p.locations}
              className="w-[170px]"
            />
          )}
          <SortSelect
            segment={segment}
            value={filters.sort}
            onChange={(sort) => setFilters({ sort })}
            className="w-[220px]"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {segment === "business" && (
          <>
            <StageChips
              value={filters.stage}
              onChange={(stage) => setFilters({ stage })}
              counts={p.stageCounts}
            />
            <span className="h-5 w-px bg-line" aria-hidden="true" />
          </>
        )}
        <AttentionToggle
          value={filters.attention}
          onChange={(attention) => setFilters({ attention })}
          count={p.attentionCounts.any}
        />
        {filters.attention && (
          <AttentionReasons
            value={filters.attention}
            onChange={(attention) => setFilters({ attention })}
            counts={p.attentionCounts}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phone toolbar (< lg): segmented, search + filter button opening a sheet
// ---------------------------------------------------------------------------

export function PhoneToolbar(p: ToolbarProps) {
  const { segment, filters, setFilters } = p;
  const [open, setOpen] = useState(false);
  const active = activeFilterCount(filters, segment);
  return (
    <div className="grid gap-2.5">
      <SegmentedControl segment={segment} onSegment={p.onSegment} counts={p.segmentCounts} />
      <div className="flex gap-2">
        <SearchBox
          value={filters.q}
          onChange={(q) => setFilters({ q })}
          segment={segment}
          className="flex-1"
          compact
        />
        <Button
          variant="outline"
          className="h-9 shrink-0 px-3"
          onClick={() => setOpen(true)}
          aria-label={active ? `Filters, ${active} active` : "Filters"}
        >
          <SlidersHorizontal />
          Filters
          {active > 0 && (
            <span className="grid min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] leading-[18px] text-primary-foreground">
              {active}
            </span>
          )}
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="flex max-h-[88dvh] flex-col gap-0 rounded-t-card p-0 pb-safe"
        >
          <SheetHeader className="border-b border-line px-5 py-4 text-left">
            <SheetTitle className="text-base font-extrabold">Filter and sort</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {segment === "customers" ? "Your customers" : "Your business team"}
            </SheetDescription>
          </SheetHeader>
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto px-5 py-4">
            {segment === "business" && (
              <FieldBlock label="Stage">
                <StageChips
                  value={filters.stage}
                  onChange={(stage) => setFilters({ stage })}
                  counts={p.stageCounts}
                />
              </FieldBlock>
            )}
            <FieldBlock label="Needs attention">
              <div role="group" aria-label="Needs attention" className="flex flex-wrap gap-1.5">
                {[{ value: null, label: "Off" } as const, ...ATTENTION_OPTIONS].map((o) => {
                  const on = filters.attention === o.value;
                  return (
                    <button
                      key={o.value ?? "off"}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilters({ attention: o.value })}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
                        on
                          ? o.value
                            ? "border-transparent bg-warn-soft text-warn-ink"
                            : "border-foreground bg-foreground text-background"
                          : "border-line text-muted-foreground",
                        FOCUS,
                      )}
                    >
                      {o.label}
                      {o.value && (
                        <span className={on ? "opacity-80" : "text-faint"}>
                          {p.attentionCounts[o.value]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </FieldBlock>
            {p.locations.length > 1 && (
              <FieldBlock label="Location">
                <LocationSelect
                  value={filters.location}
                  onChange={(location) => setFilters({ location })}
                  locations={p.locations}
                />
              </FieldBlock>
            )}
            <FieldBlock label="Sort">
              <SortSelect
                segment={segment}
                value={filters.sort}
                onChange={(sort) => setFilters({ sort })}
              />
            </FieldBlock>
          </div>
          <SheetFooter className="flex-row gap-2 border-t border-line px-5 py-3 sm:justify-between">
            <Button
              variant="ghost"
              disabled={active === 0}
              onClick={() =>
                setFilters({
                  stage: "all",
                  attention: null,
                  location: "all",
                  sort: DEFAULT_FILTERS.sort,
                })
              }
            >
              Reset
            </Button>
            <Button className="flex-1 sm:flex-none" onClick={() => setOpen(false)}>
              Show {p.resultCount} {p.resultCount === 1 ? "result" : "results"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FieldBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <div className="text-[11px] font-bold uppercase tracking-[.08em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
