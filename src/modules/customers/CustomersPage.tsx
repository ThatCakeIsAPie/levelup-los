import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { Check, Contact, Mail, Phone, Plus, Receipt, Search, X } from "lucide-react";
import { quickCheckIn } from "@/components/log/quickLog";
import {
  EmptyState,
  PageHeader,
  PersonAvatar,
  SectionCard,
  StatStrip,
  ToneChip,
  useIsDesktop,
  type Tone,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  daysSince,
  lastSale,
  openLog,
  useContactSettings,
  useCurrentUser,
  useLastContactMap,
  useSales,
  useVisibleCustomers,
  type CrmPerson,
  type Sale,
} from "@/data";
import { cn } from "@/lib/utils";
import { AddCustomerDialog } from "./AddCustomerDialog";
import { CustomerPipelineTab } from "./CustomerPipelineTab";
import { CustomersTabs, type CustomersTab } from "./CustomersTabs";
import { YourListTab } from "./YourListTab";
import { dayWord, money0, shortDate } from "./format";

export type { CustomersTab };

type Filter = "all" | "due";

interface Row {
  person: CrmPerson;
  sale?: Sale;
  lastContact?: string;
  age: number | null;
  due: boolean;
}

/**
 * Customers: the customer pipeline (default), your list, and your private
 * customer list, as tabs. Candidates get an explanation instead.
 */
export function CustomersPage({
  tab,
  owner,
  onTab,
}: {
  tab: CustomersTab;
  /** Your list: whose list (default yours). */
  owner?: string;
  onTab: (tab: CustomersTab, owner?: string) => void;
}) {
  const user = useCurrentUser();
  if (user.role === "candidate") return <CandidateCustomers />;
  const tabs = <CustomersTabs tab={tab} onTab={(t) => onTab(t)} />;
  if (tab === "pipeline") return <CustomerPipelineTab tabs={tabs} />;
  if (tab === "list")
    return (
      <YourListTab
        tabs={tabs}
        ownerId={owner ?? user.personId}
        onOwner={(id) => onTab("list", id === user.personId ? undefined : id)}
      />
    );
  return <OwnerCustomers ownerId={user.personId} tabs={tabs} />;
}

function CandidateCustomers() {
  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader title="Customers" subtitle="People who buy products through you" />
      <EmptyState
        icon={<Contact />}
        title="Customers come with your own business"
        body="Customers belong to IBOs and apprentices. Once you start your business, the people who buy from you are listed here, private to you."
      />
    </div>
  );
}

