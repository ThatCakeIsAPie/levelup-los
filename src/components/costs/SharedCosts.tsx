import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ChevronDown, CreditCard, Info, Plus, Receipt, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PersonAvatar, SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addSharedCost,
  effectiveBizClass,
  parseDate,
  paySandbox,
  setCostOverride,
  toggleCostOptIn,
  useCostOrganizerName,
  useCostSplit,
  useCurrentUser,
  useEvents,
  useMyInvoices,
  useSharedCosts,
  useUpcomingEvents,
  useVisibleInvoices,
  useVisiblePeople,
  type CrmEvent,
  type CrmPerson,
  type Invoice,
  type Role,
  type SharedCost,
} from "@/data";
import { cn } from "@/lib/utils";

/*
 * Shared event costs, used by the Wallet (every cost) and the event page's
 * Tickets and travel tab (one event). Rules:
 *  - anyone can opt in; a member who has paid can't opt out;
 *  - only the cost's organizer changes shares, and a paid share is fixed at
 *    what was paid;
 *  - only leaders and IBOs create costs (not apprentices or candidates);
 *  - the organizer is named when you can see them, else "a team leader";
 *  - other members are named only when you can see them; the rest are summed.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const money = (n: number) => usd.format(n);
const shortDate = (d: string) => format(parseDate(d), "MMM d");

const canCreateSharedCosts = (role: Role) => role === "leader" || role === "ibo";

export function SharedCostsCard({
  eventId,
  showPay = true,
}: {
  /** Only this event's costs (and new costs go to it); otherwise every cost. */
  eventId?: string;
  /** Show "Pay now" on your share (the Wallet has its own invoice list). */
  showPay?: boolean;
}) {
  const user = useCurrentUser();
  const costs = useSharedCosts(eventId);
  const events = useEvents();
  const [creating, setCreating] = useState(false);
  const canCreate = canCreateSharedCosts(user.role);

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  // Soonest event first.
  const sorted = useMemo(() => {
    const date = (c: SharedCost) => eventById.get(c.eventId)?.date ?? "";
    return [...costs].sort((a, b) => date(a).localeCompare(date(b)));
  }, [costs, eventById]);

  return (
    <SectionCard
      title="Shared costs"
      action={
        canCreate ? (
          <Button size="sm" variant="soft" onClick={() => setCreating(true)}>
            <Plus /> New shared cost
          </Button>
        ) : undefined
      }
    >
      <p className="-mt-1 text-[12.5px] text-muted-foreground">
        Split a van, hotel block or venue with the team. Opt in and your share shows up as an
        invoice in your wallet.
      </p>
      {!canCreate && (
        <p className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {user.role === "apprentice"
            ? "Apprentices can't create shared costs in their first contract year. You can still opt in and pay your share."
            : "Leaders and IBOs set up shared costs. Opt in to the ones you're part of."}
        </p>
      )}
      {sorted.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No shared costs yet"
          body={
            canCreate
              ? "Create one and your team can opt in. Each share is invoiced in the wallet."
              : "When a leader or IBO creates one, you can opt in here."
          }
        />
      ) : (
        <div className="grid gap-3">
          {sorted.map((c) => (
            <CostCard
              key={c.id}
              cost={c}
              event={eventId ? undefined : eventById.get(c.eventId)}
              showEvent={!eventId}
              showPay={showPay}
              defaultOpen={!!eventId}
            />
          ))}
        </div>
      )}
      {canCreate && <NewCostDialog eventId={eventId} open={creating} onOpenChange={setCreating} />}
    </SectionCard>
  );
}

