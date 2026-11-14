# Agent connector (plan, 2026-11-14)

**Status**

- Phase 1 (database, function, six tools): **BUILT** when the pull request "Agent connector: pairing, connection keys and the first six tools" is merged.
- Phase 2 (Settings card with the "Add agent" button, connection list, disconnect, activity; the leader's switch in Team settings): **NOT STARTED**. Ask the owner before beginning it.
- Phase 3 (more tools: pipeline moves short of the registered step, learning log, own profile fields, customers): **NOT STARTED**. Ask the owner before beginning it.

## What it is

Each person on a team can connect the AI agent of their choice, any agent that can make HTTP requests and keep a secret (with or without MCP), so the agent manages that person's own and team data by conversation: add or change prospects, answer whether they are going to an event, and so on. The app exposes data and actions and leaves the acting in other services (their calendar, their messages) to the person's own agent; it builds no integration for things an agent can do with its own connections.

It stays inside Supabase, with nothing extra to run or pay for: one Edge Function per team's project, off until the team switches it on. A team without a Supabase project (browser-storage demo) has no connector.

## Decisions

- **Pairing, not tokens.** The person presses one button and gets a one-time code (ten minutes, single use). They paste a short text with the connector URL and the code to their agent. The agent POSTs the code to the connector and gets its own opaque **connection key** (shown once, stored only as a SHA-256 hash). The person never handles the key; no username is involved (a username in a command would let anyone trigger prompts on someone's screen).
- **The key is not a JWT.** It means something to one Edge Function only, which looks it up by hash. An agent never holds a Supabase user token: an earlier prototype showed that such a token can reach the auth API (set a password, enrol a factor), which no check in our code can gate. That design is dropped for good.
- **A whitelist, in one place.** Everything an agent can do is a SQL function named `agent_*` (`supabase/migrations/20261025000200_agent_tools.sql`), SECURITY INVOKER, run as the person (`set local role authenticated` with the person's login in the claims), so the existing row-level security decides what they may see and change. Every call writes an audit row. No deletes, ever; never stage, sponsor, IBO#/LTD# or the business start date.
- **A least-privilege database role.** The function connects as `agent_connector` (NOLOGIN until a deployment sets its password), which owns nothing, has no table privilege and can only call five `agent_private` functions and `set role authenticated`. The guard checks `session_user`, so an ordinary app session cannot call a tool.
- **Switch and preview.** The team's leader (or a deputy) switches the feature on (`feature_switches` row `agents`); an app admin may use it before that, like the other switched features. Turning it off, revoking a connection or demoting the person cuts an agent off on its very next call.
- **Two surfaces over one code path.** MCP over Streamable HTTP (`/mcp`) and plain HTTP (`GET /tools`, `POST /tools/<name>`) for agents that cannot do MCP, both through one `runTool()`.
- **Apps that only connect through their own sign-in screen** (the Claude and ChatGPT apps) are not served by this flow: that would mean writing an authorization server. Not built unless the owner asks.

How it works, the tables, the role and the per-deployment steps: [`docs/backend.md`](../backend.md), "Agent connector".

## Phase 1: built

Migrations `20261025000100_agent_connector` and `20261025000200_agent_tools`; Edge Function `supabase/functions/agent`; pgTAP `040`–`044`; vitest for the function (`supabase/functions/agent/*.test.ts`) and the integration test `tests/integration/agentConnector.test.ts` over a real login as the connector role; docs.

Choices worth knowing:

- The MCP side is a small stateless JSON-RPC handler (initialize, ping, tools/list, tools/call), not an SDK: no extra dependency, nothing to bundle, and it is testable without Deno.
- Unknown tools (404), unreadable or oversized bodies and unknown keys are refused before the database and not audited (nothing to attribute them to). Invalid arguments (400) for a known tool, including a field outside the whitelist such as `stage` or `sponsor`, ARE audited as a refusal (arguments kept only when small), found by the end-to-end run: an agent trying to change something the connector never changes should leave a trace. Every call that reaches a tool, or is refused for access or argument reasons, writes exactly one audit row.
- The audit reader is the connected person only. A leader does not read her team's audit rows (they hold people's details).
- `database.types.ts` was not regenerated in this phase: no app code reads the new tables yet. Run `npm run db:types` with phase 2.

## Phase 1: verified end to end

Run on a throwaway hosted Supabase project (free plan, the real pooler, the real Edge runtime) on 2026-11-14: pairing, row-level security through HTTP and MCP, access levels, cut-off (revoke, team switch, app-admin preview, demotion), the key refused at every other endpoint, audit counts, MCP protocol behaviour, a real client (`claude mcp add --transport http` then `claude mcp list`: connected) and latency (warm about 100 ms per call on a kept-alive connection, 150 ms with a new connection each time, cold first call about 350 ms). Two defects came out of it and are fixed with tests: an argument-rejected call left no audit row, and a refused body over 64 KB left the gateway's connection hanging for the next request.

Known differences from the MCP 2025-11-25 Streamable HTTP text, none of which a client trips over (Claude Code connects): the `MCP-Protocol-Version` header is not checked (the spec says answer 400 for an unsupported one); the `Origin` header is not checked (the spec says 403 for an invalid one; this server has no CORS and needs a bearer key a browser page cannot hold); JSON-RPC batches are accepted (allowed in 2025-03-26, dropped later); a JSON-RPC response sent by a client gets an error instead of 202 (a stateless server never asks the client anything); `Accept` is not enforced; GET and DELETE on `/mcp` answer 405, which the spec allows; a 401 carries no OAuth discovery document (`/.well-known/...` is 404), so a client holding a revoked key reports it needs authentication.

## Phase 2: not started

- **Settings card** (for everyone who may use it, from `my_agent_access()`): the **Add agent** button with a choice of "can read and change my CRM data" or "only read my CRM data"; it calls `create_agent_pairing` and shows the text below with a Copy button and the code's expiry; the list of connections (label, access, created, last used, revoked) read from `agent_connections` (named columns), **Disconnect** (`revoke_agent_connection`), and **Activity** (the person's own `agent_audit` rows).
- **The leader's switch** in Team settings (`feature_switches` 'agents'), beside the existing switches, with `FeatureKey` gaining `agents`.
- Regenerate `src/data/remote/database.types.ts`.
- Integration tests for the card against the local stack; the browser-storage demo shows no card (no connector there).

## Phase 3: not started

More tools, each one function + one registry entry + tests (see "Adding a tool"): pipeline moves short of the registered step (through `move_pipeline_card`, never the Registered stage), the learning log (through the existing finish-an-item path so it logs once), the person's own profile fields (never stage, sponsor, IBO#/LTD#, business start date), customers. Before any tool that writes beyond what phase 1 does, the owner decides.

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