function OwnerCustomers({ ownerId, tabs }: { ownerId: string; tabs: ReactNode }) {
  const desktop = useIsDesktop();
  const customers = useVisibleCustomers();
  const sales = useSales();
  const lastContacts = useLastContactMap();
  const { customerDays } = useContactSettings();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [adding, setAdding] = useState(false);

  const rows = useMemo<Row[]>(
    () =>
      customers.map((person) => {
        const lc = lastContacts.get(person.id);
        const age = daysSince(lc);
        return {
          person,
          sale: lastSale(sales, person.id),
          lastContact: lc,
          age,
          due: age === null || age > customerDays,
        };
      }),
    [customers, sales, lastContacts, customerDays],
  );

  const thisMonth = format(new Date(), "yyyy-MM");
  const ids = useMemo(() => new Set(customers.map((c) => c.id)), [customers]);
  const salesThisMonth = sales.filter((s) => ids.has(s.customerId) && s.date.startsWith(thisMonth));
  const totalVolume = customers.reduce((sum, c) => sum + (c.monthlyVolume ?? 0), 0);
  const dueCount = rows.filter((r) => r.due).length;

  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      (filter === "all" || r.due) &&
      (!q ||
        r.person.name.toLowerCase().includes(q) ||
        r.sale?.product.toLowerCase().includes(q) ||
        r.person.email?.toLowerCase().includes(q) ||
        r.person.phone?.includes(q)),
  );

  const addButton = (
    <Button onClick={() => setAdding(true)} variant={customers.length ? "outline" : "default"}>
      <Plus /> Add customer
    </Button>
  );

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Customers"
        subtitle={`Private to you · due for contact after ${customerDays} days`}
        actions={addButton}
      />
      {tabs}

      {customers.length === 0 ? (
        <EmptyState
          icon={<Contact />}
          title="No customers yet"
          body="Add the people who buy from you to keep track of what they bought and when you last talked."
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add customer
            </Button>
          }
        />
      ) : (
        <>
          <StatStrip
            items={[
              { value: customers.length, label: customers.length === 1 ? "Customer" : "Customers" },
              { value: `${money0(totalVolume)}/mo`, label: "Total monthly volume" },
              { value: dueCount, label: "Due for contact" },
              { value: salesThisMonth.length, label: "Sales this month" },
            ]}
          />

          <SectionCard>
            <Toolbar
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
              total={rows.length}
              dueCount={dueCount}
            />
            {shown.length === 0 ? (
              <NoMatches
                filter={filter}
                query={query}
                customerDays={customerDays}
                onClear={() => {
                  setQuery("");
                  setFilter("all");
                }}
              />
            ) : desktop ? (
              <CustomerTable rows={shown} customerDays={customerDays} />
            ) : (
              <CustomerList rows={shown} customerDays={customerDays} />
            )}
          </SectionCard>
        </>
      )}

      <AddCustomerDialog open={adding} onOpenChange={setAdding} ownerId={ownerId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  total,
  dueCount,
}: {
  query: string;
  onQuery: (q: string) => void;
  filter: Filter;
  onFilter: (f: Filter) => void;
  total: number;
  dueCount: number;
}) {
  const pills: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: total },
    { value: "due", label: "Due for contact", count: dueCount },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <div className="relative min-w-0 flex-[1_1_14rem] sm:max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search name, product, email"
          aria-label="Search customers"
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter customers">
        {pills.map((p) => {
          const on = filter === p.value;
          return (
            <button
              key={p.value}
              type="button"
              aria-pressed={on}
              onClick={() => onFilter(p.value)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                on
                  ? "border-foreground bg-foreground text-background"
                  : "border-line text-muted-foreground hover:bg-surface-2",
              )}
            >
              {p.label} <span className="tabular-nums">{p.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NoMatches({
  filter,
  query,
  customerDays,
  onClear,
}: {
  filter: Filter;
  query: string;
  customerDays: number;
  onClear: () => void;
}) {
  if (filter === "due" && !query.trim()) {
    return (
      <EmptyState
        icon={<Check />}
        title="Everyone is up to date"
        body={`No customer has gone more than ${customerDays} days without contact.`}
      />
    );
  }
  return (
    <EmptyState
      icon={<Search />}
      title="No customers match"
      body="Try a different name or product, or clear the filters."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          <X /> Clear filters
        </Button>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function contactTone(age: number | null, threshold: number): Tone {
  if (age === null) return "bad";
  if (age > threshold * 1.5) return "bad";
  if (age > threshold) return "warn";
  return "neutral";
}

function LastContactChip({ row, customerDays }: { row: Row; customerDays: number }) {
  const tone = contactTone(row.age, customerDays);
  const label =
    row.age === null ? "Never" : row.age === 0 ? "Today" : `${row.age} ${dayWord(row.age)} ago`;
  return (
    <ToneChip
      tone={tone}
      className={tone === "neutral" ? "bg-transparent px-0 font-semibold" : undefined}
    >
      {label}
    </ToneChip>
  );
}

function NameLink({ person }: { person: CrmPerson }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Link
        to="/people/$id"
        params={{ id: person.id }}
        className="block truncate rounded-sm text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {person.name}
      </Link>
      {person.dittoSince && (
        <ToneChip tone="good" className="shrink-0">
          On Ditto
        </ToneChip>
      )}
    </span>
  );
}

function ContactLinks({ person }: { person: CrmPerson }) {
  if (!person.phone && !person.email) return null;
  const linkCls =
    "inline-flex min-w-0 items-center gap-1 rounded-sm hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
      {person.phone && (
        <a href={`tel:${person.phone}`} className={linkCls}>
          <Phone className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{person.phone}</span>
        </a>
      )}
      {person.email && (
        <a href={`mailto:${person.email}`} className={cn(linkCls, "max-w-full")}>
          <Mail className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{person.email}</span>
        </a>
      )}
    </div>
  );
}

function RowActions({ person, compact }: { person: CrmPerson; compact?: boolean }) {
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => openLog({ tab: "sale", personId: person.id })}
        className={compact ? "w-full" : undefined}
      >
        <Receipt /> Log sale
      </Button>
      <Button
        size="sm"
        variant="soft"
        onClick={() => quickCheckIn(person.id, `Contact logged for ${person.name}`)}
        className={compact ? "w-full" : undefined}
      >
        <Check /> Log contact
      </Button>
    </>
  );
}

function SaleSummary({ sale }: { sale?: Sale }) {
  if (!sale) return <span className="text-faint">No sales yet</span>;
  return (
    <>
      <span className="block truncate text-foreground">{sale.product}</span>
      <span className="text-muted-foreground">{shortDate(sale.date)}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Desktop table
// ---------------------------------------------------------------------------

function CustomerTable({ rows, customerDays }: { rows: Row[]; customerDays: number }) {
  const th = "pb-2 text-left text-[11.5px] font-semibold text-muted-foreground";
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-[18px] sm:px-[18px]">
      <table className="w-full min-w-[820px] text-[13px]">
        <thead>
          <tr>
            <th className={th}>Customer</th>
            <th className={th}>Last sale</th>
            <th className={cn(th, "text-right")}>Monthly</th>
            <th className={cn(th, "pl-6")}>Acquired</th>
            <th className={th}>Last contact</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.person.id} className="border-t border-line align-middle">
              <td className="py-2.5 pr-4">
                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar name={r.person.name} stage="customer" />
                  <div className="min-w-0 max-w-[16rem]">
                    <NameLink person={r.person} />
                    <ContactLinks person={r.person} />
                  </div>
                </div>
              </td>
              <td className="max-w-[14rem] py-2.5 pr-4 text-xs">
                <SaleSummary sale={r.sale} />
              </td>
              <td className="py-2.5 text-right font-semibold tabular-nums">
                {r.person.monthlyVolume != null ? (
                  `${money0(r.person.monthlyVolume)}`
                ) : (
                  <span className="text-faint">—</span>
                )}
              </td>
              <td className="py-2.5 pl-6 pr-4 text-xs text-muted-foreground">
                {r.person.joinedDate ? shortDate(r.person.joinedDate) : "—"}
              </td>
              <td className="py-2.5 pr-4 text-xs">
                <LastContactChip row={r} customerDays={customerDays} />
                {r.lastContact && r.age !== 0 && (
                  <span className="block text-[11px] text-faint">{shortDate(r.lastContact)}</span>
                )}
              </td>
              <td className="py-2.5">
                <div className="flex justify-end gap-2">
                  <RowActions person={r.person} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phone card list
// ---------------------------------------------------------------------------

function CustomerList({ rows, customerDays }: { rows: Row[]; customerDays: number }) {
  return (
    <ul className="grid">
      {rows.map((r) => (
        <li
          key={r.person.id}
          className="grid gap-2.5 border-t border-line py-3 first:border-t-0 first:pt-0.5"
        >
          <div className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3">
            <PersonAvatar name={r.person.name} stage="customer" />
            <div className="min-w-0">
              <NameLink person={r.person} />
              <div className="mt-0.5 text-xs text-muted-foreground">
                {r.sale ? (
                  <>
                    <span className="text-foreground">{r.sale.product}</span> ·{" "}
                    {shortDate(r.sale.date)}
                  </>
                ) : (
                  <span className="text-faint">No sales yet</span>
                )}
              </div>
              <ContactLinks person={r.person} />
            </div>
            <div className="text-right">
              <div className="text-[13px] font-bold tabular-nums">
                {r.person.monthlyVolume != null ? `${money0(r.person.monthlyVolume)}/mo` : "—"}
              </div>
              {r.person.joinedDate && (
                <div className="text-[11px] text-faint">Since {shortDate(r.person.joinedDate)}</div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            Last contact <LastContactChip row={r} customerDays={customerDays} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <RowActions person={r.person} compact />
          </div>
        </li>
      ))}
    </ul>
  );
}
