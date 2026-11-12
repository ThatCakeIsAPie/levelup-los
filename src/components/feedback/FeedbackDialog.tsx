import { useEffect, useMemo, useState } from "react";
import { ImageOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FEEDBACK_LOCAL_ONLY,
  FEEDBACK_MAX_LENGTH,
  feedbackMessageError,
  sendFeedback,
} from "@/data";
import { closeFeedback, useFeedbackFlow } from "./feedbackFlow";

/** The one feedback dialog (rendered by the shell). Opens after the snapshot is taken. */
export function FeedbackDialog() {
  const flow = useFeedbackFlow();
  const open = flow.phase === "open";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeFeedback()}>
      {flow.phase === "open" && (
        <FeedbackForm key={flow.id} id={flow.id} context={flow.context} snapshot={flow.image} />
      )}
    </Dialog>
  );
}

/** A preview URL for the snapshot blob, revoked when it goes away. */
function usePreviewUrl(blob: Blob | null): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function FeedbackForm({
  id,
  context,
  snapshot,
}: {
  id: string;
  context: Parameters<typeof sendFeedback>[0]["context"];
  snapshot: Blob | null;
}) {
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<Blob | null>(snapshot);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const preview = usePreviewUrl(image);
  const problem = feedbackMessageError(message);
  const tooLong = message.trim().length > FEEDBACK_MAX_LENGTH;
  const showProblem = !!problem && (touched || tooLong);

  async function send() {
    setTouched(true);
    if (problem || sending) return;
    setSending(true);
    setError(null);
    try {
      await sendFeedback({ id, message, context, image });
      closeFeedback();
      if (FEEDBACK_LOCAL_ONLY)
        toast.success("Saved in this browser only", {
          description: "This demo has no server, so nobody else will see your feedback.",
        });
      else toast.success("Thanks, your feedback was sent");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Couldn't send your feedback.");
      setSending(false);
    }
  }

  return (
    <DialogContent
      className="max-h-[90dvh] overflow-y-auto"
      onInteractOutside={(e) => sending && e.preventDefault()}
      onEscapeKeyDown={(e) => sending && e.preventDefault()}
    >
      <DialogHeader>
        <DialogTitle>Send feedback</DialogTitle>
        <DialogDescription>Tell us what you would like changed.</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="feedback-message">What would you like changed?</Label>
          <Textarea
            id="feedback-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={5}
            autoFocus
            disabled={sending}
            aria-invalid={showProblem}
            aria-describedby="feedback-message-help"
            placeholder="For example: show the phone number on the pipeline cards"
          />
          <div
            id="feedback-message-help"
            className="flex items-start justify-between gap-3 text-xs"
          >
            <span className={cn("text-bad", !showProblem && "invisible")}>
              {problem ?? "\u00a0"}
            </span>
            <span
              className={cn("shrink-0 tabular-nums text-muted-foreground", tooLong && "text-bad")}
            >
              {message.trim().length} / {FEEDBACK_MAX_LENGTH}
            </span>
          </div>
        </div>

        {image && preview ? (
          <div className="grid gap-2">
            <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
              <img
                src={preview}
                alt="Snapshot of the page you were on"
                className="mx-auto max-h-52 w-full object-contain"
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                A snapshot of this page is attached. Names and contact details are blacked out.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={sending}
                onClick={() => setImage(null)}
              >
                <ImageOff aria-hidden="true" /> Remove screenshot
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No screenshot will be sent.</p>
        )}

        <p className="text-xs text-muted-foreground">
          {FEEDBACK_LOCAL_ONLY
            ? "This demo has no server. Your report is saved in this browser only, and the admin login here can read it."
            : "Your name, message and screenshot go to the app's admins. Nobody else sees them."}
        </p>

        {error && (
          <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={sending} onClick={closeFeedback}>
            Cancel
          </Button>
          <Button type="submit" disabled={sending || showProblem}>
            {sending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
