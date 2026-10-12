/**
 * People list: row model, filters and sorting (no React components here).
 */
import { useMemo } from "react";
import { addYears, differenceInCalendarDays } from "date-fns";
import {
  apprenticeAlertLevel,
  daysSince,
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

export interface Filters {
  q: string;
  stage: StageFilter;
  attention: AttentionFilter | null;
  location: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: Filters = {
  q: "",
  stage: "all",
  attention: null,
  location: "all",
  sort: "name",
};

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

export function matchesAttention(r: PersonRow, a: AttentionFilter | null): boolean {
  if (!a) return true;
  if (a === "any") return r.attention.size > 0;
  return r.attention.has(a);
}

/** Rows for a segment that match everything except the stage filter (for chip counts). */
export function baseFilter(rows: PersonRow[], segment: Segment, f: Filters): PersonRow[] {
  const needle = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      inSegment(r, segment) &&
      matchesQuery(r.person, needle) &&
      matchesAttention(r, f.attention) &&
      (f.location === "all" || (r.person.location ?? "") === f.location),
  );
}

export function activeFilterCount(f: Filters, segment: Segment): number {
  return (
    Number(segment === "business" && f.stage !== "all") +
    Number(f.attention !== null) +
    Number(f.location !== "all") +
    Number(f.sort !== DEFAULT_FILTERS.sort)
  );
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
