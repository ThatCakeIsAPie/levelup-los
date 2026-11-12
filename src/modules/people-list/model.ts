/**
 * People list: row model, filters and sorting (no React components here).
 */
import { useMemo } from "react";
import { addYears, differenceInCalendarDays } from "date-fns";
import {
  apprenticeAlertLevel,
  daysSince,
  downlineIds,
  effectiveBizClass,
  getPersonShowRate,
  lastSale,
  localDate,
  missingRequiredFields,
  parseDate,
  useContactSettings,
  useCurrentUser,
  useEvents,
  useLastContactMap,
  useSales,
  useVisibleAttendances,
  useVisiblePeople,
  type ApprenticeAlert,
  type BizClass,
  type CrmPerson,
  type Sale,
} from "@/data";
import type { Tone } from "@/components/brand";
import { listParam, parseListParam, toggleInList } from "@/lib/searchList";

export type Segment = "business" | "customers";
export type StageFilter = "all" | "prospect" | "apprentice" | "ibo";
export type AttentionFilter = "any" | "contact" | "missing" | "anniversary" | "followup";
export type SortKey =
  | "name"
  | "lastContact"
  | "stage"
  | "showRate"
  | "followUp"
  | "volume"
  | "lastPurchase"
  | "updated";

export const SORT_OPTIONS: Record<Segment, { value: SortKey; label: string }[]> = {
  business: [
    { value: "name", label: "Name" },
    { value: "lastContact", label: "Longest since contact" },
    { value: "stage", label: "Stage" },
    { value: "showRate", label: "Show rate" },
    { value: "followUp", label: "Next follow-up" },
    { value: "updated", label: "Recently updated" },
  ],
  customers: [
    { value: "name", label: "Name" },
    { value: "lastContact", label: "Longest since contact" },
    { value: "volume", label: "Monthly volume" },
    { value: "lastPurchase", label: "Last purchase" },
    { value: "updated", label: "Recently updated" },
  ],
};

export const ATTENTION_OPTIONS: { value: AttentionFilter; label: string }[] = [
  { value: "any", label: "Any reason" },
  { value: "contact", label: "Contact overdue" },
  { value: "missing", label: "Missing info" },
  { value: "anniversary", label: "IBO anniversary" },
  { value: "followup", label: "Follow-up overdue" },
];

export const MISSING_LABEL: Record<string, string> = {
  name: "name",
  owner: "owner",
  iboNumber: "IBO#",
  ltdNumber: "LTD#",
  businessStartDate: "start date",
};

export interface ContactState {
  /** Last contact date, if any. */
  date?: string;
  /** Whole days since the last contact (null = never). */
  days: number | null;
  /** good: within the goal; warn: overdue; bad: more than twice the goal or never. */
  tone: Tone;
  overdue: boolean;
  /** Goal in days for this person (team or customer setting). */
  limit: number;
}

export interface PersonRow {
  person: CrmPerson;
  /** Stage after the automatic apprentice -> IBO promotion. */
  stage: BizClass;
  isSelf: boolean;
  /** Sponsor (business) or owner (customer), when visible. */
  upline?: CrmPerson;
  contact: ContactState;
  showRate: { attended: number; eligible: number; pct: number };
  /** Earliest follow-up date on an upcoming event roster. */
  followUp?: string;
  followUpOverdue: boolean;
  alert: ApprenticeAlert;
  /** Days until the apprentice anniversary (negative when past). */
  anniversaryDays?: number;
  anniversaryDate?: string;
  missing: string[];
  lastSale?: Sale;
  attention: Set<Exclude<AttentionFilter, "any">>;
}

export function anniversaryOf(p: CrmPerson): string | undefined {
  if (!p.businessStartDate) return undefined;
  return localDate(addYears(parseDate(p.businessStartDate), 1));
}

function contactState(date: string | undefined, limit: number): ContactState {
  const days = daysSince(date);
  if (days === null) return { date, days, tone: "bad", overdue: true, limit };
  if (days <= limit) return { date, days, tone: "good", overdue: false, limit };
  return { date, days, tone: days > limit * 2 ? "bad" : "warn", overdue: true, limit };
}

