import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Lock, Pencil, Plus, ShoppingBag, Trash2, UserPlus } from "lucide-react";
import {
  addPerson,
  daysSince,
  effectiveBizClass,
  lastSale,
  localDate,
  removePerson,
  updatePerson,
  useContactSettings,
  useCurrentUser,
  useCustomerCounts,
  useCustomersOf,
  useLastContactMap,
  useSales,
  type CrmPerson,
} from "@/data";
import { EmptyState, PersonAvatar, PhoneInput, SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { daysLabel, firstName, fmtMoney } from "./format";

/**
 * Who may see/manage this person's customers. Customers are private to their
 * owner, so only the owner (viewing their own profile) sees names.
 */
function useCustomerAccess(person: CrmPerson) {
  const me = useCurrentUser();
  const counts = useCustomerCounts();
  const stage = effectiveBizClass(person);
  const canHave = stage === "apprentice" || stage === "ibo";
  const isOwn = me.personId === person.id && me.role !== "candidate";
  return { canHave, isOwn, count: counts[person.id] ?? 0 };
}

function LastContactChip({ id }: { id: string }) {
  const map = useLastContactMap();
  const { customerDays } = useContactSettings();
  const d = daysSince(map.get(id));
  return (
    <ToneChip tone={d === null || d > customerDays ? "warn" : "neutral"}>
      {d === null ? "No contact yet" : daysLabel(d)}
    </ToneChip>
  );
}

/** Overview side card: top 3 customers (own profile) or just the count. */
export function CustomersCard({
  person,
  onOpenTab,
}: {
  person: CrmPerson;
  onOpenTab: (add?: boolean) => void;
}) {
  const { canHave, isOwn, count } = useCustomerAccess(person);
  const customers = useCustomersOf(person.id);
  const sales = useSales();
  if (!canHave && count === 0) return null;

  const link = (label: string, add?: boolean) => (
    <button
      type="button"
      onClick={() => onOpenTab(add)}
      className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {label}
    </button>
  );

  if (!isOwn) {
    return (
      <SectionCard title="Customers">
        <p className="text-[12.5px] text-muted-foreground">
          {count === 0
            ? `${firstName(person.name)} has no customers yet.`
            : `${firstName(person.name)} has ${count} ${count === 1 ? "customer" : "customers"}. Customer details are private to the person who owns them.`}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Customers" action={customers.length ? link("Add", true) : undefined}>
      {customers.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title="No customers yet"
          action={
            <Button size="sm" variant="soft" onClick={() => onOpenTab(true)}>
              <Plus /> Add customer
            </Button>
          }
        />
      ) : (
        <div className="grid gap-2.5">
          {customers.slice(0, 3).map((c) => {
            const last = lastSale(sales, c.id);
            return (
              <div
                key={c.id}
                className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2.5 text-[13px]"
              >
                <PersonAvatar name={c.name} stage="customer" />
                <div className="min-w-0">
                  <Link
                    to="/people/$id"
                    params={{ id: c.id }}
                    className="block truncate rounded-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {c.name}
                  </Link>
                  <p className="truncate text-[11.5px] text-faint">
                    {[last?.product, c.monthlyVolume ? `${fmtMoney(c.monthlyVolume)}/mo` : ""]
                      .filter(Boolean)
                      .join(" · ") || "No purchases yet"}
                  </p>
                </div>
                <LastContactChip id={c.id} />
              </div>
            );
          })}
          {customers.length > 3 && link(`All ${customers.length} customers`)}
        </div>
      )}
    </SectionCard>
  );
}

/** Customers tab: list, add, edit and remove the viewer's own customers. */
export function CustomersTab({
  person,
  addOpen,
  setAddOpen,
}: {
  person: CrmPerson;
  addOpen: boolean;
  setAddOpen: (o: boolean) => void;
}) {
  const { canHave, isOwn, count } = useCustomerAccess(person);
  const customers = useCustomersOf(person.id);
  const sales = useSales();
  const [editing, setEditing] = useState<CrmPerson | null>(null);
  const [removing, setRemoving] = useState<CrmPerson | null>(null);
  const total = useMemo(
    () => customers.reduce((s, c) => s + (c.monthlyVolume ?? 0), 0),
    [customers],
  );
  const name = firstName(person.name);

  if (!canHave && count === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title="No customers on the prospect path"
        body={`Customers belong to an apprentice or IBO. Once ${name} starts a business, their customers will show up here.`}
      />
    );
  }

  if (!isOwn) {
    return (
      <EmptyState
        icon={<Lock />}
        title={
          count === 0
            ? `${name} has no customers yet`
            : `${name} has ${count} ${count === 1 ? "customer" : "customers"}`
        }
        body="Customer names and purchases are private to the person who owns them, so only the count is shown here."
      />
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted-foreground">
          {customers.length === 0
            ? "Only you can see your customers."
            : `${customers.length} ${customers.length === 1 ? "customer" : "customers"} · ${fmtMoney(total)} a month. Only you can see them.`}
        </p>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus /> Add customer
        </Button>
      </div>

      {customers.length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title="No customers yet"
          body="Add the people who buy products from you to track their orders and when you last spoke."
        />
      ) : (
        <SectionCard>
          <div>
            {customers.map((c) => {
              const last = lastSale(sales, c.id);
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <PersonAvatar name={c.name} stage="customer" />
                  <div className="min-w-0">
                    <Link
                      to="/people/$id"
                      params={{ id: c.id }}
                      className="block truncate rounded-sm text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <LastContactChip id={c.id} />
                      {c.monthlyVolume ? <span>{fmtMoney(c.monthlyVolume)}/mo</span> : null}
                      {last && <span className="truncate">Last bought {last.product}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => setEditing(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive hover:text-destructive"
                      onClick={() => setRemoving(c)}
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      <CustomerDialog open={addOpen} onOpenChange={setAddOpen} ownerId={person.id} />
      <CustomerDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        ownerId={person.id}
        customer={editing ?? undefined}
      />
      <AlertDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They'll be removed from your customers along with their contact details. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing) {
                  removePerson(removing.id);
                  toast.success(`Removed ${removing.name}`);
                }
                setRemoving(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Add or edit a customer owned by `ownerId`. */
function CustomerDialog({
  open,
  onOpenChange,
  ownerId,
  customer,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ownerId: string;
  customer?: CrmPerson;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card sm:max-w-lg">
        {open && (
          <CustomerForm
            key={customer?.id ?? "new"}
            ownerId={ownerId}
            customer={customer}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CustomerForm({
  ownerId,
  customer,
  onDone,
}: {
  ownerId: string;
  customer?: CrmPerson;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: customer?.name ?? "",
    email: customer?.email ?? "",
    phone: customer?.phone ?? "",
    location: customer?.location ?? "",
    monthlyVolume: customer?.monthlyVolume?.toString() ?? "",
    joinedDate: customer?.joinedDate ?? localDate(),
    notes: customer?.notes ?? "",
  });
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = f.name.trim();
    if (!name) return;
    const vol = Number(f.monthlyVolume);
    const data = {
      name,
      email: f.email.trim() || undefined,
      phone: f.phone.trim() || undefined,
      location: f.location.trim() || undefined,
      monthlyVolume: f.monthlyVolume.trim() && Number.isFinite(vol) ? vol : undefined,
      joinedDate: f.joinedDate || undefined,
      notes: f.notes.trim() || undefined,
    };
    if (customer) {
      updatePerson(customer.id, data);
      toast.success(`Saved ${name}`);
    } else {
      addPerson({ ...data, bizClass: "customer", ownerId, sponsorId: null });
      toast.success(`Added ${name} to your customers`);
    }
    onDone();
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{customer ? `Edit ${customer.name}` : "Add customer"}</DialogTitle>
        <DialogDescription>Only you can see your customers.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <F label="Name" id="cust-name" className="sm:col-span-2">
          <Input id="cust-name" value={f.name} onChange={set("name")} required autoFocus />
        </F>
        <F label="Phone" id="cust-phone">
          <PhoneInput
            id="cust-phone"
            value={f.phone}
            onValueChange={(phone) => setF((s) => ({ ...s, phone }))}
          />
        </F>
        <F label="Email" id="cust-email">
          <Input id="cust-email" type="email" value={f.email} onChange={set("email")} />
        </F>
        <F label="Location" id="cust-loc">
          <Input
            id="cust-loc"
            value={f.location}
            onChange={set("location")}
            placeholder="City, State"
          />
        </F>
        <F label="Monthly volume ($)" id="cust-vol">
          <Input
            id="cust-vol"
            type="number"
            min={0}
            inputMode="decimal"
            value={f.monthlyVolume}
            onChange={set("monthlyVolume")}
          />
        </F>
        <F label="Customer since" id="cust-since">
          <Input id="cust-since" type="date" value={f.joinedDate} onChange={set("joinedDate")} />
        </F>
        <F label="Notes" id="cust-notes" className="sm:col-span-2">
          <Textarea id="cust-notes" rows={3} value={f.notes} onChange={set("notes")} />
        </F>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!f.name.trim()}>
          {customer ? "Save" : "Add customer"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function F({
  label,
  id,
  className,
  children,
}: {
  label: string;
  id: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
