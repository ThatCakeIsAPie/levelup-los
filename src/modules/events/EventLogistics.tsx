import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Bus, Car, CreditCard, Pencil, Plane, Plus, Receipt, Info } from "lucide-react";
import { toast } from "sonner";
import {
  EmptyState,
  PersonAvatar,
  SectionCard,
  StatStrip,
  ToneChip,
  type Tone,
} from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  setLogistics,
  splitCost,
  toggleCostOptIn,
  updateAttendance,
  useCurrentUser,
  useLogistics,
  useSharedCosts,
  useVisibleInvoices,
  useMyInvoices,
  type Attendance,
  type CrmEvent,
  type Logistics,
  type SharedCost,
} from "@/data";
import { usePeopleMap } from "./hooks";
import { shortDate, ticketStatus } from "./lib";
import { Segmented } from "./Segmented";

const CARPOOL_LABEL: Record<Logistics["carpool"], string> = {
  teammate: "Carpool with a teammate",
  other_team: "Carpool with another team",
  solo: "Going solo",
  van: "Van or bus with the organizer",
};

const money = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  });

/**
 * Tickets and travel tab: per-attendee travel plans (ticket status comes from
 * the attendance row), plus shared costs with opt-in, per-person overrides and
 * sandbox payments. Tickets are tracked here, never sold.
 */
