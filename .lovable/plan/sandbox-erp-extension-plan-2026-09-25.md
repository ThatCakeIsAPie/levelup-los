# Sandbox ERP extension plan

Extends the current app (Mindmap, People, Events) without renaming pages or changing the visual style. Everything runs in the browser with saved local data, seeded with one shared demo dataset. Delivered in 4 phases so each can be checked before the next.

## Phase 1 — Foundation and fixes
- **One data layer** (`db.ts`): every read and write goes through named functions (getPeople, getCustomers, saveInvoice, logContact...). Data is saved in the browser and seeded on first load. The Mindmap, People, Customers and Events all use the same named people (Maria Reyes, Anita Patel, Jamal Brown, Beau Foster, David Chen...).
- **Demo login**: a "Log in as" page with 4 users: Maria (leader), Anita (IBO), Jamal (apprentice), Beau (candidate, shown as "Prospect" on the business path). A user menu shows who is logged in, with Log out and **Reset demo data**.
- **Visibility rules** enforced in the data layer: a leader sees their downline; an IBO sees only their own team and customers; an apprentice sees their own world, with limits labeled on screen; a candidate sees only their own journey and events.
- **Fixes**: the card "More" menu gets View person and Edit person. The /people/:id and /events/:id detail pages open on their own instead of showing the list. The Lovable badge moves away from the zoom "+" button.

## Phase 2 — Customers, Dashboard, Team care
- **Customers page** (IBO-private): name, phone, email, product and date bought, date acquired, last contact. Each row has one-click "Log sale" and "Log contact" buttons. Each demo IBO gets their own customers.
- **Dashboard** (new home page): log learning (podcasts, pages read, workshops or conferences, each with a title and date). Shows this week and this month totals plus streaks. Leaders also get a team rollup.
- **Due for contact**: customers not contacted in X days (setting, default 30).
- **Team care**: a "Last connected" column and one-click check-in on People. Team members not contacted in X days (setting, default 14) get flagged on the Dashboard. Seed dates vary so the reminders show up.

## Phase 3 — Events, tickets, travel, money
- **Events page**: split into Upcoming (this year) and Past.
- **Event detail page**: shows the attendee list. Each person sets their own ticket status: "Bought", or "Not yet, I plan to buy by [date]". The app only tracks tickets and never sells them.
- **Travel plan per attendee**: fly or drive; flight booked yes or no; carpool with a teammate, someone from another team, or solo; van or bus with an organizer, plus paid yes or no or a planned pay date.
- **Shared costs**: a leader creates a shared cost (name, total, event). People opt in. Invoices split the cost evenly by default, and the leader can change any person's amount.
- **Wallet page**: shows what you owe and what you've paid. "Pay now" marks the invoice "Paid (sandbox)" with a timestamp and a `sandbox-...` reference. Card and bank details are never stored.

## Phase 4 — Campaigns, Reports, Mindmap toggle
- **Campaigns**: choose audience (my customers), type (email, text, voice note), write the message, then send now or schedule. History is kept. Sends go into a "Pending send — will go out when a messaging provider is connected" queue.
- **Reports page**: activity, customer contact, event attendance, and owed vs paid. Each downloads as a CSV. Weekly or monthly sending to your upline is saved and labeled "Will activate when email is connected".
- **Mindmap view switch**: "Team" (default) or "Customers", which shows the selected person's customers as a tree.
- **Final pass**: click through every button, link and menu item to confirm none are dead, then a page-by-page walkthrough for you.

## Technical details
- `src/lib/db.ts` wraps the Zustand stores with persist to localStorage, plus a seed version and `resetDemo()`. New stores: session, customers, sales, contacts, learning, settings, tickets, travel, sharedCosts, invoices (with `paymentReference`, and no card or bank fields), campaigns, reportSchedules.
- The demo mindmap rows are generated from the shared roster, so ids and names match.
- Scoping: `visiblePeople(session)` and `visibleCustomers(session)` go through downline or owner checks.
- Detail-page fix: turn `people.tsx` and `events.tsx` into layouts with `<Outlet />`, and move the lists into `people.index.tsx` and `events.index.tsx`. Login lives at `/login`. The Dashboard becomes `/`. New routes: `/customers`, `/campaigns`, `/wallet`, `/reports`, each with its own head() tags.
- Pages without a logged-in user redirect to `/login` on the client.
- The badge is hidden through publish settings, or the zoom controls get a bottom offset.
