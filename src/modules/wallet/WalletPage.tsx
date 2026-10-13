import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleDollarSign, Receipt, ShieldCheck } from "lucide-react";
import {
  DateBadge,
  EmptyState,
  PageHeader,
  SectionCard,
  SegmentedBar,
  ToneChip,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  useEvents,
  useMyInvoices,
  useSharedCosts,
  type CrmEvent,
  type Invoice,
  type SharedCost,
} from "@/data";
import { fullDate, money } from "./format";
import { PaySandboxDialog, SharedCostsCard } from "@/components/costs/SharedCosts";

export function WalletPage() {
  const invoices = useMyInvoices();
  const costs = useSharedCosts();
  const events = useEvents();
  const [paying, setPaying] = useState<Invoice | null>(null);

  const costById = useMemo(() => new Map(costs.map((c) => [c.id, c])), [costs]);
  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  const owedList = invoices.filter((i) => i.status === "owed");
  const paidList = invoices.filter((i) => i.status === "paid");
  const owed = owedList.reduce((s, i) => s + i.amount, 0);
  const paid = paidList.reduce((s, i) => s + i.amount, 0);
  // Open invoices first, then most recently paid.
  const sorted = [
    ...owedList,
    ...paidList.sort((a, b) => (b.paidAt ?? "").localeCompare(a.paidAt ?? "")),
  ];

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Wallet"
        subtitle="What you owe and what you've paid for shared event costs"
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <div className="grid grid-cols-2 gap-3">
            <SummaryTile
              icon={<CircleDollarSign />}
              iconClass="bg-warn-soft text-warn-ink"
              label="You owe"
              value={money(owed)}
              meta={
                owedList.length === 0
                  ? "All settled"
                  : `${owedList.length} open ${owedList.length === 1 ? "invoice" : "invoices"}`
              }
            />
            <SummaryTile
              icon={<CircleCheck />}
              iconClass="bg-good-soft text-good"
              label="You've paid"
              value={money(paid)}
              meta={`${paidList.length} paid in the sandbox`}
            />
          </div>
          {owed + paid > 0 && (
            <SegmentedBar
              total={owed + paid}
              segments={[
                { value: paid, className: "bg-good", label: "Paid" },
                { value: owed, className: "bg-amber", label: "Owed" },
              ]}
            />
          )}

          <div className="flex items-start gap-2.5 rounded-[10px] bg-info-soft px-3 py-2.5 text-[12.5px] text-info-ink">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              Sandbox payments only. Paying marks an invoice paid with a reference; no card or bank
              details are ever asked for or stored.
            </p>
          </div>

          <SectionCard
            title="Invoices"
            action={
              invoices.length > 0 ? (
                <span className="font-semibold text-muted-foreground">{invoices.length}</span>
              ) : undefined
            }
          >
            {sorted.length === 0 ? (
              <EmptyState
                icon={<Receipt />}
                title="Nothing to pay"
                body="When you opt in to a shared cost, your share shows up here as an invoice."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {sorted.map((inv) => {
                  const cost = costById.get(inv.costId);
                  return (
                    <InvoiceCard
                      key={inv.id}
                      invoice={inv}
                      cost={cost}
                      event={cost ? eventById.get(cost.eventId) : undefined}
                      onPay={() => setPaying(inv)}
                    />
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <SharedCostsCard showPay={false} />
      </div>

      <PaySandboxDialog
        invoice={paying}
        costName={paying ? (costById.get(paying.costId)?.name ?? "Shared cost") : ""}
        onClose={() => setPaying(null)}
      />
    </div>
  );
}

function SummaryTile({
  icon,
  iconClass,
  label,
  value,
  meta,
}: {
  icon: ReactNode;
  iconClass: string;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="grid min-w-0 content-start gap-2 rounded-card border border-line bg-card px-4 py-3.5">
      <div className="flex items-center gap-2">
        <span className={`grid size-7 place-items-center rounded-lg [&_svg]:size-4 ${iconClass}`}>
          {icon}
        </span>
        <span className="text-[12.5px] font-semibold text-muted-foreground">{label}</span>
      </div>
      <div className="truncate text-[22px] font-extrabold leading-tight tabular-nums tracking-tight lg:text-[26px]">
        {value}
      </div>
      <div className="text-[11.5px] text-muted-foreground">{meta}</div>
    </div>
  );
}

function InvoiceCard({
  invoice,
  cost,
  event,
  onPay,
}: {
  invoice: Invoice;
  cost?: SharedCost;
  event?: CrmEvent;
  onPay: () => void;
}) {
  const isPaid = invoice.status === "paid";
  return (
    <article className="grid min-w-0 content-between gap-3 rounded-[12px] border border-line bg-surface p-3.5">
      <div className="flex items-start gap-3">
        {event ? <DateBadge date={event.date} /> : null}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-bold">
            {invoice.costName ?? cost?.name ?? "Shared cost"}
          </h3>
          <p className="truncate text-xs text-muted-foreground">{event?.name ?? "Event removed"}</p>
          <div className="mt-1.5">
            {isPaid ? (
              <ToneChip tone="good" icon={CircleCheck}>
                Paid
              </ToneChip>
            ) : (
              <ToneChip tone="warn">Owed</ToneChip>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right text-[17px] font-extrabold tabular-nums">
          {money(invoice.amount)}
        </div>
      </div>
      {isPaid ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold text-good">Paid (sandbox)</span>
          {invoice.paidAt && <> · {fullDate(invoice.paidAt)}</>}
          {invoice.paymentReference && (
            <>
              {" · "}
              <span className="break-all font-mono text-[11px]">{invoice.paymentReference}</span>
            </>
          )}
        </p>
      ) : (
        <Button size="sm" onClick={onPay} className="w-full">
          Pay now (sandbox)
        </Button>
      )}
    </article>
  );
}
