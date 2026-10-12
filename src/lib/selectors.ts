import type { Attendance } from "@/stores/attendanceStore";
import type { CrmEvent } from "@/stores/eventsStore";
import type { CrmPerson } from "@/stores/peopleStore";

export interface ShowRate {
  attended: number;
  eligible: number;
  pct: number;
}

export function getPersonShowRate(
  personId: string,
  attendances: Attendance[],
  events: CrmEvent[],
  today = new Date(),
): ShowRate {
  const past = events.filter((e) => new Date(e.date) < today);
  const rows = attendances.filter(
    (a) => a.personId === personId && past.some((e) => e.id === a.eventId),
  );
  const eligible = rows.filter((a) => a.hasTicket || a.desireToAttend === "yes").length;
  const attended = rows.filter((a) => a.attended === true).length;
  const pct = eligible === 0 ? 0 : Math.round((attended / eligible) * 100);
  return { attended, eligible, pct };
}

export interface EventFunnel {
  potential: number;
  desire: number;
  dateCommitted: number;
  ticket: number;
  attended: number;
}

export function getEventFunnel(
  eventId: string,
  attendances: Attendance[],
  totalRoster: number,
): EventFunnel {
  const rows = attendances.filter((a) => a.eventId === eventId);
  return {
    potential: totalRoster,
    desire: rows.filter((a) => a.desireToAttend === "yes" || a.desireToAttend === "maybe").length,
    dateCommitted: rows.filter((a) => !a.hasTicket && !!a.plannedPurchaseDate).length,
    ticket: rows.filter((a) => a.hasTicket).length,
    attended: rows.filter((a) => a.attended === true).length,
  };
}

export interface RiskFlags {
  red: string[];
  yellow: string[];
}

export function getRiskFlags(a: Attendance, today = new Date()): RiskFlags {
  const red: string[] = [];
  const yellow: string[] = [];
  if (!a.hasTicket && a.plannedPurchaseDate && new Date(a.plannedPurchaseDate) < today) {
    red.push("Ticket purchase date passed");
  }
  if (a.desireToAttend === "yes" && !a.helperId) {
    red.push("Desire = yes but no helper assigned");
  }
  if (a.desireToAttend === "yes" && !a.followUpDate && !a.hasTicket) {
    yellow.push("Desire = yes, no follow-up date");
  }
  return { red, yellow };
}

export function getUpcomingFollowUps(
  attendances: Attendance[],
  windowDays = 7,
  today = new Date(),
): Attendance[] {
  const end = new Date(today.getTime() + windowDays * 24 * 60 * 60 * 1000);
  return attendances.filter((a) => {
    const dates = [a.followUpDate, a.plannedPurchaseDate].filter(Boolean) as string[];
    return dates.some((d) => {
      const dt = new Date(d);
      return dt >= today && dt <= end;
    });
  });
}

export interface AuditDeltaRow {
  personId: string;
  personName: string;
  byEvent: Record<string, Attendance | undefined>;
}

export function getAuditDelta(
  eventIds: string[],
  attendances: Attendance[],
  people: CrmPerson[],
): AuditDeltaRow[] {
  const personIds = new Set<string>();
  attendances.filter((a) => eventIds.includes(a.eventId)).forEach((a) => personIds.add(a.personId));
  return Array.from(personIds)
    .map((pid) => {
      const person = people.find((p) => p.id === pid);
      const byEvent: Record<string, Attendance | undefined> = {};
      eventIds.forEach((eid) => {
        byEvent[eid] = attendances.find((a) => a.eventId === eid && a.personId === pid);
      });
      return { personId: pid, personName: person?.name ?? "(unknown)", byEvent };
    })
    .sort((a, b) => a.personName.localeCompare(b.personName));
}

export function attendanceStatusLabel(a?: Attendance): string {
  if (!a) return "—";
  if (a.attended === true) return "Attended";
  if (a.hasTicket && a.attended === false) return "No-Show";
  if (a.hasTicket) return "Ticket";
  if (a.desireToAttend === "yes") return "Desire";
  if (a.desireToAttend === "no") return "Out";
  return "Tracked";
}
