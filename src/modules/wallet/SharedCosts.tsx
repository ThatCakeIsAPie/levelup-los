import { useMemo, useState } from "react";
import { ChevronDown, Plus, RotateCcw, Users } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PersonAvatar, SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addSharedCost,
  setCostOverride,
  splitCost,
  toggleCostOptIn,
  useCurrentUser,
  useEvents,
  useMyInvoices,
  useSharedCosts,
  useUpcomingEvents,
  useVisiblePeople,
  type CrmEvent,
  type CrmPerson,
  type SharedCost,
} from "@/data";
import { cn } from "@/lib/utils";
import { money, shortDate } from "./format";

/**
 * Shared event costs: everyone can opt in or out; the cost's organizer can
 * change any member's share; leaders and IBOs can create a new cost.
 * (Same rules as the event page's logistics tab.)
 */
export function SharedCostsCard() {
  const user = useCurrentUser();
  const costs = useSharedCosts();
  const events = useEvents();
  const people = useVisiblePeople();
  const invoices = useMyInvoices();

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const paidCostIds = useMemo(
    () => new Set(invoices.filter((i) => i.status === "paid").map((i) => i.costId)),
    [invoices],
  );
  const canCreate = user.role === "leader" || user.role === "ibo";

  // Upcoming events first (soonest first), then past ones (most recent first).
  const sorted = useMemo(() => {
    const date = (c: SharedCost) => eventById.get(c.eventId)?.date ?? "";
    return [...costs].sort((a, b) => date(a).localeCompare(date(b)));
  }, [costs, eventById]);

  return (
    <SectionCard title="Shared costs">
      <p className="-mt-1 text-[12.5px] text-muted-foreground">
        Split a van, hotel block or venue with the team. Opt in and your share shows up as an
        invoice.
      </p>
      {sorted.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="No shared costs yet"
          body={
            canCreate
              ? "Create one below and your team can opt in."
              : "When a leader or IBO creates one, you can opt in here."
          }
        />
      ) : (
        <div>
          {sorted.map((c) => (
            <CostItem
              key={c.id}
              cost={c}
              event={eventById.get(c.eventId)}
              me={user.personId}
              personById={personById}
              paid={paidCostIds.has(c.id)}
            />
          ))}
        </div>
      )}
      {canCreate ? (
        <CreateCostForm ownerId={user.personId} />
      ) : (
        <p className="border-t border-line pt-3 text-xs text-muted-foreground">
          Only leaders and IBOs can create shared costs.
        </p>
      )}
    </SectionCard>
  );
}

function nameFor(id: string, me: string, personById: Map<string, CrmPerson>): string {
  if (id === me) return "You";
  return personById.get(id)?.name ?? "A team member";
}

