-- Where people buy a ticket for an event (client: CrmEvent.ticketUrl).
--
-- A link the event's organiser pastes in: the bigger team's ticket page, a
-- Venmo link for a small meeting, and so on. The app shows a "Buy ticket"
-- button that opens it. Only http(s) links are allowed, so a stored value can
-- never run script when it's opened.

alter table public.events
  add column ticket_url text
    check (ticket_url is null or (ticket_url ~* '^https?://[^\s]+$' and length(ticket_url) <= 2000));
