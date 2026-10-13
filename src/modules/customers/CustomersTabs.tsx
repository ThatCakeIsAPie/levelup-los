import { cn } from "@/lib/utils";
import { useNotContactedCount, useVisibleCustomers } from "@/data";

export type CustomersTab = "pipeline" | "list" | "customers";

const TABS: { value: CustomersTab; label: string }[] = [
  { value: "pipeline", label: "Pipeline" },
  { value: "list", label: "Your list" },
  { value: "customers", label: "Customers" },
];

/**
 * Pipeline / Your list / Customers. A segmented control on phones, underlined
 * tabs from the small breakpoint up (as on the Pipeline page).
 */
export function CustomersTabs({
  tab,
  onTab,
}: {
  tab: CustomersTab;
  onTab: (tab: CustomersTab) => void;
}) {
  const notContacted = useNotContactedCount();
  const customers = useVisibleCustomers().length;
  const count: Partial<Record<CustomersTab, { n: number; label: string }>> = {
    list: { n: notContacted, label: "not contacted yet" },
    customers: { n: customers, label: customers === 1 ? "customer" : "customers" },
  };
  return (
    <div
      role="tablist"
      aria-label="Customers views"
      className="flex gap-1 rounded-xl bg-surface-2 p-1 sm:rounded-none sm:border-b sm:border-line sm:bg-transparent sm:p-0"
    >
      {TABS.map((t) => {
        const on = tab === t.value;
        const c = count[t.value];
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onTab(t.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              "sm:-mb-px sm:flex-none sm:rounded-none sm:border-b-2 sm:px-3 sm:py-2",
              on
                ? "bg-surface text-foreground shadow-sm sm:border-primary sm:bg-transparent sm:shadow-none"
                : "text-muted-foreground hover:text-foreground sm:border-transparent",
            )}
          >
            {t.label}
            {c && c.n > 0 && (
              <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-bold tabular-nums text-primary-ink">
                {c.n}
                <span className="sr-only"> {c.label}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
