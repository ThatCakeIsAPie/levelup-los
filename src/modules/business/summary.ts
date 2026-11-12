/**
 * Live numbers for the "My business" hub tiles. Everything is read through
 * @/data hooks, so visibility rules already apply (apprentices see their own
 * smaller team, candidates only themselves).
 */
import { useMemo } from "react";
import { addDays, addYears, differenceInCalendarDays } from "date-fns";
import {
  apprenticeAlertLevel,
  daysFromToday,
  daysSince,
  effectiveBizClass,
  isRegistered,
  localDate,
  missingRequiredFields,
  needsTicket,
  parseDate,
  registeredOn,
  useAttendancesForEvent,
  useAttendancesForPerson,
  useCategoryOf,
  useContactSettings,
  useCurrentUser,
  useEvents,
  useLastContactMap,
  useMyCampaigns,
  useMyInvoices,
  useUpcomingEvents,
  useVisibleAttendances,
  useVisibleCustomers,
  useVisibleTeam,
  usesTravel,
  type Attendance,
  type CrmEvent,
} from "@/data";

export const STAGES = ["ibo", "apprentice"] as const;
export type TeamStage = (typeof STAGES)[number];

/**
 * Team size (without you), people who registered in the last 30 days and the
 * stage mix. Registered people only: prospects are on the pipeline, not the team.
 */
export function useTeamSummary() {
  const user = useCurrentUser();
  const visible = useVisibleTeam();
  return useMemo(() => {
    const team = visible.filter((p) => p.id !== user.personId && isRegistered(p));
    const since = daysFromToday(-30);
    const mix: Record<TeamStage, number> = { ibo: 0, apprentice: 0 };
    let fresh = 0;
    for (const p of team) {
      mix[effectiveBizClass(p) === "ibo" ? "ibo" : "apprentice"]++;
      const on = registeredOn(p);
      if (on && on >= since) fresh++;
    }
    return { count: team.length, fresh, mix };
  }, [visible, user.personId]);
}

/**
 * Business people (you and your team, no customers) that the People list flags
 * as needing attention: contact overdue (not you), missing required info, an
 * apprentice anniversary coming up, or a follow-up date on an upcoming event
 * that has passed. Same reasons as the People list "Needs attention" filter.
 */
export function usePeopleAttentionCount(): number {
  const user = useCurrentUser();
  const team = useVisibleTeam();
  const lastContact = useLastContactMap();
  const { teamDays } = useContactSettings();
  const events = useEvents();
  const attendances = useVisibleAttendances();
  return useMemo(() => {
    const today = localDate();
    const upcoming = new Set(events.filter((e) => (e.endDate ?? e.date) >= today).map((e) => e.id));
    const followUp = new Map<string, string>();
    for (const a of attendances) {
      if (!a.followUpDate || !upcoming.has(a.eventId)) continue;
      const prev = followUp.get(a.personId);
      if (!prev || a.followUpDate < prev) followUp.set(a.personId, a.followUpDate);
    }
    let n = 0;
    for (const p of team) {
      const days = daysSince(lastContact.get(p.id));
      const contactOverdue = p.id !== user.personId && (days === null || days > teamDays);
      const next = followUp.get(p.id);
      if (
        contactOverdue ||
        missingRequiredFields(p).length > 0 ||
        apprenticeAlertLevel(p) ||
        (!!next && next < today)
      )
        n++;
    }
    return n;
  }, [team, lastContact, teamDays, events, attendances, user.personId]);
}

/** Your customers, their monthly volume and how many are due for contact. */
export function useCustomerSummary() {
  const customers = useVisibleCustomers();
  const lastContact = useLastContactMap();
  const { customerDays } = useContactSettings();
  return useMemo(() => {
    let volume = 0;
    let due = 0;
    for (const c of customers) {
      volume += c.monthlyVolume ?? 0;
      const days = daysSince(lastContact.get(c.id));
      if (days === null || days > customerDays) due++;
    }
    return { count: customers.length, volume, due, customerDays };
  }, [customers, lastContact, customerDays]);
}

/**
 * The event the hub features: for candidates the next event they're on the
 * list for; otherwise the next event with travel (a conference), else the next event of any kind
 * (same choice as the Dashboard's event card).
 */
export function useFeaturedEvent(): CrmEvent | undefined {
  const user = useCurrentUser();
  const upcoming = useUpcomingEvents();
  const mine = useAttendancesForPerson(user.personId);
  const categoryOf = useCategoryOf();
  return useMemo(() => {
    if (user.role === "candidate") {
      const onList = new Set(mine.map((a) => a.eventId));
      const own = upcoming.find((e) => onList.has(e.id));
      if (own) return own;
    }
    return upcoming.find((e) => usesTravel(categoryOf(e))) ?? upcoming[0];
  }, [user.role, upcoming, mine, categoryOf]);
}

/** Ticket numbers for one event from the visible roster. */
export function useTicketSummary(event: CrmEvent | undefined) {
  const rows = useAttendancesForEvent(event?.id);
  return useMemo(() => ticketStats(rows), [rows]);
}

export function ticketStats(rows: Attendance[], today = localDate()) {
  const weekEnd = localDate(addDays(parseDate(today), 6));
  return {
    invited: rows.length,
    bought: rows.filter((a) => a.hasTicket).length,
    plannedThisWeek: rows.filter(
      (a) =>
        !a.hasTicket &&
        !!a.plannedPurchaseDate &&
        a.plannedPurchaseDate >= today &&
        a.plannedPurchaseDate <= weekEnd,
    ).length,
    needTicket: rows.filter(needsTicket).length,
  };
}

/** Calendar days from today until `d` (negative when past). */
export const daysUntil = (d: string) =>
  differenceInCalendarDays(parseDate(d), parseDate(localDate()));

/** What you owe and what you've paid for shared costs. */
export function useWalletSummary() {
  const invoices = useMyInvoices();
  return useMemo(() => {
    const owed = invoices.filter((i) => i.status === "owed");
    const paid = invoices.filter((i) => i.status === "paid");
    return {
      owed: owed.reduce((s, i) => s + i.amount, 0),
      owedCount: owed.length,
      paid: paid.reduce((s, i) => s + i.amount, 0),
      paidCount: paid.length,
    };
  }, [invoices]);
}

/** Your queued campaigns (all "pending send" until a provider is connected). */
export function useCampaignSummary() {
  const campaigns = useMyCampaigns();
  return useMemo(() => {
    const now = new Date();
    const scheduled = campaigns
      .map((c) => c.scheduledFor)
      .filter((d): d is string => !!d && parseDate(d) > now)
      .sort();
    return { count: campaigns.length, scheduled: scheduled.length, next: scheduled[0] };
  }, [campaigns]);
}

/** Candidate path: days until an apprentice becomes an IBO, if known. */
export function iboInDays(businessStartDate: string | undefined): number | undefined {
  if (!businessStartDate) return undefined;
  return daysUntil(localDate(addYears(parseDate(businessStartDate), 1)));
}
