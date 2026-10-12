import { Link } from "@tanstack/react-router";
import { AlertCircle, CalendarClock, TrendingUp } from "lucide-react";
import { ToneChip, type Tone } from "@/components/brand";
import { apprenticeAlertLabel } from "@/data";
import { cn } from "@/lib/utils";
import { contactLabel, MISSING_LABEL, plural, shortDate, type PersonRow } from "./model";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-good",
  warn: "text-warn-ink",
  bad: "text-bad",
  info: "text-info-ink",
  neutral: "text-muted-foreground",
};
const TONE_DOT: Record<Tone, string> = {
  good: "bg-good",
  warn: "bg-warn",
  bad: "bg-bad",
  info: "bg-info",
  neutral: "bg-track",
};

/** Last-contact text with a tone dot (good within the goal, warn overdue, bad 2x / never). */
export function ContactText({ row, compact }: { row: PersonRow; compact?: boolean }) {
  if (row.isSelf) return <span className="text-[12.5px] text-faint">—</span>;
  const { days, tone, limit, date } = row.contact;
  const label = compact && days !== null ? (days <= 0 ? "Today" : `${days}d`) : contactLabel(days);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold",
        TONE_TEXT[tone],
      )}
      title={
        date
          ? `Last contact ${shortDate(date)} · goal every ${limit} days`
          : `No contact logged · goal every ${limit} days`
      }
    >
      <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
      {label}
      <span className="sr-only">
        {tone === "good" ? "(on track)" : tone === "warn" ? "(overdue)" : "(well overdue)"}
      </span>
    </span>
  );
}

/** Attendance show rate as "80%" plus "4 of 5". */
export function ShowRateText({ row }: { row: PersonRow }) {
  const { eligible, attended, pct } = row.showRate;
  if (eligible === 0)
    return (
      <span className="text-[12.5px] text-faint" title="No past events with a ticket or a yes">
        —
      </span>
    );
  return (
    <span className="grid leading-tight" title={`Attended ${attended} of ${eligible} events`}>
      <span className="text-[13px] font-bold tabular-nums">{pct}%</span>
      <span className="text-[11px] text-muted-foreground tabular-nums">
        {attended} of {eligible}
      </span>
    </span>
  );
}

/** Link to the sponsor / owner, "You" for the viewer, or a dash. */
export function UplineLink({ row, viewerId }: { row: PersonRow; viewerId: string }) {
  const up = row.upline;
  if (!up) return <span className="text-faint">—</span>;
  if (up.id === viewerId) return <span>You</span>;
  return (
    <Link
      to="/people/$id"
      params={{ id: up.id }}
      className="rounded-sm font-medium hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {up.name}
    </Link>
  );
}

/** Alert chips: IBO anniversary, missing required fields, event follow-up. */
export function FlagChips({ row, className }: { row: PersonRow; className?: string }) {
  const chips: React.ReactNode[] = [];
  if (row.alert && row.anniversaryDays !== undefined) {
    const d = row.anniversaryDays;
    const title = `${apprenticeAlertLabel(row.alert)}${row.anniversaryDate ? ` (${shortDate(row.anniversaryDate)})` : ""}`;
    chips.push(
      <span key="ann" title={title}>
        <ToneChip
          tone={row.alert === "due" ? "good" : row.alert === "30d" ? "warn" : "info"}
          icon={TrendingUp}
        >
          {d <= 0 ? "Now an IBO" : `IBO in ${plural(d, "day")}`}
        </ToneChip>
      </span>,
    );
  }
  if (row.missing.length) {
    const names = row.missing.map((m) => MISSING_LABEL[m] ?? m);
    chips.push(
      <span key="missing" title={`Missing required info: ${names.join(", ")}`}>
        <ToneChip tone="bad" icon={AlertCircle}>
          Missing {names.join(", ")}
        </ToneChip>
      </span>,
    );
  }
  if (row.followUp) {
    chips.push(
      <span key="fu" title="Earliest follow-up on an upcoming event">
        <ToneChip tone={row.followUpOverdue ? "warn" : "neutral"} icon={CalendarClock}>
          {row.followUpOverdue ? "Follow-up was " : "Follow up "}
          {shortDate(row.followUp)}
        </ToneChip>
      </span>,
    );
  }
  if (!chips.length) return null;
  return <div className={cn("flex flex-wrap gap-1", className)}>{chips}</div>;
}
