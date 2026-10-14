import { ExternalLink, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AuthHeading, StatusIcon } from "./AuthLayout";

/** Local Supabase's email catcher (Mailpit), for development builds. */
const DEV_MAILBOX = "http://localhost:54324";

/** "Check your email" after a sign-in, sign-up or reset link was sent. */
export function SentPanel({
  email,
  kind,
  onBack,
}: {
  email: string;
  kind: "signin" | "reset" | "confirm";
  onBack: () => void;
}) {
  const what =
    kind === "reset"
      ? "a link to set a new password"
      : kind === "confirm"
        ? "a link to confirm your email"
        : "a sign-in link";
  return (
    <div className="grid gap-5" aria-live="polite">
      <StatusIcon icon={MailCheck} />
      <AuthHeading title="Check your email">
        <p>
          We sent {what} to <span className="font-semibold text-foreground">{email}</span>. Open it
          on this device to continue. It can take a minute to arrive; check your spam folder if it
          doesn't.
        </p>
      </AuthHeading>

      {import.meta.env.DEV && (
        <p className="rounded-[10px] bg-info-soft px-3 py-2.5 text-[12.5px] text-info-ink">
          In local development no real email is sent. Open{" "}
          <a
            href={DEV_MAILBOX}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
          >
            {DEV_MAILBOX}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>{" "}
          to see it.
        </p>
      )}

      <div>
        <Button variant="outline" onClick={onBack}>
          Use a different email
        </Button>
      </div>
    </div>
  );
}
