import { useState, type ComponentType } from "react";
import { Link } from "@tanstack/react-router";
import { addDays, format, isAfter } from "date-fns";
import {
  CalendarClock,
  Clock,
  Mail,
  Megaphone,
  MessageSquare,
  Mic,
  Send,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, SectionCard, ToneChip, TONE_CLASS } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addCampaign,
  localDate,
  parseDate,
  useCurrentUser,
  useMyCampaigns,
  useVisibleCustomers,
  type Campaign,
} from "@/data";
import { cn } from "@/lib/utils";

type Kind = Campaign["kind"];

const KINDS: { value: Kind; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { value: "email", label: "Email", icon: Mail },
  { value: "text", label: "Text", icon: MessageSquare },
  { value: "voice", label: "Voice note", icon: Mic },
];
const KIND_LABEL: Record<Kind, string> = { email: "Email", text: "Text", voice: "Voice note" };
const KIND_ICON: Record<Kind, ComponentType<{ className?: string }>> = {
  email: Mail,
  text: MessageSquare,
  voice: Mic,
};

/** One SMS segment. */
const SMS_LEN = 160;

export function CampaignsPage() {
  const user = useCurrentUser();
  const campaigns = useMyCampaigns();

  if (user.role === "candidate") {
    return (
      <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
        <PageHeader title="Campaigns" subtitle="Email, text or voice notes to your customers" />
        <EmptyState
          icon={<Megaphone />}
          title="Campaigns open up with your own customers"
          body="Campaigns go to the customers you own, and customers belong to IBOs and apprentices. Once you start your business, you can write to them from here."
        />
      </div>
    );
  }

  return (
    <div className="grid gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader title="Campaigns" subtitle="Email, text or voice notes to your customers" />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Composer ownerId={user.personId} />
        <History campaigns={campaigns} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function Composer({ ownerId }: { ownerId: string }) {
  const customers = useVisibleCustomers();
  const [kind, setKind] = useState<Kind>("email");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState<"now" | "later">("now");
  const [date, setDate] = useState(() => localDate(addDays(new Date(), 1)));
  const [time, setTime] = useState("09:00");

  const scheduledFor = mode === "later" && date && time ? `${date}T${time}` : undefined;
  const scheduleInPast = !!scheduledFor && !isAfter(parseDate(scheduledFor), new Date());
  const valid =
    message.trim() !== "" &&
    customers.length > 0 &&
    (mode === "now" || (!!scheduledFor && !scheduleInPast));

  const send = () => {
    if (!valid) return;
    addCampaign({
      ownerId,
      kind,
      message: message.trim(),
      recipients: customers.map((c) => c.id),
      scheduledFor,
    });
    setMessage("");
    toast.success(
      scheduledFor
        ? `Scheduled for ${format(parseDate(scheduledFor), "MMM d, h:mm a")}, pending send`
        : "Queued, pending send",
    );
  };

  const n = customers.length;
  const sendLabel =
    mode === "later"
      ? scheduledFor && !scheduleInPast
        ? `Schedule for ${format(parseDate(scheduledFor), "MMM d, h:mm a")}`
        : "Schedule"
      : `Send to ${n} ${n === 1 ? "customer" : "customers"}`;

  return (
    <SectionCard title="New campaign">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex items-center gap-3 rounded-[10px] bg-surface-2 px-3 py-2.5">
          <span className="grid size-8 place-items-center rounded-[9px] bg-stage-customer-soft text-stage-customer-ink">
            <Users className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11.5px] text-muted-foreground">Audience</div>
            <div className="text-[13px] font-semibold">
              My customers <span className="tabular-nums text-muted-foreground">({n})</span>
            </div>
          </div>
          <Link
            to="/customers"
            className="shrink-0 rounded-sm text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            View list
          </Link>
        </div>
        {n === 0 && (
          <p className="-mt-2 text-xs text-warn-ink">
            You don't have customers yet. Add one on the Customers page to send a campaign.
          </p>
        )}

        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[12.5px] font-semibold">Type</legend>
          <Segmented
            label="Campaign type"
            value={kind}
            onChange={setKind}
            options={KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))}
          />
        </fieldset>

        <div className="grid gap-1.5">
          <Label htmlFor="campaign-message" className="text-[12.5px] font-semibold">
            {kind === "voice" ? "Voice note script" : "Message"}
          </Label>
          <Textarea
            id="campaign-message"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={
              kind === "email"
                ? "Hi, a quick note about this month's specials…"
                : kind === "text"
                  ? "Hi, it's time to restock. Want me to place your order?"
                  : "What you'll say in the recording"
            }
            aria-describedby="campaign-message-hint"
          />
          <p id="campaign-message-hint" className="text-[11.5px] text-muted-foreground">
            <MessageHint kind={kind} message={message} />
          </p>
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-1.5 text-[12.5px] font-semibold">When</legend>
          <Segmented
            label="When to send"
            value={mode}
            onChange={setMode}
            options={[
              { value: "now", label: "Send now", icon: Send },
              { value: "later", label: "Schedule", icon: CalendarClock },
            ]}
          />
          {mode === "later" && (
            <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
              <div className="grid gap-1">
                <Label htmlFor="campaign-date" className="text-[11.5px] text-muted-foreground">
                  Date
                </Label>
                <Input
                  id="campaign-date"
                  type="date"
                  min={localDate()}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="campaign-time" className="text-[11.5px] text-muted-foreground">
                  Time
                </Label>
                <Input
                  id="campaign-time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </div>
              {scheduleInPast && (
                <p className="col-span-2 text-xs text-bad">Pick a time in the future.</p>
              )}
            </div>
          )}
        </fieldset>

        <div className="grid gap-2">
          <Button
            type="submit"
            disabled={!valid}
            className="w-full sm:w-auto sm:justify-self-start"
          >
            {mode === "later" ? <CalendarClock /> : <Send />}
            {sendLabel}
          </Button>
          <p className="text-[11.5px] text-faint">
            Nothing goes out yet: campaigns wait in a pending queue until messaging is connected.
          </p>
        </div>
      </form>
    </SectionCard>
  );
}