function CostCard({
  cost: c,
  event,
  showEvent,
  showPay,
  defaultOpen,
}: {
  cost: SharedCost;
  event?: CrmEvent;
  showEvent: boolean;
  showPay: boolean;
  defaultOpen: boolean;
}) {
  const user = useCurrentUser();
  const people = useVisiblePeople();
  const invoices = useVisibleInvoices();
  const mine = useMyInvoices().find((i) => i.costId === c.id);
  const split = useCostSplit(c);
  const organizer = useCostOrganizerName(c);
  const [open, setOpen] = useState(defaultOpen);
  const [paying, setPaying] = useState<Invoice | null>(null);

  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const me = user.personId;
  const owner = c.ownerId === me;
  const member = c.members.includes(me);
  const paid = member && mine?.status === "paid";
  const nameOf = (id: string) =>
    id === me ? "You" : (personById.get(id)?.name ?? "Someone outside your team");
  // Non-organizers only see named rows for people they can see; the rest are summed.
  const known = (id: string) => owner || id === me || personById.has(id);
  const shown = c.members.filter(known);
  const hidden = c.members.filter((m) => !known(m));
  const hiddenTotal = hidden.reduce((sum, m) => sum + (split[m] ?? 0), 0);
  const statusOf = (id: string) => invoices.find((i) => i.costId === c.id && i.personId === id);
  const assigned = Object.values(split).reduce((s, v) => s + v, 0);
  const off = Math.round((c.total - assigned) * 100) / 100;

  return (
    <article className="grid gap-3 rounded-[12px] border border-line bg-surface-2/50 p-3.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-bold">{c.name}</h3>
          {showEvent && (
            <p className="truncate text-xs text-muted-foreground">
              {event ? `${event.name} · ${shortDate(event.date)}` : "Event removed"}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{money(c.total)}</span>{" "}
            total · organized by {organizer === "You" ? "you" : organizer} · split{" "}
            {c.members.length} {c.members.length === 1 ? "way" : "ways"}
          </p>
        </div>
        {paid ? (
          <ToneChip tone="good">Paid</ToneChip>
        ) : (
          <Button
            size="sm"
            variant={member ? "outline" : "default"}
            onClick={() => {
              toggleCostOptIn(c.id, me);
              toast.success(member ? `You left ${c.name}` : `You joined ${c.name}`);
            }}
          >
            {member ? "Opt out" : "Opt in"}
          </Button>
        )}
      </header>

      {member && mine && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-card px-3 py-2.5">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px]">
            {paid ? "You paid" : "Your share"} <b className="tabular-nums">{money(mine.amount)}</b>
          </span>
          {paid ? (
            <ToneChip tone="good" className="ml-auto">
              Paid (sandbox){mine.paidAt ? ` · ${shortDate(mine.paidAt)}` : ""}
            </ToneChip>
          ) : showPay ? (
            <Button size="sm" className="ml-auto" onClick={() => setPaying(mine)}>
              Pay now (sandbox)
            </Button>
          ) : (
            <span className="ml-auto text-xs text-muted-foreground">Pay it in your invoices</span>
          )}
          {mine.paymentReference && (
            <span className="w-full break-all text-[11.5px] text-faint">
              Reference {mine.paymentReference}
            </span>
          )}
          {paid && (
            <span className="w-full text-[11.5px] text-faint">
              You've paid, so you can't opt out here. Ask the organizer if plans change.
            </span>
          )}
        </div>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {owner ? "Manage split" : `Who's in (${c.members.length})`}
            <ChevronDown
              className={cn("size-3.5 transition-transform", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 grid gap-2">
          {c.members.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nobody has opted in yet.</p>
          ) : (
            <ul className="grid gap-1.5">
              {shown.map((m) => (
                <MemberRow
                  key={m}
                  cost={c}
                  personId={m}
                  name={nameOf(m)}
                  person={personById.get(m)}
                  share={split[m] ?? 0}
                  invoice={statusOf(m)}
                  editable={owner}
                />
              ))}
              {hidden.length > 0 && (
                <li className="flex items-center gap-x-2.5 text-[13px] text-muted-foreground">
                  <span className="inline-grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-bold">
                    +{hidden.length}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {hidden.length === 1 ? "1 person" : `${hidden.length} people`} outside your team
                  </span>
                  <b className="w-20 text-right tabular-nums text-foreground">
                    {money(hiddenTotal)}
                  </b>
                </li>
              )}
            </ul>
          )}
          {owner && c.members.length > 0 && (
            <p className={cn("text-[11.5px]", off !== 0 ? "text-warn-ink" : "text-faint")}>
              {off !== 0
                ? `The shares add up to ${money(assigned)}, ${money(Math.abs(off))} ${off > 0 ? "less" : "more"} than the total. Adjust a share so they match.`
                : "Shares split evenly by default. Change anyone's amount and the rest split what's left. Paid shares stay as paid."}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>

      <PaySandboxDialog invoice={paying} costName={c.name} onClose={() => setPaying(null)} />
    </article>
  );
}

function MemberRow({
  cost,
  personId,
  name,
  person,
  share,
  invoice,
  editable,
}: {
  cost: SharedCost;
  personId: string;
  name: string;
  person?: CrmPerson;
  share: number;
  invoice?: Invoice;
  editable: boolean;
}) {
  const paid = invoice?.status === "paid";
  const custom = personId in cost.overrides && !paid;
  return (
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
      <PersonAvatar
        name={person?.name ?? name}
        stage={person ? effectiveBizClass(person) : undefined}
        size="sm"
      />
      <span className="min-w-0 flex-1 truncate">
        {name}
        {custom && <span className="ml-1.5 text-[11px] text-faint">custom</span>}
      </span>
      {invoice && <ToneChip tone={paid ? "good" : "warn"}>{paid ? "Paid" : "Owes"}</ToneChip>}
      {editable && !paid ? (
        <span className="flex items-center gap-1">
          <ShareInput
            value={share}
            label={`Share for ${name}`}
            onCommit={(v) => setCostOverride(cost.id, personId, v)}
          />
          {custom ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Reset ${name} to an even share`}
              onClick={() => setCostOverride(cost.id, personId, null)}
            >
              <RotateCcw />
            </Button>
          ) : (
            <span className="size-8" />
          )}
        </span>
      ) : (
        <b className="w-20 text-right tabular-nums">{money(invoice?.amount ?? share)}</b>
      )}
    </li>
  );
}

/** Amount field that saves on blur or Enter (empty clears the override). */
function ShareInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  // Follow the stored share when it changes (e.g. another member's override).
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(String(value));
  }
  const commit = () => {
    const t = draft.trim();
    if (t === "") return onCommit(null);
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(Math.round(n * 100) / 100);
  };
  return (
    <Input
      type="number"
      inputMode="decimal"
      min={0}
      step="0.01"
      aria-label={label}
      className="h-8 w-24 text-right tabular-nums"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
    />
  );
}

/** Confirmation for a sandbox payment (no card is charged, nothing is collected). */
export function PaySandboxDialog({
  invoice,
  costName,
  onClose,
}: {
  invoice: Invoice | null;
  costName: string;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Pay {invoice ? money(invoice.amount) : ""} for {costName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This is a sandbox payment. No card is charged and no payment details are collected. The
            invoice is marked paid with a sandbox reference you can see in your wallet and in
            reports. Once paid, your share stays at this amount.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!invoice) return;
              paySandbox(invoice.costId, invoice.personId);
              toast.success(`Paid ${money(invoice.amount)} (sandbox): ${costName}`, {
                description: "No card was charged.",
              });
            }}
          >
            Mark as paid
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function NewCostDialog({
  eventId,
  open,
  onOpenChange,
}: {
  /** Fixed event (event page); otherwise pick an upcoming event. */
  eventId?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const user = useCurrentUser();
  const upcoming = useUpcomingEvents();
  const [picked, setPicked] = useState("");
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const selected = eventId ?? (picked || upcoming[0]?.id || "");
  const amount = Number(total);
  const valid = !!selected && name.trim() !== "" && Number.isFinite(amount) && amount > 0;
  const reset = () => {
    setName("");
    setTotal("");
    setPicked("");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-card">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            addSharedCost({
              eventId: selected,
              name: name.trim(),
              total: amount,
              ownerId: user.personId,
            });
            toast.success(`${name.trim()} created. You're opted in as the organizer.`);
            onOpenChange(false);
            reset();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>New shared cost</DialogTitle>
            <DialogDescription>
              People opt in and the total splits evenly. You can change anyone's share later.
            </DialogDescription>
          </DialogHeader>
          {!eventId &&
            (upcoming.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">
                Shared costs are created for upcoming events. Add an event first.
              </p>
            ) : (
              <div className="grid gap-1.5">
                <Label htmlFor="sc-event">Event</Label>
                <select
                  id="sc-event"
                  value={selected}
                  onChange={(e) => setPicked(e.target.value)}
                  className="h-9 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  {upcoming.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {shortDate(e.date)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          <div className="grid gap-1.5">
            <Label htmlFor="sc-name">What it's for</Label>
            <Input
              id="sc-name"
              autoFocus
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hotel block"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sc-total">Total ($)</Label>
            <Input
              id="sc-total"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              placeholder="600"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
