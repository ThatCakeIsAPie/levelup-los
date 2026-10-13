import { useMemo, useState } from "react";
import { Bus, Car, Pencil, Plane, Plus, Info } from "lucide-react";
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
  effectiveBizClass,
  setLogistics,
  updateAttendance,
  useCurrentUser,
  useLogistics,
  type Attendance,
  type CrmEvent,
  type Logistics,
} from "@/data";
import { usePeopleMap } from "./hooks";
import { shortDate, ticketStatus } from "./lib";
import { Segmented } from "./Segmented";
import { SharedCostsCard } from "@/components/costs/SharedCosts";

const CARPOOL_LABEL: Record<Logistics["carpool"], string> = {
  teammate: "Carpool with a teammate",
  other_team: "Carpool with another team",
  solo: "Going solo",
  van: "Van or bus with the organizer",
};

/**
 * Tickets and travel tab: per-attendee travel plans (ticket status comes from
 * the attendance row), plus the event's shared costs (the same component the
 * Wallet uses). Tickets are tracked here, never sold.
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

      <SharedCostsCard eventId={event.id} />

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