function MessageHint({ kind, message }: { kind: Kind; message: string }) {
  const len = message.length;
  if (kind === "text") {
    const parts = Math.max(1, Math.ceil(len / SMS_LEN));
    return (
      <span className={cn("tabular-nums", len > SMS_LEN && "text-warn-ink")}>
        {len} / {SMS_LEN} characters
        {len > SMS_LEN && ` · sends as ${parts} texts`}
      </span>
    );
  }
  if (kind === "voice") {
    const words = message.trim() ? message.trim().split(/\s+/).length : 0;
    const secs = Math.round(words / 2.5);
    return (
      <span className="tabular-nums">
        {words} {words === 1 ? "word" : "words"}
        {words > 0 && ` · about ${secs < 60 ? `${secs} sec` : `${Math.round(secs / 6) / 10} min`}`}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {len} {len === 1 ? "character" : "characters"}
    </span>
  );
}

/** Pill segmented control (same look as the theme switcher). */
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid w-full auto-cols-fr grid-flow-col gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px] sm:w-fit"
    >
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold whitespace-nowrap text-muted-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring",
              on ? "bg-surface text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            {Icon && <Icon className="size-3.5" aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function History({ campaigns }: { campaigns: Campaign[] }) {
  return (
    <SectionCard
      title="History"
      action={
        campaigns.length > 0 ? (
          <span className="font-semibold text-muted-foreground tabular-nums">
            {campaigns.length}
          </span>
        ) : undefined
      }
    >
      {campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone />}
          title="No campaigns yet"
          body="Campaigns you send or schedule are listed here with their status."
        />
      ) : (
        <ul className="grid">
          {campaigns.map((c) => {
            const Icon = KIND_ICON[c.kind];
            const n = c.recipients.length;
            return (
              <li
                key={c.id}
                className="grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-t border-line py-3 first:border-t-0 first:pt-0.5"
              >
                <span
                  className={cn("grid size-8 place-items-center rounded-[9px]", TONE_CLASS.primary)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <div className="grid min-w-0 gap-1">
                  <div className="text-[13px] font-semibold">
                    {KIND_LABEL[c.kind]} to {n} {n === 1 ? "customer" : "customers"}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {c.scheduledFor ? (
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3" aria-hidden="true" />
                        Scheduled for {format(parseDate(c.scheduledFor), "MMM d, h:mm a")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3" aria-hidden="true" />
                        Created {format(parseDate(c.createdAt), "MMM d, h:mm a")}
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-[12.5px] break-words text-foreground/90">
                    {c.message}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
                    <ToneChip tone="info">Pending send</ToneChip>
                    goes out when messaging is connected
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
