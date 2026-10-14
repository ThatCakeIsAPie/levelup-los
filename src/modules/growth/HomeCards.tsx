import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  FileBarChart,
  Kanban,
  Network,
  PartyPopper,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import {
  daysSince,
  growthMilestone,
  openLog,
  registeredOn,
  useCurrentUser,
  useDownline,
  useMyGrowthPath,
  useUnlocks,
  type GrowthPath,
} from "@/data";
import { SectionCard, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { firstName } from "@/modules/people/format";
import { OverrideNote, ProgressBar, ProgressParts } from "./GrowthPath";
import { isMonthly, pv, reachedShort } from "./format";
import { storageKey } from "@/lib/config";

/** What to say under the next milestone's numbers. */
function nudge(path: GrowthPath): string {
  const next = path.next!;
  const p = next.progress!;
  const check = growthMilestone(next.code).check;
  switch (check.kind) {
    case "first_sale":
      return "Log your first sale to a customer. It counts the moment you save it.";
    case "personal_pv": {
      const left = Math.max(0, p.parts[0].target - p.parts[0].current);
      return `${pv(left)} PV to go. Log a sale and it counts right away.`;
    }
    case "group_pv":
    case "legs_pv":
      return "Your team's PV this month counts, yours included.";
    case "count": {
      if (check.people === 0) return "When someone you sponsor registers, you've reached it.";
      const [s, n] = p.parts;
      const bits = [
        s.current < s.target &&
          `${s.target - s.current} more personal ${s.target - s.current === 1 ? "sponsor" : "sponsors"}`,
        n &&
          n.current < n.target &&
          `${n.target - n.current} more ${n.target - n.current === 1 ? "person" : "people"} in your group`,
      ].filter(Boolean);
      return bits.length ? `${bits.join(" and ")} to go.` : "Almost there.";
    }
    case "registered":
      return "Register your business to start your path.";
  }
}

/**
 * Home: the signed-in person's next milestone (one clear goal) with its real
 * numbers, and the steps just behind and ahead of it.
 */
export function NextMilestoneCard() {
  const me = useCurrentUser();
  const path = useMyGrowthPath();
  if (!path?.registered) return null;
  const next = path.next;
  const link = (
    <Link
      to="/people/$id"
      params={{ id: me.personId }}
      className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      Your path
    </Link>
  );

  if (!next) {
    return (
      <SectionCard title="Your growth path" action={link}>
        <p className="text-[13px]">
          You've reached every milestone on the path, all the way to <b>12/100</b>.
        </p>
      </SectionCard>
    );
  }

  const p = next.progress!;
  const monthly = isMonthly(next.code);
  const single = monthly && p.parts.length === 1 ? p.parts[0] : null;
  const kind = growthMilestone(next.code).check.kind;
  const days = path.thisMonth.daysLeft;
  const lo = Math.max(0, path.nextIndex - 2);
  const strip = path.milestones.slice(lo, Math.min(path.milestones.length, path.nextIndex + 3));

  return (
    <SectionCard
      title="Your next milestone"
      action={
        monthly ? (
          <ToneChip tone="info">
            {days === 0
              ? "Last day this month"
              : `${days} ${days === 1 ? "day" : "days"} left this month`}
          </ToneChip>
        ) : (
          link
        )
      }
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <span className="text-[26px] leading-none font-extrabold tracking-tight">{next.label}</span>
        {single && (
          <span className="flex items-baseline gap-1.5">
            <b className="text-[26px] leading-none font-extrabold tabular-nums">
              {pv(single.current)}
            </b>
            <span className="text-[12.5px] text-muted-foreground">
              / {pv(single.target)} {kind === "group_pv" ? "group PV" : "PV"} this month
            </span>
          </span>
        )}
      </div>
      {single ? (
        <ProgressBar value={single.current / single.target} className="h-2.5" />
      ) : kind === "first_sale" || (kind === "count" && p.parts.length === 1) ? null : (
        <ProgressParts status={next} />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1">
          <p className="text-[12.5px] text-muted-foreground">{nudge(path)}</p>
          {monthly && <OverrideNote path={path} own />}
        </div>
        {(kind === "personal_pv" || kind === "first_sale") && (
          <Button size="sm" onClick={() => openLog({ tab: "sale" })}>
            <ShoppingBag /> Log a sale
          </Button>
        )}
      </div>
      <ol className="flex flex-wrap gap-1.5" aria-label="Steps around your next milestone">
        {strip.map((m) => {
          const reached = !!m.reachedOn;
          const now = m.code === next.code;
          return (
            <li
              key={m.code}
              aria-current={now ? "step" : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                reached && "bg-good-soft text-good",
                now && "bg-primary text-primary-foreground",
                !reached && !now && "bg-surface-2 text-muted-foreground",
              )}
            >
              {reached && <Check className="size-3" strokeWidth={3} aria-hidden="true" />}
              {m.label}
              {reached && (
                <span className="font-medium opacity-80">{reachedShort(m.reachedOn!)}</span>
              )}
              <span className="sr-only">{reached ? " (reached)" : now ? " (next)" : ""}</span>
            </li>
          );
        })}
        {monthly && <li className="ml-auto self-center text-[12.5px] font-semibold">{link}</li>}
      </ol>
    </SectionCard>
  );
}

const SEEN_KEY = (personId: string) => storageKey(`growth.firstSponsorSeen.${personId}`);
const readSeen = (key: string): boolean => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};
const writeSeen = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Storage unavailable: it may show again next time, which is harmless.
  }
};

