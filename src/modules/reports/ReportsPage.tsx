import { useMemo, type ComponentType } from "react";
import { BookOpen, CalendarCheck, Contact, Download, Mail, Receipt } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, SectionCard, ToneChip, TONE_CLASS, type IconTone } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  lastSale,
  localDate,
  setReportSchedule,
  useCurrentUser,
  useEvents,
  useLastContactMap,
  useMyReportSchedule,
  useSales,
  useSharedCosts,
  useTeamLearning,
  useVisibleAttendances,
  useVisibleCustomers,
  useVisibleInvoices,
  useVisiblePeople,
  type Role,
} from "@/data";
import { downloadCsv, toCsv } from "@/lib/csvExport";
import { cn } from "@/lib/utils";

type Rows = Record<string, unknown>[];

interface Report {
  key: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: IconTone;
  rows: Rows;
}

const SCOPE: Record<Role, string> = {
  leader: "Exports include you and your whole team, plus only your own customers.",
  ibo: "Exports include you and your team, plus only your own customers.",
  apprentice: "Exports include you and your team, plus only your own customers.",
  candidate: "Exports include only your own records.",
};

export function ReportsPage() {
  const user = useCurrentUser();
  const reports = useReports();

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Reports"
        subtitle={`Download what you can see as CSV. ${SCOPE[user.role]}`}
      />

      <div className="grid gap-4 md:grid-cols-2">
        {reports.map((r) => (
          <ReportCard key={r.key} report={r} />
        ))}
      </div>

      <ScheduleCard ownerId={user.personId} />
    </div>
  );
}

/** Builds every report from visibility-filtered @/data hooks. */
function useReports(): Report[] {
  const people = useVisiblePeople();
  const learning = useTeamLearning();
  const customers = useVisibleCustomers();
  const lastContacts = useLastContactMap();
  const sales = useSales();
  const attendances = useVisibleAttendances();
  const events = useEvents();
  const invoices = useVisibleInvoices();
  const costs = useSharedCosts();

  return useMemo(() => {
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const name = (id?: string | null) => (id ? (nameOf.get(id) ?? id) : "");
    const eventById = new Map(events.map((e) => [e.id, e]));
    const costById = new Map(costs.map((c) => [c.id, c]));

    const activity: Rows = learning.map((l) => ({
      person: name(l.personId),
      type: l.kind,
      title: l.title,
      amount: l.amount,
      date: l.date,
    }));

    const contact: Rows = customers.map((c) => {
      const sale = lastSale(sales, c.id);
      return {
        customer: c.name,
        owner: name(c.ownerId),
        lastContact: lastContacts.get(c.id) ?? "never",
        lastProduct: sale?.product ?? "",
        lastSaleDate: sale?.date ?? "",
        monthlyVolume: c.monthlyVolume ?? "",
      };
    });

    const attendance: Rows = attendances.map((a) => {
      const e = eventById.get(a.eventId);
      return {
        person: name(a.personId),
        event: e?.name ?? "",
        eventDate: e?.date ?? "",
        ticket: a.hasTicket ? "yes" : "no",
        attended: a.attended ? "yes" : "no",
      };
    });

    const money: Rows = invoices.map((i) => {
      const c = costById.get(i.costId);
      return {
        person: name(i.personId),
        cost: i.costName ?? c?.name ?? "",
        event: c ? (eventById.get(c.eventId)?.name ?? "") : "",
        amount: i.amount,
        status: i.status,
        reference: i.paymentReference ?? "",
      };
    });

    return [
      {
        key: "activity",
        title: "Activity",
        description: "Learning logged: podcasts, pages read, workshops and conferences.",
        icon: BookOpen,
        tone: "info",
        rows: activity,
      },
      {
        key: "customer-contact",
        title: "Customer contact",
        description: "Each of your customers with their last contact and last purchase.",
        icon: Contact,
        tone: "warn",
        rows: contact,
      },
      {
        key: "event-attendance",
        title: "Event attendance",
        description: "Who was invited to each event, who had a ticket and who came.",
        icon: CalendarCheck,
        tone: "primary",
        rows: attendance,
      },
      {
        key: "owed-vs-paid",
        title: "Owed vs paid",
        description: "Shared-cost invoices with their status and sandbox payment reference.",
        icon: Receipt,
        tone: "good",
        rows: money,
      },
    ];
  }, [people, learning, customers, lastContacts, sales, attendances, events, invoices, costs]);
}

function ReportCard({ report }: { report: Report }) {
  const Icon = report.icon;
  const count = report.rows.length;
  const columns = count ? Object.keys(report.rows[0]) : [];
  return (
    <SectionCard>
      <div className="grid grid-cols-[40px_minmax(0,1fr)] gap-3">
        <span
          className={cn("grid size-10 place-items-center rounded-[10px]", TONE_CLASS[report.tone])}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold">{report.title}</h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{report.description}</p>
        </div>
      </div>
      <div className="grid gap-1 rounded-[10px] bg-surface-2 px-3 py-2.5">
        <div className="text-[13px] font-semibold tabular-nums">
          {count === 0 ? "No rows yet" : `${count} ${count === 1 ? "row" : "rows"}`}
        </div>
        {columns.length > 0 && (
          <div className="truncate text-[11.5px] text-faint" title={columns.join(", ")}>
            Columns: {columns.join(", ")}
          </div>
        )}
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={count === 0}
        className="justify-self-start"
        onClick={() => {
          downloadCsv(`${report.key}-${localDate()}.csv`, toCsv(report.rows));
          toast.success(`${report.title} downloaded`);
        }}
      >
        <Download /> Download CSV
      </Button>
    </SectionCard>
  );
}

const FREQUENCIES = [
  { value: "off", label: "Off" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
] as const;

function ScheduleCard({ ownerId }: { ownerId: string }) {
  const schedule = useMyReportSchedule();
  const current = schedule?.frequency ?? "off";

  return (
    <SectionCard>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="grid min-w-0 flex-[1_1_18rem] grid-cols-[40px_minmax(0,1fr)] gap-3">
          <span
            className={cn("grid size-10 place-items-center rounded-[10px]", TONE_CLASS.neutral)}
          >
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold">Send to my upline</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Email these reports to your upline on a schedule.
            </p>
            <div className="mt-2">
              <ToneChip tone="info">Will activate when email is connected</ToneChip>
            </div>
          </div>
        </div>
        <div
          role="group"
          aria-label="Report schedule"
          className="grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px] sm:w-fit"
        >
          {FREQUENCIES.map((f) => {
            const on = current === f.value;
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (on) return;
                  setReportSchedule(
                    f.value === "off" ? null : { ownerId, frequency: f.value },
                    ownerId,
                  );
                  toast.success(
                    f.value === "off"
                      ? "Upline reports turned off"
                      : `Upline reports set to ${f.label.toLowerCase()}`,
                  );
                }}
                className={cn(
                  "rounded-[7px] px-4 py-1.5 text-[12.5px] font-semibold text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
                  on ? "bg-surface text-foreground shadow-sm" : "hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
