import { createFileRoute } from "@tanstack/react-router";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useAttendanceStore } from "@/stores/attendanceStore";
import { useEventsStore } from "@/stores/eventsStore";
import { useCrmStore, lastContactDate } from "@/stores/crmStore";
import { useOpsStore, invoicesFor } from "@/stores/opsStore";
import { visiblePeople, visibleCustomers } from "@/lib/db";
import { toCsv, downloadCsv } from "@/lib/csvExport";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [
    { title: "Reports — LevelUp ERP" }, { name: "description", content: "Download activity, contact, attendance, and payment reports as CSV." },
    { property: "og:title", content: "Reports — LevelUp ERP" }, { property: "og:description", content: "Download activity, contact, attendance, and payment reports as CSV." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ReportsPage,
});

function ReportsPage() {
  const user = useSessionStore((s) => s.user)!;
  const people = usePeopleStore((s) => s.people);
  const att = useAttendanceStore((s) => s.attendances);
  const events = useEventsStore((s) => s.events);
  const { learning, contacts } = useCrmStore();
  const { costs, payments, schedules, setSchedule } = useOpsStore();
  const vis = visiblePeople(people, user);
  const ids = new Set(vis.map((p) => p.id));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const reports: [string, () => Record<string, unknown>[]][] = [
    ["Activity", () => learning.filter((l) => ids.has(l.personId)).map((l) => ({ person: nameOf(l.personId), type: l.kind, title: l.title, amount: l.amount, date: l.date }))],
    ["Customer contact", () => visibleCustomers(people, user).map((c) => ({ customer: c.name, owner: nameOf(c.ownerId ?? ""), lastContact: lastContactDate(contacts, c.id) ?? "never" }))],
    ["Event attendance", () => att.filter((a) => ids.has(a.personId)).map((a) => ({ person: nameOf(a.personId), event: events.find((e) => e.id === a.eventId)?.name, attended: a.attended ? "yes" : "no" }))],
    ["Owed vs paid", () => invoicesFor(costs, payments).filter((i) => ids.has(i.personId)).map((i) => ({ person: nameOf(i.personId), cost: costs.find((c) => c.id === i.costId)?.name, amount: i.amount, status: i.status, reference: i.paymentReference ?? "" }))],
  ];
  const sch = schedules.find((s) => s.ownerId === user.personId);
  return (
    <div className="h-full overflow-auto p-4 text-xs">
      <h1 className="mb-3 text-sm font-semibold">Reports</h1>
      <div className="mb-4 grid max-w-md gap-2">{reports.map(([n, rows]) => (
        <div key={n} className="flex items-center justify-between rounded border border-border p-2"><span>{n}</span>
          <Button size="sm" variant="outline" className="h-6 text-[11px]" onClick={() => downloadCsv(`${n.toLowerCase().replace(/ /g, "-")}.csv`, toCsv(rows()))}>Download CSV</Button></div>))}
      </div>
      <div className="max-w-md rounded border border-border p-3">
        <div className="mb-2 font-semibold">Send to my upline</div>
        <select className="h-8 rounded border border-input bg-background px-2" value={sch?.frequency ?? "off"} onChange={(e) => setSchedule(e.target.value === "off" ? null : { ownerId: user.personId, frequency: e.target.value as "weekly" | "monthly" }, user.personId)}>
          <option value="off">Off</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
        <p className="mt-2 text-muted-foreground">Will activate when email is connected.</p>
      </div>
    </div>
  );
}
