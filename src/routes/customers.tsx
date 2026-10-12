import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSessionStore } from "@/stores/sessionStore";
import { visibleCustomers } from "@/lib/db";
import { useCrmStore, lastContactDate, lastSale, daysSince, today } from "@/stores/crmStore";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — LevelUp ERP" },
      { name: "description", content: "Your private customer list with purchases and last contact." },
      { property: "og:title", content: "Customers — LevelUp ERP" },
      { property: "og:description", content: "Your private customer list with purchases and last contact." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CustomersPage,
});

function CustomersPage() {
  const people = usePeopleStore((s) => s.people);
  const user = useSessionStore((s) => s.user);
  const { sales, contacts, settings, logContact } = useCrmStore();
  const customers = visibleCustomers(people, user);
  const [saleFor, setSaleFor] = useState<string | null>(null);

  if (user?.role === "candidate") {
    return <div className="p-6 text-sm text-muted-foreground">Customers become available once you start your business.</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-sm font-semibold">My customers</h1>
        <p className="text-xs text-muted-foreground">
          Private to you. Red = not contacted in over {settings.customerDays} days.
        </p>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Last product</TableHead>
            <TableHead>Bought</TableHead>
            <TableHead>Acquired</TableHead>
            <TableHead>Last contact</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {customers.map((c) => {
            const sale = lastSale(sales, c.id);
            const lc = lastContactDate(contacts, c.id);
            const age = daysSince(lc);
            const overdue = age === null || age > settings.customerDays;
            return (
              <TableRow key={c.id}>
                <TableCell>
                  <Link to="/people/$id" params={{ id: c.id }} className="font-medium hover:underline">{c.name}</Link>
                </TableCell>
                <TableCell className="text-xs">{c.phone ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.email ?? "—"}</TableCell>
                <TableCell className="text-xs">{sale?.product ?? "—"}</TableCell>
                <TableCell className="text-xs">{sale?.date ?? "—"}</TableCell>
                <TableCell className="text-xs">{c.joinedDate ?? "—"}</TableCell>
                <TableCell className={`text-xs ${overdue ? "text-destructive" : ""}`}>{lc ? `${lc} (${age}d)` : "Never"}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button size="sm" variant="outline" className="h-7" onClick={() => setSaleFor(c.id)}>Log sale</Button>
                  <Button
                    size="sm" variant="outline" className="ml-2 h-7"
                    onClick={() => { logContact({ personId: c.id, byId: user?.personId ?? "", date: today() }); toast.success(`Contact logged for ${c.name}`); }}
                  >
                    Log contact
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
          {customers.length === 0 && (
            <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">No customers yet. Add one from People or the Mindmap.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
      <SaleDialog customerId={saleFor} onClose={() => setSaleFor(null)} />
    </div>
  );
}

function SaleDialog({ customerId, onClose }: { customerId: string | null; onClose: () => void }) {
  const logSale = useCrmStore((s) => s.logSale);
  const [product, setProduct] = useState("");
  const [date, setDate] = useState(today());
  const save = () => {
    if (!customerId || !product.trim()) return;
    logSale({ customerId, product: product.trim(), date });
    toast.success("Sale logged");
    setProduct("");
    onClose();
  };
  return (
    <Dialog open={!!customerId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Log sale</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5"><Label>Product *</Label><Input value={product} onChange={(e) => setProduct(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label>Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save} disabled={!product.trim()}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