/** Every visible person with the derived fields the list needs. */
export function usePeopleRows(): PersonRow[] {
  const people = useVisiblePeople();
  const user = useCurrentUser();
  const attendances = useVisibleAttendances();
  const events = useEvents();
  const lastContact = useLastContactMap();
  const settings = useContactSettings();
  const sales = useSales();

  return useMemo(() => {
    const today = localDate();
    const byId = new Map(people.map((p) => [p.id, p]));
    const upcoming = new Set(events.filter((e) => (e.endDate ?? e.date) >= today).map((e) => e.id));
    const followUps = new Map<string, string>();
    for (const a of attendances) {
      if (!a.followUpDate || !upcoming.has(a.eventId)) continue;
      const prev = followUps.get(a.personId);
      if (!prev || a.followUpDate < prev) followUps.set(a.personId, a.followUpDate);
    }

    return people.map((p): PersonRow => {
      const isCustomer = p.bizClass === "customer";
      const isSelf = p.id === user.personId;
      const limit = isCustomer ? settings.customerDays : settings.teamDays;
      const contact = contactState(lastContact.get(p.id), limit);
      const alert = apprenticeAlertLevel(p);
      const anniversaryDate = p.bizClass === "apprentice" ? anniversaryOf(p) : undefined;
      const anniversaryDays = anniversaryDate
        ? differenceInCalendarDays(parseDate(anniversaryDate), parseDate(today))
        : undefined;
      const missing = missingRequiredFields(p);
      const followUp = followUps.get(p.id);
      const followUpOverdue = !!followUp && followUp < today;
      const uplineId = isCustomer ? p.ownerId : p.sponsorId;

      const attention = new Set<Exclude<AttentionFilter, "any">>();
      if (!isSelf && contact.overdue) attention.add("contact");
      if (missing.length) attention.add("missing");
      if (alert) attention.add("anniversary");
      if (followUpOverdue) attention.add("followup");

      return {
        person: p,
        stage: effectiveBizClass(p),
        isSelf,
        upline: uplineId ? byId.get(uplineId) : undefined,
        contact,
        showRate: getPersonShowRate(p.id, attendances, events),
        followUp,
        followUpOverdue,
        alert,
        anniversaryDays,
        anniversaryDate,
        missing,
        lastSale: isCustomer ? lastSale(sales, p.id) : undefined,
        attention,
      };
    });
  }, [people, user.personId, attendances, events, lastContact, settings, sales]);
}

/** Business stages the People list filters by (customers have their own segment). */
export type StageKey = Exclude<StageFilter, "all">;
export const STAGE_KEYS: readonly StageKey[] = ["prospect", "apprentice", "ibo"];
export type AttentionReason = Exclude<AttentionFilter, "any">;
export const ATTENTION_KEYS: readonly AttentionFilter[] = ATTENTION_OPTIONS.map((o) => o.value);
const SORT_KEYS = new Set<string>(
  [...SORT_OPTIONS.business, ...SORT_OPTIONS.customers].map((o) => o.value),
);

export interface Filters {
  q: string;
  /** Stages shown together (business only); empty = everyone. */
  stages: StageKey[];
  /** Needs attention: empty = off, ["any"] = any reason, else any of these reasons. */
  attention: AttentionFilter[];
  /** Locations shown together; empty = all. */
  locations: string[];
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  stages: [],
  attention: [],
  locations: [],
  sort: "name",
};

// ---------------------------------------------------------------------------
// URL search params (`/people?seg=customers&stage=apprentice,ibo&attn=contact`)
// ---------------------------------------------------------------------------

export interface PeopleSearch {
  seg?: "customers";
  q?: string;
  /** Comma-separated stages. */
  stage?: string;
  /** Comma-separated attention reasons ("any" for any reason). */
  attn?: string;
  /** Locations (they may contain commas, so a list). */
  loc?: string[];
  sort?: SortKey;
}

/** validateSearch for /people: drops anything unknown. */
export function validatePeopleSearch(s: Record<string, unknown>): PeopleSearch {
  const loc = (Array.isArray(s.loc) ? s.loc : typeof s.loc === "string" ? [s.loc] : []).filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  return {
    seg: s.seg === "customers" ? "customers" : undefined,
    q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
    stage: listParam(parseListParam(s.stage, STAGE_KEYS)),
    attn: listParam(parseListParam(s.attn, ATTENTION_KEYS)),
    loc: loc.length ? [...new Set(loc)] : undefined,
    sort: typeof s.sort === "string" && SORT_KEYS.has(s.sort) ? (s.sort as SortKey) : undefined,
  };
}

