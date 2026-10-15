import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanTicketUrl, ticketHost, type CrmEvent } from "@/data";

/**
 * "Buy ticket": opens the event's ticket link (team site, Venmo...) in a new
 * tab. Renders nothing when the event has no usable link.
 */
export function BuyTicketButton({
  event,
  variant = "default",
  size,
  className,
}: {
  event: Pick<CrmEvent, "ticketUrl">;
  variant?: "default" | "outline" | "soft";
  size?: "sm" | "default";
  className?: string;
}) {
  const url = cleanTicketUrl(event.ticketUrl);
  if (!url) return null;
  const host = ticketHost(url);
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        Buy ticket
        <ExternalLink aria-hidden="true" />
        <span className="sr-only"> (opens {host || "the ticket page"} in a new tab)</span>
      </a>
    </Button>
  );
}
