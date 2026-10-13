# Backend (Supabase)

The database for LevelUp LOS: Postgres with row-level security (RLS), auth, storage and realtime, run locally with the Supabase CLI in Docker. It holds all the app's data: the CRM (people, events, attendance, travel, shared costs, contacts, sales, learning, activity, campaigns) and chat. The agreed plan is [`plans/messaging-and-backend-plan-2026-10-12.md`](plans/messaging-and-backend-plan-2026-10-12.md); its "Chat data contract" is implemented field for field.

The GitHub Pages demo does not use any of this: it keeps running on browser storage (`VITE_DATA_SOURCE=local`). With `VITE_DATA_SOURCE=supabase` the app loads everything from here after sign-in and writes every change back (see [Run the app against the local database](#run-the-app-against-the-local-database) and the frontend guide's "Two data sources").

## Run it locally

Needs Docker Desktop running. Everything else comes from `npm install` (the `supabase` CLI and `tsx` are devDependencies).

| Command                    | What it does                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run db:start`         | Start the local stack (first run pulls the Docker images).                                                                                             |
| `npm run db:stop`          | Stop it. Data is kept in Docker volumes.                                                                                                               |
| `npm run db:reset`         | Regenerate `supabase/seed.sql`, then drop and recreate the database: all migrations plus the seed. Dates are relative to the moment you run it.        |
| `npm run db:seed`          | Only regenerate `supabase/seed.sql` and `supabase/tests/001_visibility_parity.test.sql` from the TypeScript seeds.                                     |
| `npm run db:test`          | Run the pgTAP tests in `supabase/tests` against the running database.                                                                                  |
| `npm run db:types`         | Regenerate `src/data/remote/database.types.ts` from the running database. Run it after changing a migration.                                           |
| `npm run test:integration` | The app's sync layer against the running, seeded database (sign-in as the demo users, load, write-through, realtime, storage). Not part of `npm test`. |

Local endpoints (the CLI's default ports):

| Service                                       | URL                                                       |
| --------------------------------------------- | --------------------------------------------------------- |
| API (REST, auth, realtime, storage via Kong)  | http://127.0.0.1:54321                                    |
| Postgres                                      | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Mailpit (catches magic-link and invite email) | http://127.0.0.1:54324                                    |

`npx supabase status` prints the local anon key (the CLI's public development key, the same on every machine). Put it in `.env.local` (gitignored), as shown in `.env.example`:

```
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_ANON_KEY=<ANON_KEY from npx supabase status>
```

### A slimmed stack

To keep memory use low (about 0.6–0.7 GB in total), `supabase/config.toml` runs only what the app needs:

- **On:** Postgres (`db`), auth (GoTrue), REST (PostgREST), realtime, storage, Kong (the API gateway) and Mailpit (local email).
- **Off:** Studio, analytics (Logflare and Vector), the edge-functions runtime, imgproxy (storage image transformation), storage's S3 protocol and vector buckets, and the connection pooler.

To browse tables, connect any Postgres client to port 54322, or set `[studio] enabled = true` and restart. `npm run db:test` runs a short-lived `pg_prove` container, and `npm run db:types` runs a short-lived `postgres-meta` container.

Auth config: email sign-in with magic link and with password, and no email confirmation locally. `site_url` is http://localhost:5173, and redirects are allowed for http://localhost:5173 through 5190.

### Run the app against the local database

1. `npm run db:start` (Docker Desktop running), then `npm run db:reset` for a fresh seed (dates are relative to now).
2. `.env.local` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (above). It may keep `VITE_DATA_SOURCE=local` for the demo; override it per run instead:
   ```
   VITE_DATA_SOURCE=supabase npm run dev -- --port 5180 --strictPort --host localhost
   ```
   (PowerShell: `$env:VITE_DATA_SOURCE="supabase"; npm run dev -- --port 5180 --strictPort --host localhost`.)
3. Open http://localhost:5180/login and pick a demo account (development builds list them; password `levelup-local`), or use a magic link from Mailpit. "Loading your team…" shows while the person's data loads.
4. To see live chat, sign in as a second person in another browser profile (or a private window): the two can't share one browser profile, because the session is kept in `localStorage`.

Nothing is written to the demo's `levelup.*` storage keys in this mode, so switching `VITE_DATA_SOURCE` back and forth never mixes demo and real data.

## Demo logins (local only)

The seed creates an auth user for each demo user, linked to their CRM person. **Password for all of them: `levelup-local`** (local development only; the seed is never pushed to a hosted project). Magic links also work: open the email in Mailpit.

| Email                | Person           | Team role | App role (`get_session().app_role`) |
| -------------------- | ---------------- | --------- | ----------------------------------- |
| `maria@levelup.test` | Maria Reyes (1)  | leader    | leader                              |
| `anita@levelup.test` | Anita Patel (2)  | moderator | ibo                                 |
| `jamal@levelup.test` | Jamal Brown (4)  | member    | apprentice                          |
| `beau@levelup.test`  | Beau Foster (20) | member    | candidate (no chat)                 |

Every other apprentice and IBO has a `members` row without a login (`user_id` null), so they appear in chats. Invites (`accept_invite`) are how new people get an account.

## Schema

Migrations live in `supabase/migrations`, in this order:

| File                         | Contents                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…0100_core`                 | `workspaces`, `people`, `members`, `invites`; identity helpers                                                                                                                                                                                                                                           |
| `…0200_crm`                  | events, attendance, travel, shared costs, contacts, sales, learning, goals, settings, activity, campaigns                                                                                                                                                                                                |
| `…0300_chat`                 | the chat tables from the contract, with indexes                                                                                                                                                                                                                                                          |
| `…0400_helpers`              | visibility, eligibility, conversation and DM helpers                                                                                                                                                                                                                                                     |
| `…0500_rls_crm`              | RLS for workspaces, members, invites and the CRM tables                                                                                                                                                                                                                                                  |
| `…0600_rls_chat`             | RLS for chat tables, plus the `chat_directory` view                                                                                                                                                                                                                                                      |
| `…0700_rpc`                  | RPCs (`accept_invite`, `create_dm`, `approve_announcement`, …)                                                                                                                                                                                                                                           |
| `…0800_triggers`             | guards, delete cascade, team-chat sync, notifications, check-ins, retention                                                                                                                                                                                                                              |
| `…0900_storage_realtime`     | storage buckets and policies; realtime publication                                                                                                                                                                                                                                                       |
| `20261013000100_client_sync` | what the app's supabase mode needs: `conversations.pinned_message_id` (+ who may pin), message-removal cleanup, `announcement_posted` / `event_post` notifications, mute, group admin hand-over, client-chosen ids for `create_dm` / `approve_announcement`, `event_rsvp_counts()`, more realtime tables |
| `20261013000200_chat_pins`   | personal chat pins: `conversation_members.pinned_at` (team chats start pinned, backfilled for existing members), only your own, at most 10 per tab                                                                                                                                                       |

Conventions:

- Column names are the snake_case of the TypeScript fields (`sponsorId` is `sponsor_id`).
- Entity ids are `text` (`gen_random_uuid()::text` by default), so client-generated UUIDs and the seed's readable ids (`"1"`, `"c8"`, `"e1"`, `"hs3"`) both work.
- Every CRM table has `workspace_id`, which defaults to the caller's workspace, so clients don't send it. Chat child tables follow the contract exactly and reach their workspace through their conversation or person. Only `conversations`, `members` and `library_items` carry `workspace_id`.
- Columns that default to "who is calling" (`by_id`, `author_id`, `created_by`, `owner_id`, `reporter_id`, `blocker_id`, `person_id` on `reactions`/`learning`/`contact_settings`) are filled with `current_person_id()` when omitted.

| TypeScript (src/stores, src/data/chat/types.ts) | Table(s)                                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CrmPerson` (business path and customers)       | `people` (`stage_history` jsonb, `tags` text[])                                                                                                                                      |
| `CrmEvent`                                      | `events` (+ `created_by`, db only)                                                                                                                                                   |
| `Attendance`                                    | `attendances` (unique per event and person)                                                                                                                                          |
| `Logistics` (keyed `eventId:personId`)          | `logistics`, primary key (event_id, person_id)                                                                                                                                       |
| `SharedCost` (`members`, `overrides`)           | `shared_costs`, `shared_cost_members`, `cost_overrides`                                                                                                                              |
| `Payment` (keyed `costId:personId`)             | `payments`, primary key (cost_id, person_id). Invoices stay derived on the client.                                                                                                   |
| `Contact` (+ `source`)                          | `contacts` (`source` is `manual`, `message` or `event`)                                                                                                                              |
| `Sale`, `Learning`                              | `sales`, `learning`                                                                                                                                                                  |
| `LearningGoal` (by person), `Settings`          | `learning_goals`, `contact_settings` (one row per person; no row means the defaults 60/3/1 and 30/14)                                                                                |
| `ActivityEvent`                                 | `activity` (+ `actor_id`, db only)                                                                                                                                                   |
| `Campaign`, `ReportSchedule`                    | `campaigns`, `report_schedules`                                                                                                                                                      |
| `DemoUser` / session                            | `auth.users` + `members`; `get_session()` returns the same `role` values                                                                                                             |
| Chat contract                                   | `members`, `conversations`, `conversation_members`, `messages`, `attachments`, `reactions`, `mentions`, `announcement_drafts`, `notifications`, `reports`, `blocks`                  |
| Library (`src/data/library/types.ts`)           | `library_items` (+ `library_item_speakers`, `library_item_topics`), `library_topics`, `library_channels` (+ `library_channel_sections`, `library_channel_items`), `library_progress` |
| (new)                                           | `workspaces` (name, `logo_url`, `colors` jsonb, `timezone` for "local day"), `invites`                                                                                               |

### Helper functions

All are `STABLE`. The ones that read other people's rows are `SECURITY DEFINER`, so policies never recurse.

- `current_person_id()`, `current_workspace_id()`, and `current_member_role()`. The last is named this way because `CURRENT_ROLE` is a reserved SQL keyword, so `current_role()` can't be defined. Each one reads the caller's `members` row; with several workspaces, the first one joined wins.
- `is_leader()`, `is_moderator_or_leader()`, and `is_candidate()` (a signed-in member who isn't chat eligible).
- `effective_biz_class(biz_class, business_start_date)` mirrors `effectiveBizClass`: an apprentice counts as an IBO one year after starting.
- `visible_person_ids()` mirrors `visibleIdSet` in `src/data/access.ts`:
  - Leaders, IBOs and apprentices see themselves, their business downline (a recursive walk over `sponsor_id` that never passes through customers), and only the customers they own.
  - Candidates see only themselves.
  - Nobody signed in sees nothing.
- `chat_eligible(person_id)`: a workspace member whose effective stage is apprentice or IBO, or a workspace leader. Prospects, customers and candidates are never eligible.
- `shares_conversation(a, b)` and `can_dm(a, b)`. `can_dm` requires both people to be eligible, in the same workspace, sharing a conversation, and with no block in either direction. Both functions only answer about pairs that include the signed-in caller.
- `my_conversation_ids()`, `conversation_role(id)`, `can_moderate_conversation(id)`, `is_team_chat(id)`, `dm_open(id)`, and smaller lookups (`person_workspace`, `message_conversation_id`, …).

## Row-level security, in plain words

RLS is on for every table. Policies apply to signed-in users (`authenticated`), so an anonymous caller sees and writes nothing except the `get_invite` preview. Every rule below is limited to the caller's own workspace; a second workspace's rows are invisible.

**Workspace, members, invites**

- You read your own workspace. Leaders edit its name, logo and colors.
- You always see your own member row. Chat users see the member list, and leaders see it too. Leaders add and remove members and designate moderators (change `role`).
- An invite can be created by anyone who isn't a candidate, for a sponsor they can see who is an apprentice or IBO. You see the invites you created or that name you as sponsor (leaders see all). The creator or a leader withdraws them.

**People and CRM data (the `access.ts` rules, now also on writes)**

- **People:** you read the people in `visible_person_ids()`.
  - Adding: you add business people under a sponsor you can see (leaders may add someone without a sponsor), and customers owned by someone you can see. Candidates add nobody. A sponsor or owner must be an apprentice or IBO.
  - Editing: you edit people you can see. Nobody changes their own stage or sponsor except leaders, and nobody can be re-sponsored under their own downline.
  - Deleting: you delete people you can see, except yourself. Their direct downline and customers move to their sponsor (see Triggers).
- **Customers are private:** you only ever see your own customers, never another person's, including your downline's. Leaders included.
- **Events:** everyone in the workspace reads all events. Anyone who isn't a candidate creates events. The creator, moderators and leaders edit or delete them.
- **Attendance and travel plans:** read and written only for people you can see, and only on your workspace's events.
- **Shared costs:**
  - Everyone reads costs, cost memberships, overrides and payments (they're needed to work out each share).
  - Only leaders and (effective) IBOs create a cost, as its organizer, and the organizer is opted in automatically. Only the organizer (or a leader) edits or deletes it, and only a leader hands it to another organizer.
  - You opt yourself in or out; the organizer can opt in anyone they can see. Nobody opts out after paying.
  - Overrides are set by the organizer only, never on a paid share.
  - Payments are made only through `pay_sandbox()`.
- **Contacts, sales, learning, learning goals:** read and written only for people (or customers) you can see. A contact's `by_id` is you or someone you can see.
- **Contact settings, campaigns, report schedules:** your own only. Campaign recipients must be people you can see.
- **Activity:** you read entries about people you can see, or about no person (event-level entries). You add entries the same way. Nobody edits or deletes them.

**Chat**

- **Chat access:** chat is only for eligible people (apprentices, IBOs and leaders). A prospect, customer or candidate reads nothing, even with a stray membership row.
- **Reading:** you read conversations, members, messages, attachments, reactions and mentions only of conversations you belong to. **Nobody reads a DM they aren't in, leaders included.** You can also see (not read) the team chats you could rejoin, and groups you created.
- **Team chats:** every eligible member belongs to Announcements and Main chat, and is added to the pinned team groups (Daily wins, High signal) on joining. You may rejoin a team chat yourself.
- **Groups:** any eligible member creates one and becomes its `admin` (by trigger). Admins add people with any role and change roles. Group moderators add plain members. Only eligible people of the same workspace can be added. You can leave a group, but not Announcements, Main chat or a DM. When a group's last admin leaves, the longest-standing moderator (else member) becomes admin. Pinning a chat is for moderators and leaders.
- **Personal pins** (`conversation_members.pinned_at`): you pin and unpin chats in your own list only (like read state and mute, nobody changes someone else's, not even a group admin or leader). Joining a `pinned = true` team chat starts it pinned; adding someone to a group never pins it for them. At most 10 pins per tab (DMs, and everything else), `23514` beyond that.
- **Pinned message** (`conversations.pinned_message_id`): either member of a DM; in other chats whoever may moderate it (chat admins and moderators, workspace leaders and moderators). Group moderators may pin but not rename or otherwise edit the group. Only a message of the same chat can be pinned; removing it unpins it.
- **DMs:** created only through `create_dm()`, and only when `can_dm` allows it. You can't post in a DM once either side has blocked the other.
- **Posting:** you post as yourself, in your conversations. In Announcements only workspace moderators and leaders post directly; everyone else creates an `announcement_drafts` row.
- **Editing and removing messages:**
  - Authors edit their own messages (which stamps `edited_at`) and remove them.
  - Group admins and moderators, and workspace moderators and leaders, may remove other people's messages in any non-DM chat they're in. They can only remove (set `deleted_at`), never rewrite.
  - A removed message keeps no text or card; its attachment rows, reactions, mentions and pin are removed too.
- **Drafts:** authors see and edit their own pending drafts. Leaders and moderators see all drafts and review them with `approve_announcement` or `reject_announcement`.
- **Notifications:** only your own. Triggers and RPCs create them; you can only mark them read (`read_at`) or delete them.
- **Reports:** you report messages you can see. The reporter and the workspace leaders see the report. Leaders resolve it; moderators don't see reports. For a DM a leader isn't in, they see the report but never the message.
- **Blocks:** your own list. The blocked person never sees the block.
- **Library** (migration `20261013000300_library.sql`, mirror of `src/data/library/rules.ts`):
  - `library_can_see(workspace, created_by, visibility)`: the creator; everyone for `team`; IBOs (effective stage), leaders and moderators for `ibos`; the creator's business downline for `downline` (`library_upline_ids()`). Speakers, topics, sections and lessons follow their item or channel.
  - Sharing (`library_can_share`): leaders and moderators for any audience; anyone else with a business downline (not candidates) for `downline` only. Editing and deleting (`library_can_edit`): the creator or a leader / moderator. A guard trigger keeps `created_by`, `workspace_id` and `created_at`, and refuses widening the audience past what the editor may share.
  - Topics: everyone reads; leaders and moderators write.
  - Progress: your own rows only. The `library_progress_log` trigger logs finishing an item to `learning` once (id `library:<item_id>:<person_id>`, kind from `library_learning_kind`: documents `pages` × page count, workshops `workshop`, other audio/video `podcast`, other slides `pages`) and stamps `logged_at`, which clients can't set or clear. The app shows the same row at once (`serverSide`) and never writes it.
  - `library_channel_teasers()` lists the `ibos` channels you can't open yet (title, icon, color, lesson count); `library_people` (a view) names the speakers and creators of what you can see, for viewers whose CRM view and chat directory don't include them.
- **Directory:** `chat_directory` (a view) lists the names, stages and roles of the eligible members of your workspace, so chat screens can show authors outside your CRM visibility. It's empty for non-chat users.

**Storage**

- `chat-media` (private): object paths start with the conversation id (the policies only check that first folder); the app uploads to `<conversation_id>/<uuid>.<ext>`. Members of that conversation read and upload; the uploader or a conversation moderator deletes. The app reads files through signed URLs (one hour).
- `library` (private, 200 MB per file; audio, video and PDF): the app uploads to `<workspace_id>/<item_id>/<uuid>.<ext>` before writing the item row. You read files of items you can see (by the item id in the path) and your own uploads; anyone who may share uploads into their workspace's folder; the uploader or the item's editors delete. Read through signed URLs (one hour). The local stack's global upload limit in `supabase/config.toml` is 200 MiB too (takes effect after `supabase stop && supabase start`).

## RPCs

Call these with `supabase.rpc(name, args)`.

| Function                                          | Returns         | Notes                                                                                                                                                                                    |
| ------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_session()`                                   | one row         | `person_id`, `workspace_id`, `name`, `member_role`, `biz_class`, `effective_stage`, `app_role` (leader / ibo / apprentice / candidate, like the demo `Role`), `is_chat_eligible`         |
| `get_invite(p_token)`                             | one row         | Preview for the invite page (anon allowed): workspace and sponsor name, stage, `is_valid`                                                                                                |
| `accept_invite(p_token)`                          | person id       | Signed-in user only. Creates their person under the sponsor (stage from the invite) and their member row, then marks the invite used. Errors: not found, used, expired, already a member |
| `create_dm(p_other_person_id)`                    | conversation id | The existing DM, or a new one when `can_dm` allows it. Call it, then post in a separate request.                                                                                         |
| `create_dm(p_other_person_id, p_conversation_id)` | conversation id | The same, creating the DM with the id the app already shows (an existing DM keeps its own id)                                                                                            |
| `mark_conversation_read(p_conversation_id)`       | timestamptz     | Sets your `last_read_at` to now                                                                                                                                                          |
| `unread_counts()`                                 | rows            | `conversation_id`, `unread` (others' messages after your `last_read_at`), `last_message_at`                                                                                              |
| `approve_announcement(p_draft_id)`                | message id      | Leaders and moderators. Posts the draft as its author, clears the reviewers' draft notifications, and notifies the author (`announcement_posted`)                                        |
| `approve_announcement(p_draft_id, p_message_id)`  | message id      | The same, posting with the id the app already shows                                                                                                                                      |
| `reject_announcement(p_draft_id)`                 | void            | Leaders and moderators                                                                                                                                                                   |
| `answer_event_post(p_message_id)`                 | notification id | After answering an event card (the attendance row is written directly): tells the card's author (`event_post`, `ref_id` = event id). One per person per post; a new answer replaces it   |
| `event_rsvp_counts()`                             | rows            | `event_id`, `bought`, `going`, `maybe` for the whole workspace (no identities), for event cards                                                                                          |
| `pay_sandbox(p_cost_id)`                          | `payments` row  | Pays your share, using the same rules as `splitCost` (paid shares are fixed, then overrides, then an even split of the rest). The amount and cost name are frozen on the row             |

Errors use SQLSTATE codes:

- `42501`: not allowed.
- `22023`: invalid state, such as already paid or already reviewed.
- `P0002`: not found.
- `23514`: a rule was broken, such as a sponsor who isn't an apprentice or IBO.

## Triggers

- **Guards (direct client writes only).** These stop clients changing columns they shouldn't:
  - ids, workspace and authors can't change;
  - `created_at` on messages, drafts, reports and reactions is always "now";
  - only a chat admin changes roles;
  - read state, mute and pins (`pinned_at`) are personal;
  - notifications only change `read_at`;
  - reports only get resolved;
  - you can't change your own stage or sponsor.

  RPCs and the seed run as the database owner and skip the guards.

- **Delete a person.** This mirrors `src/data/cascade.ts`:
  - Their direct downline and customers move to their sponsor.
  - Costs they organized pass to the sponsor, who isn't opted in.
  - Attendance, travel, cost memberships, overrides and payments go by foreign-key cascade.
  - Activity entries are written ("Moved under X (Y was removed)" and "Removed Y"), so the client should not log the delete itself.
- **Team chats.** When someone becomes a member, or later becomes eligible, they're added to Announcements and Main chat; on joining, also to the pinned team groups. A new group's creator becomes its admin. A new announcements, main or pinned chat gets every eligible member.
- **Notifications.** Nobody is notified about their own action, or by someone they've blocked. In a muted chat ("Mentions only") replies, wins and reactions don't notify.
  - A reply notifies the quoted author (`reply`). If the reply also mentions them, they get one notification, as a `mention`.
  - A post in Announcements notifies everyone else in it (`announcement_posted`; a mentioned member gets the `mention` instead). The author of an approved draft is also told by `approve_announcement` (`ref_id` = draft id).
  - Answering an event card notifies the card's author (`event_post`, through `answer_event_post`).
  - A mention notifies the mentioned member (`mention`).
  - A reaction notifies the message author (`reaction`, with `ref_id` set to the emoji).
  - A win card notifies the author's upline (sponsor chain) members who are in that chat (`win`).
  - A new announcement draft notifies every leader and moderator (`announcement_draft`, with `ref_id` set to the draft id).
  - A report notifies every leader (`report`, with `ref_id` set to the report id).
- **Conversation check-in.** This is the contract rule. When A posts in a DM and B posted in that DM within the previous 24 hours, the database records one `contacts` row for each direction, with `source = 'message'`, dated the local day in the workspace's `timezone`. In a group, the same happens when A replies to B and B, within the previous 24 hours, replied to one of A's messages. It happens at most once per pair per local day. Both people get a `checkin_logged` notification whose `ref_id` is the contact about the other person. A single "hey" to everyone, or messages in one direction, never count.
- **Retention.** `purge_expired_messages()` deletes messages older than their conversation's `retention_days`. pg_cron runs it nightly at 03:17 (job `purge-expired-messages`). Clients can't call it.

## Realtime

The `supabase_realtime` publication includes `messages`, `reactions`, `mentions`, `attachments`, `notifications`, `conversation_members`, `conversations`, `announcement_drafts` and `reports`. Subscribers only receive rows their RLS lets them read (deletes carry only the primary key).

## What the client writes, and what the database does

In supabase mode (`src/data/remote`) the app writes the rows a person changes, directly with their own token (RLS and the guard triggers check every write), and calls the RPCs where one exists. It never writes what a trigger or RPC produces, so nothing is created twice:

| The app writes                                                                                                                                           | The database adds                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| people, events, attendance, travel, shared costs (+ members, overrides), contacts, sales, learning, goals, contact settings, campaigns, report schedules | `last_updated_at` / `updated_at` stamps; the organizer's cost membership                                                    |
| activity entries (as today), with `actor_name`                                                                                                           | activity for person deletes and invite sign-ups                                                                             |
| delete a person                                                                                                                                          | moves their downline and customers, hands over their costs, removes their attendance, travel and cost rows                  |
| delete an event                                                                                                                                          | removes its attendance, travel, costs and payments                                                                          |
| `pay_sandbox(cost)`                                                                                                                                      | the payment row with the amount and cost name                                                                               |
| messages, attachments (after the upload), mentions, reactions, drafts, reports, blocks, group members and roles, mute, pins                              | every notification; conversation check-ins (`contacts` with `source = 'message'` + `checkin_logged`); group admin hand-over |
| `mark_conversation_read`, `create_dm`, `approve_announcement`, `reject_announcement`, `answer_event_post`                                                | what each RPC does                                                                                                          |
| remove a message (only `deleted_at`)                                                                                                                     | blanks it; removes its attachment rows, reactions, mentions and pin                                                         |
| notifications: `read_at` only                                                                                                                            | —                                                                                                                           |

Reads: after sign-in the app loads every table the person may read (paged; the newest 10,000 messages, 5,000 activity entries and 2,000 notifications), the `chat_directory` view and `event_rsvp_counts()`. Chat tables then follow Realtime; CRM tables are refetched on focus, when the connection returns and every 3 minutes.

## Seed

`supabase/seed.sql` is generated by `scripts/db/generate-seed.ts`. Don't edit it by hand. The generator reads:

- the CRM demo seed (`src/data/seed.ts`);
- the chat demo seed (`seedChat()` in `src/data/chat/seed.ts`): workspace `w1`, the four pinned team chats, the Fall Weekend carpool group, DMs, the event, win, learning and link cards, reactions, the mention of Maria, Sarah Kim's pending announcement draft, a reported spam message, two library items, notifications and read state;
- the library demo seed (`seedLibrary()` in `src/data/library/seed.ts`): 6 topics, 34 catalog items (lib-1 and lib-2 are the ones the chat seed's material cards point at), 6 channels and everyone's progress. Finished rows carry `logged_at`, so the learning trigger doesn't log them again;
- the demo logins above. Beau also gets a member row so he can sign in.

The database therefore holds exactly what the browser demo shows. Dates are written relative to the reset time (`seed_tmp.d(n)` and `seed_tmp.ts(seconds)`). The chat rows already contain their notifications and read state, so user triggers on the chat tables are switched off while they load (foreign keys stay checked).

The same script generates `supabase/tests/001_visibility_parity.test.sql`. It runs `access.ts` over the seed for each demo user and asserts that RLS returns exactly the same people, customers and attendance rows, and the same contact, sale and learning counts.

## Tests

`npm run db:test` runs the pgTAP files in `supabase/tests`. Each runs in a transaction that's rolled back, and acts as a user by setting the JWT claims.

| File                      | Covers                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_visibility_parity`   | (generated) RLS matches `access.ts` for Maria, Anita, Jamal and Beau; anon sees nothing                                                            |
| `002_crm_rules`           | writes follow visibility, customer privacy, candidates, stage/sponsor guards, shared costs and `pay_sandbox`, the delete cascade                   |
| `003_chat_access`         | eligibility (Beau and prospects can't read chats), DM privacy from leaders, `can_dm` / `create_dm`, blocks                                         |
| `004_announcements`       | member drafts vs leader/moderator posts, approve and reject, notifications                                                                         |
| `005_groups_moderation`   | creator is admin, roles, who may remove messages, reports notify leaders, reply/mention/reaction notifications                                     |
| `006_checkin`             | both directions within 24 hours makes exactly 2 contacts; one-way doesn't; no duplicate the same day; group replies                                |
| `007_workspace_isolation` | a second workspace's rows are invisible and unreachable                                                                                            |
| `008_schema_storage`      | contract columns, RLS on every table, realtime, function privileges, storage policies, retention purge                                             |
| `009_client_sync`         | pinned messages and who may pin, message removal cleanup, announcement / event-post notifications, mute, admin hand-over, client ids, event totals |
| `010_chat_pins`           | team chats start pinned for every member, pins are your own only (leaders, group admins and others can't pin for you), the 10-per-tab cap          |

`npm run test:integration` (vitest, `tests/integration`) runs the app's sync layer against the running database: what Jamal and Beau load, a CRM round trip with cascades, a refused write rolled back, a message reaching another person live (both directions), personal chat pins saved for one person only, the DM check-in trigger, a photo upload read through a signed URL, and approving an announcement. It adds rows each run (re-runnable); `npm run db:reset` restores the seed.

## Moving to hosted Supabase

1. Create a project at supabase.com. In Database → Extensions, enable **pg_cron** first so the retention job gets scheduled. Without it, the migration only prints a notice and you'd schedule `select public.purge_expired_messages()` yourself.
2. Link the project and push the migrations. `db push` doesn't run the seed, and the seed's demo logins must never go to a real project.
   ```
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
3. Auth settings (Authentication → URL configuration): set the site URL to the deployed app and add its `/auth/callback` redirect. Configure SMTP (Authentication → Emails) for magic links and invites; the built-in sender is heavily rate-limited.
4. Create the first workspace and leader in the SQL editor. Sign up the leader first, then:
   ```sql
   insert into public.workspaces (id, name) values ('w1', 'LevelUp');
   insert into public.people (id, workspace_id, name, email, biz_class, pipeline_stage, business_start_date)
   values ('1', 'w1', 'Leader Name', 'leader@example.com', 'ibo', 'ibo', current_date);
   insert into public.members (workspace_id, person_id, user_id, role)
   select 'w1', '1', id, 'leader' from auth.users where email = 'leader@example.com';
   insert into public.conversations (workspace_id, kind, title, icon, pinned, created_by) values
     ('w1', 'announcements', 'Announcements', 'megaphone', true, '1'),
     ('w1', 'main', 'Main chat', 'users', true, '1'),
     ('w1', 'group', 'Daily wins', 'trophy', true, '1'),
     ('w1', 'group', 'High signal', 'sparkles', true, '1');
   ```
   Everyone else joins through invite links (`accept_invite`).
5. Build the app with `VITE_DATA_SOURCE=supabase`, `VITE_SUPABASE_URL=https://<ref>.supabase.co` and `VITE_SUPABASE_ANON_KEY=<anon or publishable key>`, for example as CI secrets. Never put the service-role key in a `VITE_` variable. The GitHub Pages demo keeps `VITE_DATA_SOURCE=local`.
6. After any schema change: add a new migration, `npm run db:reset`, `npm run db:test`, `npm run db:types`, then `npx supabase db push`.

## Known gaps and decisions

- **One workspace per user for now.** `current_workspace_id()` picks the first workspace joined. Switching workspaces needs a choice passed per request, such as a JWT claim, when multi-team arrives.
- **`current_member_role()`** stands in for the `current_role()` named in the brief, because `current_role` is reserved in SQL.
- **Chat child tables have no `workspace_id`.** They follow the contract exactly, and isolation comes from their conversation or person.
- **The seed mirrors the browser demo, not the triggers.** For example, the demo's `checkin_logged` notification for Maria and Anita has no matching `contacts` row, and the High signal reply exchange between Maria and Jamal would count as a check-in if it were posted live. Change `src/data/chat/seed.ts` and re-run `npm run db:reset` to change the seed.
- **Pinned message per chat** is `conversations.pinned_message_id` (an addition to the contract; the browser store's `Conversation.pinnedMessageId`).
- **Seed media aren't real files.** Seed attachments use `seed:` storage paths, which the client synthesizes, and seed library items use `seed:audio:`, `seed:video:` and `seed:pdf:` paths that the client generates. Real uploads must follow the bucket path rules above.
- **`event_post`** means "someone answered your event card" (that's how the inbox shows it), so it comes from `answer_event_post()` after the RSVP rather than from a trigger on posting. Event card totals come from `event_rsvp_counts()`.
- **Retention and storage.** The nightly purge deletes expired messages (and their attachment rows by cascade) but not the files in `chat-media`; a storage cleanup job is still to do.
- **Team chat ids.** The seed keeps readable ids (`main`, `daily-wins`, …); a hosted workspace's are generated. The app finds team chats with `getTeamChatId()`.
- **Activity rows and `stage_history` are still written by the client**, as today. The database writes activity only for person deletes and invite sign-ups.
- **Reported DMs.** Leaders see the report and the reason, never the DM text. Moderation of DMs is therefore limited, by design ("nobody reads DMs").
- **No "no DMs" setting.** It's possible later, as the plan says. Report and block are in place.
- **Dates.** "Local day" for check-ins uses the workspace `timezone` (America/Chicago in the seed). `effective_biz_class` uses the database's `current_date` (UTC), so an apprentice's promotion can show a few hours early or late.
- **Payments only through `pay_sandbox()`.** There is no direct insert, so amounts can't be forged.
- **Opening a DM and posting are separate requests.** Inserting a message with `create_dm()` inside the same SQL statement fails RLS, because the new membership isn't visible yet within that statement.
- **Push notifications, SMS sign-in and media transcoding** are later phases.
