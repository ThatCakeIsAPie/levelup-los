import { useState } from "react";
import { ImageOff, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader, ToneChip, Sensitive } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FEEDBACK_LIST_LIMIT,
  FEEDBACK_LOCAL_ONLY,
  nextStatus,
  setFeedbackStatus,
  useCurrentUser,
  useFeedbackImageUrl,
  useFeedbackReports,
  type FeedbackReport,
} from "@/data";

import { sensitive } from "@/lib/sensitive";
const PAGE =
  "mx-auto grid w-full max-w-3xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/** /settings/feedback: what people sent from the Feedback button (app admins only). */
export function FeedbackPage() {
  const admin = !!useCurrentUser().admin;
  const { reports, loading, error, reload } = useFeedbackReports(admin);
  return (
    <div className={PAGE}>
      <PageHeader
        title="Feedback"
        subtitle={
          FEEDBACK_LOCAL_ONLY
            ? `Reports saved in this browser, newest first (latest ${FEEDBACK_LIST_LIMIT})`
            : `What people asked to change, newest first (latest ${FEEDBACK_LIST_LIMIT})`
        }
        crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Feedback" }]}
      />
      {!admin ? (
        <EmptyState
          icon={<MessageSquareText />}
          title="Feedback reports are for app admins"
          body="Anyone can send feedback with the Feedback button. Only app admins read what was sent."
        />
      ) : loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : error ? (
        <EmptyState title="Couldn't load the reports" body={error} />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<MessageSquareText />}
          title="No feedback yet"
          body="Reports show up here after someone sends one with the Feedback button."
        />
      ) : (
        <ul className="grid gap-3">
          {reports.map((r) => (
            <ReportRow key={r.id} report={r} onChanged={reload} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportRow({ report, onChanged }: { report: FeedbackReport; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const done = report.status === "done";
  const page = `${report.context.path ?? ""}${report.context.search ?? ""}` || "Unknown page";

  async function toggle() {
    setBusy(true);
    try {
      await setFeedbackStatus(report.id, nextStatus(report.status));
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3.5 sm:flex-row">
      <Thumbnail report={report} />
      <div className="grid min-w-0 flex-1 content-start gap-2">
        <p className="whitespace-pre-wrap break-words text-sm">
          <Sensitive kind="message">{report.message}</Sensitive>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            <Sensitive kind="name">{report.senderName}</Sensitive>
          </span>
          <span aria-hidden="true">·</span>
          <span className="break-all">{page}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={report.createdAt}>{when(report.createdAt)}</time>
          {!report.screenshotPath && (
            <>
              <span aria-hidden="true">·</span>
              <span>No screenshot</span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ToneChip tone={done ? "good" : "info"}>{done ? "Done" : "New"}</ToneChip>
          <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>
            {done ? "Reopen" : "Done"}
          </Button>
        </div>
      </div>
    </li>
  );
}

function Thumbnail({ report }: { report: FeedbackReport }) {
  const url = useFeedbackImageUrl(report);
  const [open, setOpen] = useState(false);
  const box =
    "grid h-24 w-full shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-surface-2 sm:w-36";
  if (!report.screenshotPath) return null;
  if (url === null)
    return (
      <div className={`${box} text-faint`} role="img" aria-label="Screenshot unavailable">
        <ImageOff className="size-5" aria-hidden="true" />
      </div>
    );
  if (url === undefined) return <div className={`${box} animate-pulse`} aria-hidden="true" />;
  return (
    <>
      <button
        type="button"
        className={`${box} cursor-pointer focus-visible:outline-2 focus-visible:outline-ring`}
        onClick={() => setOpen(true)}
        aria-label="Open the screenshot"
      >
        <img
          {...sensitive("photo")}
          src={url}
          alt=""
          className="size-full object-cover object-top"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Screenshot</DialogTitle>
            <DialogDescription>
              <Sensitive kind="name">{report.senderName}</Sensitive>, {when(report.createdAt)}
            </DialogDescription>
          </DialogHeader>
          <img
            {...sensitive("photo")}
            src={url}
            alt="What the sender was looking at"
            className="w-full rounded-lg border border-line"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