function CostItem({
  cost,
  event,
  me,
  personById,
  paid,
}: {
  cost: SharedCost;
  event?: CrmEvent;
  me: string;
  personById: Map<string, CrmPerson>;
  paid: boolean;
}) {
  const split = splitCost(cost);
  const member = cost.members.includes(me);
  const owner = cost.ownerId === me;
  const organizer = owner ? "you" : (personById.get(cost.ownerId)?.name ?? "a team member");

  return (
    <div className="grid gap-2 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{cost.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {event ? `${event.name} · ${shortDate(event.date)}` : "Event removed"}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground tabular-nums">{money(cost.total)}</span>{" "}
            total · {cost.members.length} in · organized by {organizer}
          </div>
        </div>
        {member && paid ? (
          <ToneChip tone="good">Paid</ToneChip>
        ) : (
          <Button
            size="sm"
            variant={member ? "outline" : "soft"}
            onClick={() => {
              toggleCostOptIn(cost.id, me);
              toast.success(member ? `Opted out of ${cost.name}` : `Opted in to ${cost.name}`);
            }}
          >
            {member ? "Opt out" : "Opt in"}
          </Button>
        )}
      </div>
      {member && (
        <p className="text-xs text-muted-foreground">
          Your share{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {money(split[me] ?? 0)}
          </span>
        </p>
      )}
      {owner && <ManageSplit cost={cost} split={split} me={me} personById={personById} />}
    </div>
  );
}

function ManageSplit({
  cost,
  split,
  me,
  personById,
}: {
  cost: SharedCost;
  split: Record<string, number>;
  me: string;
  personById: Map<string, CrmPerson>;
}) {
  const [open, setOpen] = useState(false);
  const sum = Object.values(split).reduce((s, v) => s + v, 0);
  const off = Math.abs(sum - cost.total) > 0.01;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Manage split
          <ChevronDown
            className={cn("size-3.5 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 grid gap-2 rounded-[10px] bg-surface-2 p-3">
        {cost.members.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nobody has opted in yet.</p>
        ) : (
          cost.members.map((m) => {
            const name = nameFor(m, me, personById);
            const custom = m in cost.overrides;
            const person = personById.get(m);
            return (
              <div
                key={m}
                className="grid grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-2"
              >
                <PersonAvatar name={person?.name ?? name} stage={person?.bizClass} size="sm" />
                <span className="truncate text-[12.5px]">
                  {name}
                  {custom && <span className="ml-1.5 text-[11px] text-faint">custom</span>}
                </span>
                <ShareInput
                  value={split[m] ?? 0}
                  label={`Share for ${name}`}
                  onCommit={(v) => setCostOverride(cost.id, m, v)}
                />
                {custom ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-8"
                    aria-label={`Reset ${name} to an even share`}
                    title="Reset to even share"
                    onClick={() => setCostOverride(cost.id, m, null)}
                  >
                    <RotateCcw />
                  </Button>
                ) : (
                  <span className="size-8" />
                )}
              </div>
            );
          })
        )}
        <p className={cn("text-[11.5px]", off ? "text-warn-ink" : "text-muted-foreground")}>
          Shares add up to <span className="font-semibold tabular-nums">{money(sum)}</span> of{" "}
          <span className="tabular-nums">{money(cost.total)}</span>.{" "}
          {off
            ? "Adjust a share so they match the total."
            : "Everyone else splits the rest evenly."}
        </p>
      </CollapsibleContent>
    </Collapsible>
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

function CreateCostForm({ ownerId }: { ownerId: string }) {
  const upcoming = useUpcomingEvents();
  const [eventId, setEventId] = useState("");
  const [name, setName] = useState("");
  const [total, setTotal] = useState("");
  const selected = eventId || upcoming[0]?.id || "";
  const totalNum = Number(total);
  const valid = !!selected && name.trim() !== "" && Number.isFinite(totalNum) && totalNum > 0;

  if (upcoming.length === 0) {
    return (
      <p className="border-t border-line pt-3 text-xs text-muted-foreground">
        Shared costs are created for upcoming events. Add an event first.
      </p>
    );
  }

  return (
    <form
      className="grid gap-3 border-t border-line pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        addSharedCost({ eventId: selected, name: name.trim(), total: totalNum, ownerId });
        toast.success(`Shared cost created: ${name.trim()}`);
        setName("");
        setTotal("");
      }}
    >
      <h3 className="text-[13px] font-bold">New shared cost</h3>
      <div className="grid gap-1.5">
        <Label htmlFor="cost-event" className="text-[12.5px] font-semibold">
          Event
        </Label>
        <select
          id="cost-event"
          value={selected}
          onChange={(e) => setEventId(e.target.value)}
          className="h-9 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          {upcoming.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {shortDate(e.date)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
        <div className="grid gap-1.5">
          <Label htmlFor="cost-name" className="text-[12.5px] font-semibold">
            What is it
          </Label>
          <Input
            id="cost-name"
            placeholder="e.g. Hotel block"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cost-total" className="text-[12.5px] font-semibold">
            Total ($)
          </Label>
          <Input
            id="cost-total"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
          />
        </div>
      </div>
      <Button type="submit" variant="outline" disabled={!valid} className="justify-self-start">
        <Plus /> Create shared cost
      </Button>
      <p className="text-[11.5px] text-faint">You're opted in automatically as the organizer.</p>
    </form>
  );
}
