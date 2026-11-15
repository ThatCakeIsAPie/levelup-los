# Agent connector (plan, 2026-11-14)

**Status**

- Phase 1 (database, function, seven tools): **BUILT** when the pull request "Agent connector: pairing, connection keys and the first seven tools" is merged.
- Phase 2 (Settings card with the "Add agent" button, connection list, disconnect, activity; the leader's switch in Team settings): **BUILT** when the pull request "Settings: connect an AI agent" is merged.
- Phase 3a (the people and personal tools: `list_team`, `list_customers`, `get_person`, `update_my_profile`, `log_learning`, `list_learning`, and `list_prospects` / `whoami` extended): **BUILT** when the pull request "Agent connector: team, customers, profile and learning tools" is merged.
- Phase 3b (pipeline moves short of the registered step, customers add and update, check-ins): **NOT STARTED**. Ask the owner before beginning it.

## What it is

Each person on a team can connect the AI agent of their choice, any agent that can make HTTP requests and keep a secret (with or without MCP), so the agent manages that person's own and team data by conversation: add or change prospects, answer whether they are going to an event, and so on. The app exposes data and actions and leaves the acting in other services (their calendar, their messages) to the person's own agent; it builds no integration for things an agent can do with its own connections.

It stays inside Supabase, with nothing extra to run or pay for: one Edge Function per team's project, off until the team switches it on. A team without a Supabase project (browser-storage demo) has no connector.

## Decisions

- **Pairing, not tokens.** The person presses one button and gets a one-time code (ten minutes, single use). They paste a short text with the connector URL and the code to their agent. The agent POSTs the code to the connector and gets its own opaque **connection key** (shown once, stored only as a SHA-256 hash). The person never handles the key; no username is involved (a username in a command would let anyone trigger prompts on someone's screen).
- **The key is not a JWT.** It means something to one Edge Function only, which looks it up by hash. An agent never holds a Supabase user token: an earlier prototype showed that such a token can reach the auth API (set a password, enrol a factor), which no check in our code can gate. That design is dropped for good.
- **A whitelist, in one place.** Everything an agent can do is a SQL function named `agent_*` (`supabase/migrations/20261105000200_agent_tools.sql`), SECURITY INVOKER, run as the person (`set local role authenticated` with the person's login in the claims), so the existing row-level security decides what they may see and change. Every call writes an audit row. No deletes, ever; never stage, sponsor, IBO#/LTD# or the business start date.
- **A least-privilege database role.** The function connects as `agent_connector` (NOLOGIN until a deployment sets its password), which owns nothing, has no table privilege and can only call five `agent_private` functions and `set role authenticated`. The guard checks `session_user`, so an ordinary app session cannot call a tool.
- **Switch and preview.** The team's leader (or a deputy) switches the feature on (`feature_switches` row `agents`); an app admin may use it before that, like the other switched features. Turning it off, revoking a connection or demoting the person cuts an agent off on its very next call.
- **What a tool returns follows the receiving standard.** An agent is meant to be a slightly more intelligent proxy than a script, so data maps onto the receiving service's own standard with nothing to guess, and each tool's description names that standard. Events are iCalendar (RFC 5545): `uid`, `summary`, exclusive all-day ends, local time plus the team's zone plus UTC instants, a repeating event as one series with an RRULE (equal to the app's rule date for date) and exceptions that name the slot they replace; `export_events_ics` writes the same window as a file. Timed repeating events are one entry with a VTIMEZONE built from the database's zone data when that can be proven for 31 years, otherwise separate UTC events. Contacts would be vCard and tasks VTODO when those tools come.
- **Two surfaces over one code path.** MCP over Streamable HTTP (`/mcp`) and plain HTTP (`GET /tools`, `POST /tools/<name>`) for agents that cannot do MCP, both through one `runTool()`.
- **Apps that only connect through their own sign-in screen** (the Claude and ChatGPT apps) are not served by this flow: that would mean writing an authorization server. Not built unless the owner asks.

How it works, the tables, the role and the per-deployment steps: [`docs/backend.md`](../backend.md), "Agent connector".

## Phase 1: built

Migrations `20261105000100_agent_connector` and `20261105000200_agent_tools` (numbered after everything on `main`, so a database that has applied `main` takes them in order); Edge Function `supabase/functions/agent`; pgTAP `040`–`044` and `046`; vitest for the function (`supabase/functions/agent/*.test.ts`) and the integration test `tests/integration/agentConnector.test.ts` over a real login as the connector role; docs.

Choices worth knowing:

- The MCP side is a small stateless JSON-RPC handler (initialize, ping, tools/list, tools/call), not an SDK: no extra dependency, nothing to bundle, and it is testable without Deno.
- Unknown tools (404), unreadable or oversized bodies and unknown keys are refused before the database and not audited (nothing to attribute them to). Invalid arguments (400) for a known tool, including a field outside the whitelist such as `stage` or `sponsor`, ARE audited as a refusal (arguments kept only when small), found by the end-to-end run: an agent trying to change something the connector never changes should leave a trace. Every call that reaches a tool, or is refused for access or argument reasons, writes exactly one audit row.
- The audit reader is the connected person only. A leader does not read her team's audit rows (they hold people's details).
- `database.types.ts` was not regenerated in this phase: no app code read the new tables yet. Phase 2 adds them to the file by hand (see "Phase 2: built").

## Phase 1: verified end to end

Run on a throwaway hosted Supabase project (free plan, the real pooler, the real Edge runtime) on 2026-11-14: pairing, row-level security through HTTP and MCP, access levels, cut-off (revoke, team switch, app-admin preview, demotion), the key refused at every other endpoint, audit counts, MCP protocol behaviour, a real client (`claude mcp add --transport http` then `claude mcp list`: connected) and latency (warm about 100 ms per call on a kept-alive connection, 150 ms with a new connection each time, cold first call about 350 ms). Two defects came out of it and are fixed with tests: an argument-rejected call left no audit row, and a refused body over 64 KB left the gateway's connection hanging for the next request.

Protocol hardening after the run: an unsupported `MCP-Protocol-Version` is 400; any request with an `Origin` header is 403 on every route (no browser is a supported client); a JSON-RPC response or notification sent by the client is 202 with no body. Known differences from the MCP 2025-11-25 Streamable HTTP text, none of which a client trips over (Claude Code connects): JSON-RPC batches are accepted (allowed in 2025-03-26, dropped later); `Accept` is not enforced; GET and DELETE on `/mcp` answer 405, which the spec allows; a 401 carries no OAuth discovery document (`/.well-known/...` is 404), so a client holding a revoked key reports it needs authentication.

## Phase 2: built

The app side only: no database or function change. What is in it, and the choices worth knowing (the screen-by-screen description is in [`frontend-guide.md`](../frontend-guide.md), Settings, "AI agents"):

- **Settings card** `AI agents` (`src/modules/settings/AgentsCard.tsx`): shown only with the hosted data source and only when `my_agent_access()` allows the person (team switch on, or an app admin's preview, and a registered person); otherwise nothing at all. One button, `Add agent`, which calls `create_agent_pairing('write')` and opens a dialog with the text above (with the connector URL, the code, the access line and the minutes), a `Copy` button and one `Read only` switch that asks for a new code at the other level. The text is built by `pairingText()` and a test compares it with the block in this file, so the wording cannot drift. The dialog looks for the new connection every 3 seconds (a plain select, stopped when the dialog closes or after 10 minutes) and then shows the agent's label and `Connected`.
- **The list** under the button: the person's non-revoked connections, newest first (label as plain text, access, created, last used), `Disconnect` behind the app's confirm dialog, and per connection the 20 newest audit rows loaded on expand (tool in plain words, time, result line, a refusal marked, and a prospect's name for the prospect tools, marked as sensitive so feedback snapshots black it out).
- **The leader's switch**: `agents` joins `FeatureKey` / `FEATURES` with the label `AI agents`, so it appears in the existing switch list in Team settings and works like the others. `FeatureInfo.hosted` marks a feature that needs the hosted data source; `featuresFor(source)` is what Team settings and the admin card list, so the browser-storage demo offers neither the switch nor the card.
- **No new copy**: no helper text, hints or empty-state lines; the words are the button and dialog labels, the access words, the feature label and accessible names.
- `src/data/remote/database.types.ts` gained the four tables and the connector's functions by hand (regenerating needs Docker, as before); regenerate it with `npm run db:types` when a local stack is at hand and the diff should be empty.
- Not built here: integration tests for the card against the local stack (they need Docker, and the pull request changes no database object). The unit tests cover the text, the access gate, the tool labels, the polling and the feature list in both data sources; the card was driven end to end against a throwaway hosted project (pull request description).

## Phase 3a: built

Why: the owner's first agent paired, called `whoami`, called `list_prospects` three times (no prospects yet, only registered members) and told him it could not see his downline, because there was no tool for the team. Migration `20261106000100_agent_people_tools`, registry entries in `supabase/functions/agent/tools.ts`, pgTAP `047`-`049` (`042` and `043` updated), vitest, the integration test, and two small app changes (plain-word labels for the new tool names in `src/data/agents/rules.ts`; the activity row shows the name for `get_person`, marked sensitive like the prospect tools'). The tool list and what each returns: [`backend.md`](../backend.md), "Agent connector".

Choices worth knowing:

- **Contacts are vCard.** `full_name` (FN), `phone` (TEL), `email` (EMAIL), `location` (ADR locality and region as one text), `notes` (NOTE), in every tool that has them; each description says so in one clause. `add_prospect` and `update_prospect` keep their `name` argument (they are unchanged; renaming would break an agent that saved the old call).
- **Never exposed.** IBO and LTD numbers are in no result and no write (no query selects them; a test looks for the fixture values in every answer and audit row). Never writable: stage, sponsor, owner, business start date, pipeline stage, stage history, tags, monthly volume. `update_my_profile` refuses every other field by name (also in SQL, whatever the function checked first). No deletes.
- **Customers are private to their owner**, leaders included (`visible_person_ids()`, `visibleCustomers()` in the app). `list_customers(mine_only)` is therefore the same list either way; the argument exists because the brief asked for it, and the description says so. If the rule ever changes, the argument starts to mean something.
- **Empty lists explain themselves** in `note` ("You have no registered team members under you yet.", "No prospects yet. Use add_prospect to add one; registered team members are in list_team."), because an empty list with no explanation made the first agent retry. A search with no match and an offset past the end have their own notes.
- **Learning follows the app's form** (kinds, units, amount a whole number, `Unnamed`) and the table's constraint, and a pgTAP case table proves the tool and `learning_unit_fits_kind` agree on every kind and unit. The app's form puts no limit on the date; the tool refuses the future (against the team's today) and anything before 2000-01-01 (a typo guard), and an amount above 100000 (the weekly goal's own cap). Not deduplicated: two calls make two entries.
- **`list_learning` shows the caller's own entries** although row-level security lets a person read their downline's; the window defaults to the last 30 days.
- **One query for the team, no N+1** (`agent_private.team()`); numbers in the backend guide.
- **Replaced, not edited.** The shipped connector migrations are untouched; `agent_list_prospects(int)` is dropped and replaced by a three-argument function, `agent_whoami()` by `create or replace`. A function deployed before the migration, or the migration before the function, makes `list_prospects` fail until both are in place (see the per-deployment steps in the pull request).
- **Not built here:** a duplicate guard for `log_learning`; any write for a customer, prospect pipeline stage or contact log (3b).

## Phase 4: card tasks and notes (part 1 BUILT when merged; part 2 NOT STARTED)

Why: the owner wants a card to work like a Basecamp card: a checklist of tasks with due dates (for example "Text Nik to confirm the Nov 19 info session"), a running log of notes with timestamps, tasks assignable to a person, on every pipeline card on both boards, reachable by the connected agent. Migration `20261108000100_card_tasks`, registry entries in `supabase/functions/agent/tools.ts`, pgTAP `051` and `052` (`043` and `047` updated), vitest, the integration test, and the seven plain-word tool labels in `src/data/agents/rules.ts`. The tables, the rules and the tool list: [`backend.md`](../backend.md), "Card tasks and notes" and "Agent connector".

Choices worth knowing:

- **Card tasks and notes, on the existing cards.** Not a new kind of record: a task or note belongs to a prospect's card (recruiting board) or a list name's card (customer board). The rows point at the prospect or the list name, so a card that never moved (no stored row) can have them, and they go with the card's subject by cascade. The rules are the cards' own: whoever may read a card reads its tasks and notes, whoever may edit it edits its tasks, and an upline therefore sees and can assign tasks on a team member's cards; customers stay private to their owner because the customer board shows list names, not customer records.
- **The card's due date is `next_due`**: the earliest due date among its open tasks, with its time when that task has one. There is no due-date or assignee column on the cards. The tools say so in their descriptions.
- **A task's assignee** is the card's owner (by default, also when null) or the person who sets it, so an upline can hand a task to a team member on a card of theirs, and take one on themself.
- **Times are the team's**: `due_time` is a wall-clock time in the team's time zone (as `events.start_time`); "today", "now" and "overdue" are the team's, never the server's. A task with a date and no time is due at the end of that day. A past date is allowed.
- **Shaped for the receiver**: a task is returned as an iCalendar VTODO (RFC 5545) with the CRM's own fields beside it, the way events are returned as VEVENTs (stable `uid`, `summary`, `due` as a date or a local date-time with `timezone` and `due_utc`, `status` NEEDS-ACTION / COMPLETED, `completed`, `created`, `last_modified`). Each description also names the other words people use for a card's tasks, so an agent asked for one of those finds the tools.
- **No deletes by an agent**, no tool changes a card, its column or its booking, and none reads or writes the booking columns or the card's old note box (a pgTAP assertion proves the stored cards are byte-identical after every call).
- **Rows can be written without a signed-in person** (part 2's migration copies existing bookings and card notes into `card_tasks` and `card_notes` as the migration role): `created_by`, `done_by`, `assignee_id` and `author_id` are nullable, and the guard triggers skip the who-may-do-what checks for a writer that is not `authenticated`; pgTAP `051` proves both that insert and its refusal for a signed-in person who cannot edit the card.
- **Not built here**: `changed_since` reports changed tasks only, not deleted ones (no deletion log, and a new table was not worth it); no tool for reordering tasks.

Part 1 is the database and the connector. **Part 2: NOT STARTED** (needs the owner's say-so before it is begun): the app (tasks count, earliest open due date, notes count and assignee on each card's face on both boards; tasks and notes in the card sheet; tasks due in Home's Today card; a notification when a task is assigned to you) AND removing the booked next step (each existing booking copied into a card task, the old columns kept unused).

## Phase 3b: not started

Pipeline moves short of the registered step (through `move_pipeline_card`, never the Registered stage), customers (add and update), check-ins (through the existing contact log). Before any tool that writes beyond what phases 1 and 3a do, the owner decides.

## The text the button will show (final wording)

`{CONNECTOR}` is the function URL (`https://<ref>.supabase.co/functions/v1/agent`), `{CODE}` the one-time code, `{ACCESS}` is `read and change my CRM data` or `only read my CRM data`, `{MINUTES}` is 10. Nothing has to be fetched from a web page: an agent is never told to obey a page.

```text
Please connect to my team CRM. I just created a one-time pairing code; it works once and expires in {MINUTES} minutes.
Connector: {CONNECTOR}
Pairing code: {CODE}
Access: {ACCESS}
1. POST {CONNECTOR}/pair with JSON {"code": "<the code>", "label": "<a name for yourself>"}. The reply holds your connection key, shown only once.
2. Store the key as a secret. Never show it, print it, or write it into notes or chat. It works only at this connector, and I can disconnect it in the CRM at any time.
3. If you support MCP, register {CONNECTOR}/mcp as a remote HTTP MCP server with the header "Authorization: Bearer <your key>" (the /pair reply has ready-made setup lines). Otherwise call GET {CONNECTOR}/tools and POST {CONNECTOR}/tools/<name> with a JSON body, sending the same header.
4. Save a short private note or skill: the connector URL, the tool names, how to call them, and where the key is stored (never the key itself).
5. Call the whoami tool and tell me which name you are connected as.
```

Why it reads this way: the agent gets everything as plain data in the person's own message; the code is useless after one use or ten minutes; the key goes straight from the connector to the agent over HTTPS and never passes through the person or the app; the text says what the key can do and that the person can cut it off.
