/**
 * The "where to buy a ticket" link on an event: the bigger team's ticket page,
 * a Venmo link for a small meeting, and so on. Only http(s) links are kept
 * (the database checks the same), so opening one can never run script.
 */

/** Longest link we store (matches the events.ticket_url check). */
export const MAX_TICKET_URL = 2000;

/**
 * The link to store for what someone typed, or null when it isn't a usable
 * web link. A bare "venmo.com/u/levelup" gets https:// in front.
 */
export function cleanTicketUrl(input: string | undefined | null): string | null {
  const raw = (input ?? "").trim();
  if (!raw || /\s/.test(raw)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname.includes(".")) return null;
  const out = url.toString();
  return out.length <= MAX_TICKET_URL ? out : null;
}

/** "venmo.com" for showing where a link goes. */
export function ticketHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
