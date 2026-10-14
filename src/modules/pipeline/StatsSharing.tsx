import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Eye, Search, Share2, UserCheck, X } from "lucide-react";
import { PersonAvatar, SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  answerStatRequest,
  cancelStatRequest,
  requestStats,
  revokeStatShare,
  shareStats,
  useStatSharing,
  type NamedPerson,
} from "@/data";
import { plural } from "./format";

/**
 * Requests to see your pipeline numbers, waiting for your answer. Shown on
 * the Pipeline page and your profile (and ready for the Inbox).
 */
export function StatRequestsPanel({ className }: { className?: string }) {
  const s = useStatSharing();
  if (!s || s.incoming.length === 0) return null;
  return (
    <section
      aria-label="Requests to see your numbers"
      className={cn(
        "grid gap-2 rounded-card border border-sky bg-info-soft/40 px-4 py-3",
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-[13px] font-bold">
        <Eye className="size-4 text-info-ink" aria-hidden="true" />
        {plural(s.incoming.length, "person asks", "people ask")} to see your pipeline numbers
      </h2>
      <ul className="grid gap-1.5">
        {s.incoming.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[13px]">
            <PersonAvatar name={r.person.name} stage={r.person.stage} size="sm" />
            <span className="min-w-0 flex-[1_1_12rem]">
              <b>{r.person.name}</b>
              <span className="text-muted-foreground"> wants to see your conversions</span>
            </span>
            <span className="flex gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  answerStatRequest(r.id, true);
                  toast.success(`${r.person.name} can now see your numbers`);
                }}
              >
                <Check /> Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  answerStatRequest(r.id, false);
                  toast(`Declined ${r.person.name}'s request`);
                }}
              >
                Decline
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Pick people from a searchable list (one or many). */
function PeoplePicker({
  people,
  selected,
  onToggle,
  multi,
}: {
  people: NamedPerson[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  multi: boolean;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people
      .filter((p) => !s || p.name.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [people, q]);
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people"
          aria-label="Search people"
          className="pl-8"
        />
      </div>
      <ul
        className="grid max-h-64 gap-0.5 overflow-y-auto rounded-lg border border-line p-1"
        role={multi ? undefined : "radiogroup"}
      >
        {shown.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id}>
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-2",
                  on && "bg-primary-soft",
                )}
              >
                {multi ? (
                  <Checkbox checked={on} onCheckedChange={() => onToggle(p.id)} />
                ) : (
                  <input
                    type="radio"
                    name="stat-person"
                    className="accent-[var(--color-primary)]"
                    checked={on}
                    onChange={() => onToggle(p.id)}
                  />
                )}
                <PersonAvatar name={p.name} stage={p.stage} size="sm" />
                <span className="truncate">{p.name}</span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-2 py-3 text-[12px] text-faint">Nobody found.</li>}
      </ul>
    </div>
  );
}

/** "Share my stats": pick who else may see your per-person numbers. */
export function ShareStatsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const s = useStatSharing();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  if (!s) return null;
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setSelected(new Set());
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share my stats</DialogTitle>
          <DialogDescription>
            Your upline already sees your conversions. Share them with anyone else, like a mentor in
            another leg. You can take it back any time.
          </DialogDescription>
        </DialogHeader>
        <PeoplePicker people={s.shareCandidates} selected={selected} onToggle={toggle} multi />
        <DialogFooter>
          <Button
            disabled={selected.size === 0}
            onClick={() => {
              const n = shareStats([...selected]);
              toast.success(`Shared with ${plural(n, "person", "people")}`);
              setSelected(new Set());
              onOpenChange(false);
            }}
          >
            <Share2 /> Share{selected.size ? ` with ${selected.size}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Request to view stats": ask a crossline or upline to share theirs. */
export function RequestStatsDialog({
  open,
  onOpenChange,
  personId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ask this person straight away (no picker). */
  personId?: string;
}) {
  const s = useStatSharing();
  const [pick, setPick] = useState<string | null>(personId ?? null);
  if (!s) return null;
  const target = s.requestCandidates.find((p) => p.id === (personId ?? pick));
  const send = () => {
    if (!target) return;
    const r = requestStats(target.id);
    if (r.ok) toast.success(`Request sent to ${target.name}`);
    else toast.error("You can already see their numbers, or a request is waiting.");
    setPick(null);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request to view stats</DialogTitle>
          <DialogDescription>
            You see your own conversions and your downline&rsquo;s. Anyone else decides whether to
            share theirs: they get a request to approve or decline.
          </DialogDescription>
        </DialogHeader>
        {!personId && (
          <PeoplePicker
            people={s.requestCandidates}
            selected={new Set(pick ? [pick] : [])}
            onToggle={setPick}
            multi={false}
          />
        )}
        {s.outgoing.length > 0 && (
          <div className="grid gap-1 text-[12.5px]">
            <b className="text-[12px] text-muted-foreground">Waiting for an answer</b>
            {s.outgoing.map((r) => (
              <div key={r.id} className="flex items-center gap-2">
                <PersonAvatar name={r.person.name} stage={r.person.stage} size="sm" />
                <span className="flex-1 truncate">{r.person.name}</span>
                <Button size="sm" variant="ghost" onClick={() => cancelStatRequest(r.id)}>
                  Withdraw
                </Button>
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button disabled={!target} onClick={send}>
            Send request{target ? ` to ${target.name.split(" ")[0]}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Own profile: who sees your pipeline numbers. Uplines automatically; anyone
 * you shared with (revoke any time); requests waiting for you.
 */
export function StatsAccessCard() {
  const s = useStatSharing();
  const [shareOpen, setShareOpen] = useState(false);
  if (!s) return null;
  return (
    <SectionCard
      title="Who sees my pipeline numbers"
      action={
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Share my stats
        </button>
      }
    >
      <StatRequestsPanel />
      <ul className="grid gap-2 text-[13px]">
        {s.automatic.length > 0 && (
          <li className="flex items-start gap-2.5">
            <UserCheck
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">
              Your upline ({s.automatic.map((p) => p.name).join(", ")}) sees them automatically.
            </span>
          </li>
        )}
        {s.sharesOut.map((sh) => (
          <li key={sh.id} className="flex items-center gap-2.5">
            <PersonAvatar name={sh.person.name} stage={sh.person.stage} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              <b className="font-semibold">{sh.person.name}</b>
              <span className="text-muted-foreground"> · you shared</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                revokeStatShare(sh.id);
                toast(`${sh.person.name} can no longer see your numbers`);
              }}
            >
              <X /> Revoke
            </Button>
          </li>
        ))}
        {s.sharesOut.length === 0 && (
          <li className="text-[12.5px] text-faint">You haven&rsquo;t shared with anyone else.</li>
        )}
      </ul>
      {s.sharesIn.length > 0 && (
        <p className="text-[12px] text-muted-foreground">
          Shared with you: {s.sharesIn.map((x) => x.person.name).join(", ")}.
        </p>
      )}
      <ShareStatsDialog open={shareOpen} onOpenChange={setShareOpen} />
    </SectionCard>
  );
}