/** The segment and filters a search describes. */
export function filtersFromSearch(s: PeopleSearch): { segment: Segment; filters: Filters } {
  const segment: Segment = s.seg === "customers" ? "customers" : "business";
  const attention = parseListParam(s.attn, ATTENTION_KEYS) ?? [];
  const sort = s.sort && SORT_OPTIONS[segment].some((o) => o.value === s.sort) ? s.sort : "name";
  return {
    segment,
    filters: {
      q: s.q ?? "",
      stages: segment === "business" ? (parseListParam(s.stage, STAGE_KEYS) ?? []) : [],
      // "Any reason" covers every reason, so it never sits next to one.
      attention: attention.includes("any") ? ["any"] : attention,
      locations: s.loc ?? [],
      sort,
    },
  };
}

/** The search for a segment and filters (defaults left out, so a plain /people stays plain). */
export function searchFromFilters(segment: Segment, f: Filters): PeopleSearch {
  return {
    seg: segment === "customers" ? "customers" : undefined,
    q: f.q || undefined,
    stage: segment === "business" ? listParam(f.stages) : undefined,
    attn: listParam(f.attention),
    loc: f.locations.length ? f.locations : undefined,
    sort: f.sort === DEFAULT_FILTERS.sort ? undefined : f.sort,
  };
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export function inSegment(r: PersonRow, segment: Segment): boolean {
  return segment === "customers"
    ? r.person.bizClass === "customer"
    : r.person.bizClass !== "customer";
}

function matchesQuery(p: CrmPerson, needle: string): boolean {
  if (!needle) return true;
  return [p.name, p.email, p.phone, p.iboNumber, p.ltdNumber, p.location]
    .filter(Boolean)
    .some((v) => v!.toLowerCase().includes(needle));
}

/** One attention option, or a list of them (any may match); null or [] = off. */
export function matchesAttention(
  r: PersonRow,
  a: AttentionFilter | readonly AttentionFilter[] | null,
): boolean {
  const list = a === null ? [] : typeof a === "string" ? [a] : a;
  if (!list.length) return true;
  return list.some((x) => (x === "any" ? r.attention.size > 0 : r.attention.has(x)));
}

/** Business rows whose stage is one of `stages` (empty = all). */
export function matchesStages(r: PersonRow, stages: readonly StageKey[]): boolean {
  return !stages.length || (r.stage !== "customer" && stages.includes(r.stage));
}

/** Rows for a segment that match everything except the stage filter (for chip counts). */
export function baseFilter(rows: PersonRow[], segment: Segment, f: Filters): PersonRow[] {
  const needle = f.q.trim().toLowerCase();
  const locations = new Set(f.locations);
  return rows.filter(
    (r) =>
      inSegment(r, segment) &&
      matchesQuery(r.person, needle) &&
      matchesAttention(r, f.attention) &&
      (!locations.size || locations.has(r.person.location ?? "")),
  );
}

/** The rows the list shows: every filter applied, sorted. */
export function filterRows(rows: PersonRow[], segment: Segment, f: Filters): PersonRow[] {
  const base = baseFilter(rows, segment, f);
  return sortRows(
    segment === "business" ? base.filter((r) => matchesStages(r, f.stages)) : base,
    f.sort,
  );
}

/** Chip counts per stage, from rows that match every other filter. */
export function stageCounts(base: PersonRow[]): Record<StageFilter, number> {
  const c: Record<StageFilter, number> = { all: base.length, prospect: 0, apprentice: 0, ibo: 0 };
  for (const r of base) if (r.stage !== "customer") c[r.stage]++;
  return c;
}

/** Counts per attention option, from rows that match every other filter (stages included). */
export function attentionCounts(
  rows: PersonRow[],
  segment: Segment,
  f: Filters,
): Record<AttentionFilter, number> {
  const pool = baseFilter(rows, segment, { ...f, attention: [] }).filter(
    (r) => segment === "customers" || matchesStages(r, f.stages),
  );
  const c = {} as Record<AttentionFilter, number>;
  for (const o of ATTENTION_OPTIONS)
    c[o.value] = pool.filter((r) => matchesAttention(r, o.value)).length;
  return c;
}

/**
 * Pick an attention option: "any" replaces the reasons (or turns it off), a
 * reason replaces "any" and toggles among the other reasons.
 */
export function toggleAttention(
  list: readonly AttentionFilter[],
  v: AttentionFilter,
): AttentionFilter[] {
  if (v === "any") return list.includes("any") ? [] : ["any"];
  return toggleInList(
    list.filter((x) => x !== "any"),
    v,
    ATTENTION_KEYS,
  );
}

export function activeFilterCount(f: Filters, segment: Segment): number {
  return (
    Number(segment === "business" && f.stages.length > 0) +
    Number(f.attention.length > 0) +
    Number(f.locations.length > 0) +
    Number(f.sort !== DEFAULT_FILTERS.sort)
  );
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/** Rows that can be selected (never yourself). */
export function selectableRows(rows: PersonRow[]): PersonRow[] {
  return rows.filter((r) => !r.isSelf);
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** "all" when every selectable shown row is selected, "some", or "none". */
export function shownSelection(
  selected: ReadonlySet<string>,
  shown: PersonRow[],
): "all" | "some" | "none" {
  const sel = selectableRows(shown);
  const n = sel.filter((r) => selected.has(r.person.id)).length;
  return n === 0 ? "none" : n === sel.length ? "all" : "some";
}

/**
 * "Select all shown": selects every selectable row on screen, or, when they
 * all already are, clears them. Only what's shown is touched.
 */
export function toggleAllShown(selected: ReadonlySet<string>, shown: PersonRow[]): Set<string> {
  const ids = selectableRows(shown).map((r) => r.person.id);
  const next = new Set(selected);
  if (shownSelection(selected, shown) === "all") ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

/** The selected rows that are still shown, in list order. */
export function selectedShown(selected: ReadonlySet<string>, shown: PersonRow[]): PersonRow[] {
  return shown.filter((r) => !r.isSelf && selected.has(r.person.id));
}

// ---------------------------------------------------------------------------
// Bulk actions: who each one applies to
// ---------------------------------------------------------------------------

export interface Plan {
  /** Rows the action changes. */
  apply: PersonRow[];
  /** Rows left alone, with a short reason ("already an IBO"). */
  skipped: { row: PersonRow; reason: string }[];
}

function plan(rows: PersonRow[], why: (r: PersonRow) => string | null): Plan {
  const out: Plan = { apply: [], skipped: [] };
  for (const r of rows) {
    const reason = r.isSelf ? "that's you" : why(r);
    if (reason) out.skipped.push({ row: r, reason });
    else out.apply.push(r);
  }
  return out;
}

/** Ids of people someone sits under (they sponsor someone or own a customer). */
export function leadsSomeone(people: CrmPerson[]): Set<string> {
  const out = new Set<string>();
  for (const p of people) {
    const up = p.bizClass === "customer" ? p.ownerId : p.sponsorId;
    if (up) out.add(up);
  }
  return out;
}

/**
 * Change stage: business people only. Skips anyone already at that stage,
 * and won't make a prospect of someone who sponsors people or has customers.
 */
export function stageChangePlan(rows: PersonRow[], to: StageKey, people: CrmPerson[]): Plan {
  const leads = leadsSomeone(people);
  return plan(rows, (r) => {
    if (r.person.bizClass === "customer") return "a customer";
    if (r.stage === to) return to === "ibo" ? "already an IBO" : `already a ${to}`;
    if (to === "prospect" && leads.has(r.person.id)) return "has people under them";
    return null;
  });
}

/** What a stage change writes (a new apprentice starts their business today unless a date is set). */
export function stagePatch(p: CrmPerson, to: StageKey, today: string): Partial<CrmPerson> {
  return {
    bizClass: to,
    pipelineStage: to,
    ...(to === "apprentice" && !p.businessStartDate ? { businessStartDate: today } : {}),
  };
}

/**
 * Who the selected people can move under: apprentices and IBOs, never one of
 * the selected people or anyone in their downline (nobody can be sponsored
 * by their own downline).
 */
export function sponsorChoices(people: CrmPerson[], selectedIds: Iterable<string>): CrmPerson[] {
  const blocked = new Set<string>();
  for (const id of selectedIds) downlineIds(people, id).forEach((d) => blocked.add(d));
  return people
    .filter((p) => (p.bizClass === "apprentice" || p.bizClass === "ibo") && !blocked.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Change sponsor: business people only, not those already under them, never into their own downline. */
export function sponsorChangePlan(rows: PersonRow[], sponsorId: string, people: CrmPerson[]): Plan {
  return plan(rows, (r) => {
    if (r.person.bizClass === "customer") return "a customer";
    if (r.person.sponsorId === sponsorId) return "already under them";
    if (downlineIds(people, r.person.id).has(sponsorId)) return "would be under their own team";
    return null;
  });
}

/** Tidy a typed tag: trimmed, inner spaces collapsed, at most 40 characters. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 40).trim();
}

/** Add a tag: skips people who already have it (any capitalisation). */
export function tagPlan(rows: PersonRow[], tag: string): Plan {
  const t = cleanTag(tag).toLowerCase();
  return plan(rows, (r) =>
    (r.person.tags ?? []).some((x) => x.toLowerCase() === t) ? "already tagged" : null,
  );
}

/** Every tag in use, most used first (capitalisation folded: the first spelling seen wins). */
export function tagsInUse(people: CrmPerson[]): string[] {
  const n = new Map<string, { tag: string; count: number }>();
  for (const p of people)
    for (const t of p.tags ?? []) {
      const k = t.toLowerCase();
      const hit = n.get(k);
      if (hit) hit.count++;
      else n.set(k, { tag: t, count: 1 });
    }
  return [...n.values()]
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .map((x) => x.tag);
}

/** Ids up the viewer's own sponsor line (a deputy sees their leader). */
export function uplineIdsOf(people: CrmPerson[], viewerId: string): Set<string> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out = new Set<string>();
  let cur = byId.get(viewerId);
  while (cur?.sponsorId && !out.has(cur.sponsorId)) {
    out.add(cur.sponsorId);
    cur = byId.get(cur.sponsorId);
  }
  return out;
}

/** Delete: never yourself or anyone above you (a deputy can't remove their leader). */
export function deletePlan(rows: PersonRow[], uplineIds: ReadonlySet<string>): Plan {
  return plan(rows, (r) => (uplineIds.has(r.person.id) ? "above you" : null));
}

/** "Changed for 4 people · 2 skipped (already an IBO)". */
export function skippedNote(p: Plan): string | undefined {
  if (!p.skipped.length) return undefined;
  const reasons = [...new Set(p.skipped.map((s) => s.reason))];
  return `${p.skipped.length} skipped (${reasons.join(", ")})`;
}

const STAGE_ORDER: Record<BizClass, number> = { ibo: 0, apprentice: 1, prospect: 2, customer: 3 };

export function sortRows(rows: PersonRow[], sort: SortKey): PersonRow[] {
  const byName = (a: PersonRow, b: PersonRow) => a.person.name.localeCompare(b.person.name);
  const cmp: Record<SortKey, (a: PersonRow, b: PersonRow) => number> = {
    name: byName,
    // Never contacted first, then the longest gap. You (self) go last.
    lastContact: (a, b) =>
      Number(a.isSelf) - Number(b.isSelf) ||
      (b.contact.days ?? Infinity) - (a.contact.days ?? Infinity) ||
      byName(a, b),
    stage: (a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || byName(a, b),
    showRate: (a, b) =>
      Number(b.showRate.eligible > 0) - Number(a.showRate.eligible > 0) ||
      b.showRate.pct - a.showRate.pct ||
      byName(a, b),
    followUp: (a, b) => (a.followUp ?? "9999").localeCompare(b.followUp ?? "9999") || byName(a, b),
    volume: (a, b) => (b.person.monthlyVolume ?? 0) - (a.person.monthlyVolume ?? 0) || byName(a, b),
    lastPurchase: (a, b) =>
      (b.lastSale?.date ?? "").localeCompare(a.lastSale?.date ?? "") || byName(a, b),
    updated: (a, b) =>
      (b.person.lastUpdatedAt ?? "").localeCompare(a.person.lastUpdatedAt ?? "") || byName(a, b),
  };
  return [...rows].sort(cmp[sort] ?? byName);
}

/** "Today", "Yesterday", "5 days ago", "Never". */
export function contactLabel(days: number | null): string {
  if (days === null) return "Never";
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function shortDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function fullDate(iso: string): string {
  return parseDate(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