/**
 * A one-time celebration when the signed-in person newly reaches First
 * sponsor (within the last 30 days), listing what it opens up. Shown once per
 * person on this device; someone who reached it long ago never sees it.
 */
export function FirstSponsorCelebration() {
  const me = useCurrentUser();
  const navigate = useNavigate();
  const path = useMyGrowthPath();
  const reachedOn = path?.milestones.find((m) => m.code === "first_sponsor")?.reachedOn ?? null;
  const key = SEEN_KEY(me.personId);
  // "Show me" opens the team view, which First sponsor unlocks (src/data/unlocks.ts).
  const teamUnlocked = useUnlocks().can.team;
  const [open, setOpen] = useState(false);
  const frontline = useDownline(me.personId, { directOnly: true });
  const sponsored = useMemo(
    () =>
      frontline
        .map((p) => ({ p, on: registeredOn(p) }))
        .filter((x): x is { p: (typeof frontline)[number]; on: string } => !!x.on)
        .sort((a, b) => a.on.localeCompare(b.on))[0]?.p,
    [frontline],
  );

  useEffect(() => {
    if (!reachedOn || !teamUnlocked || readSeen(key)) return;
    if ((daysSince(reachedOn) ?? 0) <= 30) setOpen(true);
    else writeSeen(key);
  }, [reachedOn, teamUnlocked, key]);

  const close = () => {
    writeSeen(key);
    setOpen(false);
  };
  const who = sponsored ? firstName(sponsored.name) : "your new teammate";
  const rows = [
    { icon: Network, title: "Your team", text: `see ${who} and everyone they bring in` },
    { icon: Kanban, title: "Recruiting pipeline", text: "works just like your customer one" },
    { icon: UserRound, title: "Downline profiles", text: "follow each person's growth path" },
    { icon: FileBarChart, title: "Reports", text: "your team's numbers" },
  ];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-[min(92vw,420px)] gap-3 rounded-[18px]">
        <span
          className="grid size-[46px] place-items-center rounded-[14px] bg-primary-soft text-primary-ink"
          aria-hidden="true"
        >
          <PartyPopper className="size-[22px]" />
        </span>
        <DialogHeader>
          <DialogTitle className="text-[17px] font-extrabold">
            You sponsored your first person
          </DialogTitle>
          <DialogDescription className="text-[12.5px]">
            {sponsored ? `Welcome to the team, ${who}. ` : ""}You've reached{" "}
            <b className="text-foreground">First sponsor</b>, and new things are ready:
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2">
          {rows.map((r) => (
            <li
              key={r.title}
              className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-2 text-[12.5px]"
            >
              <r.icon className="mt-px size-[17px] text-primary" aria-hidden="true" />
              <span>
                <b>{r.title}</b> · {r.text}
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter className="grid grid-cols-2 gap-2 pt-1 sm:grid">
          <Button variant="outline" onClick={close}>
            Later
          </Button>
          <Button
            onClick={() => {
              close();
              void navigate({ to: "/mindmap" });
            }}
          >
            Show me
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