export function EventLogistics({ event, rows }: { event: CrmEvent; rows: Attendance[] }) {
  const user = useCurrentUser();
  const people = usePeopleMap();
  const plans = useLogistics(event.id);
  const [editing, setEditing] = useState<Attendance | null>(null);

  const ordered = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.personId === user.personId) return -1;
        if (b.personId === user.personId) return 1;
        return (people.get(a.personId)?.name ?? "").localeCompare(
          people.get(b.personId)?.name ?? "",
        );
      }),
    [rows, people, user.personId],
  );

  const withPlan = rows.filter((a) => plans[a.personId]);
  const flying = withPlan.filter((a) => plans[a.personId].mode === "fly");
  const booked = flying.filter((a) => plans[a.personId].flightBooked).length;
  const van = withPlan.filter((a) => plans[a.personId].carpool === "van");
  const vanPaid = van.filter((a) => plans[a.personId].vanPaid === "yes").length;
  const canEdit = (personId: string) => personId === user.personId || user.role === "leader";

  return (
    <div className="grid gap-4">
      {rows.length > 0 && user.role !== "candidate" && (
        <StatStrip
          items={[
            {
              value: `${rows.filter((a) => a.hasTicket).length} of ${rows.length}`,
              label: "Tickets bought",
            },
            { value: `${withPlan.length} of ${rows.length}`, label: "Travel plans in" },
            { value: `${flying.length} · ${booked} booked`, label: "Flying" },
            { value: `${van.length} · ${vanPaid} paid`, label: "Van or bus seats" },
          ]}
        />
      )}

      <SectionCard
        title="Travel plans"
        action={
          <span className="font-normal text-muted-foreground">
            {user.role === "leader"
              ? "You can update anyone's plan"
              : "You can update your own plan"}
          </span>
        }
      >
        <p className="-mt-1 flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Tickets are only tracked here, never sold. Everyone keeps their own plan up to date.
        </p>
        {ordered.length === 0 ? (
          <EmptyState
            icon={<Plane />}
            title="No travel plans yet"
            body="Once people are on this event, their ticket and travel plans show up here."
          />
        ) : (
          <ul>
            {ordered.map((a) => {
              const p = people.get(a.personId);
              const plan = plans[a.personId];
              const ts = ticketStatus(a);
              const editable = canEdit(a.personId);
              const name = p?.name ?? "Unknown person";
              return (
                <li
                  key={a.id}
                  className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 border-t border-line py-3 first:border-t-0 first:pt-1"
                >
                  <PersonAvatar name={name} stage={p ? effectiveBizClass(p) : undefined} />
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">
                      {name}
                      {a.personId === user.personId && (
                        <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <ToneChip tone={ts.tone}>
                        {a.hasTicket ? `Ticket: ${ts.label}` : ts.label}
                      </ToneChip>
                      {plan ? (
                        <>
                          <ToneChip tone="neutral" icon={plan.mode === "fly" ? Plane : Car}>
                            {plan.mode === "fly" ? "Flying" : "Driving"}
                          </ToneChip>
                          {plan.mode === "fly" && (
                            <ToneChip tone={plan.flightBooked ? "good" : "warn"}>
                              {plan.flightBooked ? "Flight booked" : "Flight not booked"}
                            </ToneChip>
                          )}
                          <ToneChip tone="neutral" icon={plan.carpool === "van" ? Bus : undefined}>
                            {CARPOOL_LABEL[plan.carpool]}
                          </ToneChip>
                          {plan.carpool === "van" && <VanChip plan={plan} />}
                        </>
                      ) : (
                        <span className="text-xs text-faint">No travel plan yet</span>
                      )}
                    </div>
                  </div>
                  {editable ? (
                    <Button
                      size="sm"
                      variant={!plan && a.personId === user.personId ? "soft" : "outline"}
                      onClick={() => setEditing(a)}
                      aria-label={`${plan ? "Edit" : "Add"} travel plan for ${name}`}
                    >
                      {plan ? <Pencil /> : <Plus />}
                      <span className="hidden sm:inline">{plan ? "Edit" : "Add plan"}</span>
                    </Button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SharedCosts event={event} />

      <TravelDialog
        attendance={editing}
        plan={editing ? plans[editing.personId] : undefined}
        name={editing ? (people.get(editing.personId)?.name ?? "") : ""}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function VanChip({ plan }: { plan: Logistics }) {
  let tone: Tone = "warn";
  let label = "Van not paid";
  if (plan.vanPaid === "yes") {
    tone = "good";
    label = "Van paid";
  } else if (plan.vanPaid === "planned") {
    label = plan.vanPayDate ? `Paying by ${shortDate(plan.vanPayDate)}` : "Plans to pay";
  }
  return <ToneChip tone={tone}>{label}</ToneChip>;
}

const DEFAULT_PLAN: Logistics = { ticket: "planned", mode: "drive", carpool: "solo" };

function TravelDialog({
  attendance,
  plan,
  name,
  onClose,
}: {
  attendance: Attendance | null;
  plan?: Logistics;
  name: string;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!attendance} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-card">
        {attendance && (
          <TravelForm key={attendance.id} a={attendance} plan={plan} name={name} onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TravelForm({
  a,
  plan,
  name,
  onDone,
}: {
  a: Attendance;
  plan?: Logistics;
  name: string;
  onDone: () => void;
}) {
  const [hasTicket, setHasTicket] = useState(a.hasTicket);
  const [planDate, setPlanDate] = useState(a.plannedPurchaseDate ?? plan?.planDate ?? "");
  const [l, setL] = useState<Logistics>(plan ?? DEFAULT_PLAN);
  const set = (patch: Partial<Logistics>) => setL((x) => ({ ...x, ...patch }));

  const save = () => {
    // The attendance row is the source of truth for tickets; the travel plan mirrors it.
    if (hasTicket !== a.hasTicket || (!hasTicket && planDate !== (a.plannedPurchaseDate ?? ""))) {
      updateAttendance(
        a.id,
        hasTicket
          ? { hasTicket: true, ticketType: a.ticketType ?? "in_person" }
          : { hasTicket: false, plannedPurchaseDate: planDate || undefined, attended: undefined },
      );
    }
    setLogistics(a.eventId, a.personId, {
      ...l,
      ticket: hasTicket ? "bought" : "planned",
      planDate: hasTicket ? undefined : planDate || undefined,
      flightBooked: l.mode === "fly" ? !!l.flightBooked : undefined,
      vanPaid: l.carpool === "van" ? (l.vanPaid ?? "no") : undefined,
      vanPayDate: l.carpool === "van" && l.vanPaid === "planned" ? l.vanPayDate : undefined,
    });
    toast.success("Travel plan saved");
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <DialogHeader className="text-left">
        <DialogTitle>Travel plan</DialogTitle>
        <DialogDescription>{name}</DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label>Ticket</Label>
        <Segmented<"yes" | "no">
          label="Ticket"
          value={hasTicket ? "yes" : "no"}
          onChange={(v) => setHasTicket(v === "yes")}
          options={[
            { value: "yes", label: "Bought" },
            { value: "no", label: "Not yet" },
          ]}
        />
        {!hasTicket && (
          <div className="mt-1 grid gap-1">
            <Label htmlFor="tr-plan" className="text-xs font-medium text-muted-foreground">
              I plan to buy by
            </Label>
            <Input
              id="tr-plan"
              type="date"
              value={planDate}
              onChange={(e) => setPlanDate(e.target.value)}
            />
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label>Getting there</Label>
        <Segmented<Logistics["mode"]>
          label="Getting there"
          value={l.mode}
          onChange={(v) => v && set({ mode: v })}
          options={[
            { value: "drive", label: "Drive", icon: Car },
            { value: "fly", label: "Fly", icon: Plane },
          ]}
        />
        {l.mode === "fly" && (
          <label className="mt-1 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px]">
            Flight booked
            <Switch checked={!!l.flightBooked} onCheckedChange={(v) => set({ flightBooked: v })} />
          </label>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="tr-ride">Ride</Label>
        <Select
          value={l.carpool}
          onValueChange={(v) => set({ carpool: v as Logistics["carpool"] })}
        >
          <SelectTrigger id="tr-ride">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(CARPOOL_LABEL) as Logistics["carpool"][]).map((k) => (
              <SelectItem key={k} value={k}>
                {CARPOOL_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {l.carpool === "van" && (
          <div className="mt-1 grid gap-1.5">
            <Segmented<NonNullable<Logistics["vanPaid"]>>
              label="Van seat paid"
              size="sm"
              value={l.vanPaid ?? "no"}
              onChange={(v) => v && set({ vanPaid: v })}
              options={[
                { value: "yes", label: "Paid" },
                { value: "no", label: "Not paid" },
                { value: "planned", label: "Pay by date" },
              ]}
            />
            {l.vanPaid === "planned" && (
              <Input
                type="date"
                aria-label="Plan to pay for the van by"
                value={l.vanPayDate ?? ""}
                onChange={(e) => set({ vanPayDate: e.target.value || undefined })}
              />
            )}
          </div>
        )}
      </div>

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">Save plan</Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Shared costs
// ---------------------------------------------------------------------------

function SharedCosts({ event }: { event: CrmEvent }) {
  const user = useCurrentUser();
  const costs = useSharedCosts(event.id);
  const [creating, setCreating] = useState(false);
  const canCreate = user.role === "leader" || user.role === "ibo";

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
      {!canCreate && (
        <p className="-mt-1 flex items-start gap-2 text-[12.5px] text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {user.role === "apprentice"
            ? "Apprentices can't create shared costs in their first contract year. You can still opt in and pay your share."
            : "Your sponsor sets up shared costs. Opt in to the ones you're part of."}
        </p>
      )}
      {costs.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="No shared costs yet"
          body="Split things like a hotel block or the team van. People opt in and each share is invoiced in the wallet."
        />
      ) : (
        <div className="grid gap-3">
          {costs.map((c) => (
            <CostCard key={c.id} cost={c} />
          ))}
        </div>
      )}
      <NewCostDialog eventId={event.id} open={creating} onOpenChange={setCreating} />
    </SectionCard>
  );
}

function CostCard({ cost: c }: { cost: SharedCost }) {
  const user = useCurrentUser();
  const people = usePeopleMap();
  const invoices = useVisibleInvoices();
  const mine = useMyInvoices().find((i) => i.costId === c.id);
  const split = splitCost(c);
  const owner = c.ownerId === user.personId;
  const member = c.members.includes(user.personId);
  const nameOf = (id: string) =>
    id === user.personId ? "You" : (people.get(id)?.name ?? "Someone outside your team");
  // Non-owners only see named rows for people they can see; the rest are summed.
  const known = (id: string) => owner || id === user.personId || people.has(id);
  const hidden = c.members.filter((m) => !known(m));
  const hiddenTotal = hidden.reduce((sum, m) => sum + split[m], 0);
  const statusOf = (id: string) => invoices.find((i) => i.costId === c.id && i.personId === id);
  const assigned = Object.values(split).reduce((s, v) => s + v, 0);
  const off = Math.round((c.total - assigned) * 100) / 100;

  return (
    <article className="grid gap-3 rounded-[12px] border border-line bg-surface-2/50 p-3.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-bold">{c.name}</h3>
          <p className="text-xs text-muted-foreground">
            {money(c.total)} total · set up by{" "}
            {known(c.ownerId) ? nameOf(c.ownerId) : "a team leader"} · split {c.members.length}{" "}
            {c.members.length === 1 ? "way" : "ways"}
          </p>
        </div>
        <Button
          size="sm"
          variant={member ? "outline" : "default"}
          onClick={() => {
            toggleCostOptIn(c.id, user.personId);
            toast.success(member ? `You left ${c.name}` : `You joined ${c.name}`);
          }}
        >
          {member ? "Opt out" : "Opt in"}
        </Button>
      </header>

      {member && mine && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-card px-3 py-2.5">
          <CreditCard className="size-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px]">
            Your share <b className="tabular-nums">{money(mine.amount)}</b>
          </span>
          {mine.status === "paid" ? (
            <ToneChip tone="good" className="ml-auto">
              Paid (sandbox){mine.paidAt ? ` · ${format(parseDate(mine.paidAt), "MMM d")}` : ""}
            </ToneChip>
          ) : (
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => {
                paySandbox(c.id, user.personId);
                toast.success(`Paid ${money(mine.amount)} (sandbox). No card was charged.`);
              }}
            >
              Pay now (sandbox)
            </Button>
          )}
          {mine.paymentReference && (
            <span className="w-full text-[11.5px] text-faint">
              Reference {mine.paymentReference}
            </span>
          )}
        </div>
      )}

      <ul className="grid gap-1.5">
        {c.members.filter(known).map((m) => {
          const p = people.get(m);
          const inv = statusOf(m);
          const custom = m in c.overrides;
          return (
            <li key={m} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px]">
              <PersonAvatar
                name={p?.name ?? "?"}
                stage={p ? effectiveBizClass(p) : undefined}
                size="sm"
              />
              <span className="min-w-0 flex-1 truncate">{nameOf(m)}</span>
              {inv && (
                <ToneChip tone={inv.status === "paid" ? "good" : "warn"}>
                  {inv.status === "paid" ? "Paid" : "Owes"}
                </ToneChip>
              )}
              {owner ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground" aria-hidden="true">
                    $
                  </span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="0.01"
                    className="h-8 w-24 text-right tabular-nums"
                    aria-label={`Amount for ${nameOf(m)}`}
                    value={split[m]}
                    onChange={(e) =>
                      setCostOverride(
                        c.id,
                        m,
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  />
                  {custom && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setCostOverride(c.id, m, null)}
                    >
                      Even split
                    </Button>
                  )}
                </span>
              ) : (
                <b className="w-20 text-right tabular-nums">{money(split[m])}</b>
              )}
            </li>
          );
        })}
        {hidden.length > 0 && (
          <li className="flex items-center gap-x-2.5 text-[13px] text-muted-foreground">
            <span className="inline-grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-bold">
              +{hidden.length}
            </span>
            <span className="min-w-0 flex-1 truncate">
              {hidden.length === 1 ? "1 person" : `${hidden.length} people`} outside your team
            </span>
            <b className="w-20 text-right tabular-nums text-foreground">{money(hiddenTotal)}</b>
          </li>
        )}
      </ul>
      {owner && off !== 0 && (
        <p className="text-xs text-warn-ink">
          The shares add up to {money(assigned)}, {money(Math.abs(off))} {off > 0 ? "less" : "more"}{" "}
          than the total.
        </p>
      )}
      {owner && (
        <p className="text-[11.5px] text-faint">
          Shares split evenly by default. Change anyone's amount; the rest split what's left.
        </p>
      )}
    </article>
  );
}

function NewCostDialog({
  eventId,
  open,
  onOpenChange,
}: {
  eventId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const user = useCurrentUser();
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const amount = Number(total);
  const valid = name.trim() && amount > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setName("");
          setTotal("");
        }
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-card">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            addSharedCost({ eventId, name: name.trim(), total: amount, ownerId: user.personId });
            toast.success(`${name.trim()} created. You're opted in.`);
            onOpenChange(false);
            setName("");
            setTotal("");
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>New shared cost</DialogTitle>
            <DialogDescription>
              People opt in and the total splits evenly. You can change anyone's share later.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="sc-name">What it's for</Label>
            <Input
              id="sc-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hotel block"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sc-total">Total</Label>
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
