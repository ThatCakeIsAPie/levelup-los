import { createFileRoute } from "@tanstack/react-router";
import { useSessionStore } from "@/stores/sessionStore";
import { useOpsStore, invoicesFor } from "@/stores/opsStore";
import { useEventsStore } from "@/stores/eventsStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet")({
  head: () => ({ meta: [
    { title: "Wallet — LevelUp ERP" }, { name: "description", content: "See what you owe and what you've paid for shared event costs." },
    { property: "og:title", content: "Wallet — LevelUp ERP" }, { property: "og:description", content: "See what you owe and what you've paid for shared event costs." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: WalletPage,
});

function WalletPage() {
  const user = useSessionStore((s) => s.user)!;
  const { costs, payments, pay } = useOpsStore();
  const events = useEventsStore((s) => s.events);
  const inv = invoicesFor(costs, payments, user.personId);
  const owed = inv.filter((i) => i.status === "owed").reduce((s, i) => s + i.amount, 0);
  const paid = inv.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount, 0);
  return (
    <div className="h-full overflow-auto p-4 text-xs">
      <h1 className="mb-3 text-sm font-semibold">Wallet</h1>
      <div className="mb-4 flex gap-3"><div className="rounded border border-border p-3">You owe <b className="text-base">${owed.toFixed(2)}</b></div><div className="rounded border border-border p-3">Paid <b className="text-base">${paid.toFixed(2)}</b></div></div>
      <p className="mb-2 text-muted-foreground">Sandbox payments only — no card or bank details are ever stored.</p>
      <table className="w-full"><thead><tr className="text-left text-muted-foreground"><th className="font-normal">Cost</th><th className="font-normal">Event</th><th className="text-right font-normal">Amount</th><th className="font-normal pl-4">Status</th></tr></thead>
        <tbody>{inv.map((i) => { const c = costs.find((x) => x.id === i.costId)!; return (
          <tr key={i.id} className="border-t border-border"><td className="py-1.5">{c.name}</td><td>{events.find((e) => e.id === c.eventId)?.name}</td><td className="text-right tabular-nums">${i.amount.toFixed(2)}</td>
            <td className="pl-4">{i.status === "paid" ? <span>Paid (sandbox) {new Date(i.paidAt!).toLocaleString()} · {i.paymentReference}</span>
              : <Button size="sm" className="h-6 text-[11px]" onClick={() => { pay(i.costId, i.personId); toast.success("Paid (sandbox)"); }}>Pay now</Button>}</td></tr>); })}
          {inv.length === 0 && <tr><td colSpan={4} className="py-3 text-muted-foreground">Nothing owed. Opt in to a shared cost on an event page.</td></tr>}
        </tbody></table>
    </div>
  );
}
