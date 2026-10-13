# Messaging and backend plan

Status: draft for Lyle and his partner to agree on before any code is written. Written 2026-10-12; updated the same day with Lyle's answers to the open questions. Chat screens are mocked up before any building starts.

## Why

The team already relies on LTD's own messaging app, and it's widely known to be clunky and unreliable. LevelUp LOS can replace it for our team, and that solves the CRM's biggest problem at the same time: **data collection works best when it happens as a side effect of what people already do.** If the conversations, event announcements, wins and training happen in the app, most of the tracking fills itself in.

Principles:

1. **Reliable first.** The bar is "works every time, fast, on a weak signal at an event." Reliability beats features.
2. **Data as a side effect.** Every feature should record something useful without an extra step.
3. **Count that, never what.** The app records _that_ two people talked, never _what_ they said. Message content is never used for stats, and leaders can't read other people's direct messages.
4. **Credit both ways.** Tracking should help both sides of a relationship, not just the upline watching the downline.

## Scope

This is for **our partner's local team (about 50–100 people)**. Multi-team hosting and self-hosting are later (see [Later](#later)), but the data model includes a workspace from day one so they stay possible.

## Decisions so far

| Topic                 | Decision                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend               | Supabase (Postgres, auth, realtime, storage). Local Supabase in Docker for development; hosted later.                                                                |
| Team roles            | Leader, moderator, member — separate from business stage (Prospect / Apprentice / IBO). Leaders designate moderators.                                                |
| Announcements         | Anyone can draft; a leader or moderator approves before it's posted.                                                                                                 |
| Engagement numbers    | No new tracking for now (no "last opened the app"). Keep the existing activity feed. Revisit with care: the worry is leaders hounding people about activity.         |
| Audio and video       | Our own recordings only, never LTD training material.                                                                                                                |
| Push notifications    | Later, but required before launch.                                                                                                                                   |
| Chat access           | Apprentices, IBOs and leaders. Candidates and prospects don't use chat.                                                                                              |
| Direct messages       | You can DM anyone you share a chat with. Report and block always available; a report notifies the team leader. A "no DMs" setting is possible later but not planned. |
| Group chats           | Any member can create one. The creator is that chat's admin and can make others its moderators.                                                                      |
| Announcement approval | Drafts by members need a leader or moderator to approve. Leaders' own posts skip approval.                                                                           |
| Message history       | Kept forever by default. People can choose to auto-delete their own chats after a period.                                                                            |
| Sign-in               | Email link (primary) or email and password. Text-message codes later (needs an SMS provider such as Twilio).                                                         |
| Demo site             | The GitHub Pages demo keeps running on browser storage with seed data. Real deployments use the database. The app picks its data source by build setting.            |

## What it looks like

A WhatsApp-style structure inside the app:

- **Announcements** — one per team. Read-only for members; posts go through approval.
- **Main team chat** — everyone in the team.
- **Group chats** — side chats (a leadership circle, an event carpool, a new-apprentice group).
- **Direct messages** — one-to-one.
- **Notifications inbox** — mentions, replies, approvals waiting, event posts, wins, and reminders, in one list with unread state.

Suggested default chats for a new team: **Announcements**, **Main chat** (everyone), **Daily wins** (where win posts go) and **High signal** (questions and important discussion only).

Navigation:

- The app still opens on **Home** (the Dashboard). Home gains an **Inbox** section showing the latest notifications next to the Today list.
- **Chats** opens straight to the list of chats, like WhatsApp.
- The **+** button stays in the middle of the phone tab bar for quick logging.
- Phone tabs: **Home · Chats · + · My business · More**.
  - **My business** is a hub of live tiles: Team (mindmap), People, Customers, Events, Wallet and Campaigns. Each tile shows a number or the next thing to do (e.g. "12 need attention", "Fall Leadership Weekend in 26 days · 7 need a ticket"), so the tab is worth opening on its own. Tiles adapt to the role (no Customers or Campaigns for candidates).
  - **More** is for things used rarely: Reports, settings, team admin (moderators, approvals), theme, help, sign out. Lyle's experience is that anything in "More" goes unvisited, so nothing used weekly goes there.
- The desktop sidebar uses the same groups: Home, Chats, Inbox, then a "My business" section, then a "More" section.

### Messages

- Text with replies (quoting), reactions, @mentions, edit and delete.
- Images (compressed before upload).
- Voice notes, recorded in the app and played inline.
- Video and longer audio talks: later, via the media library.
- Read state per chat (unread counts), typing indicator if cheap.

### Posts that fill in the data

The + button in a chat offers structured posts, which render as cards and write data:

| Post         | What people see                                                              | What it records                                                                |
| ------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Event**    | Event card with **Going / Maybe / Bought my ticket** and **Add to calendar** | Attendance: desire, ticket status. Calendar via `.ics` / Google Calendar link. |
| **Win**      | Celebration card ("Anita made a sale")                                       | The sale, ticket purchase, or milestone, with the right person and date        |
| **Learning** | "Jamal finished _Momentum Daily_"                                            | A learning entry and streak update                                             |

The **+** button's Log sheet becomes the main way to record activity: **Log activity → Recruiting or Selling → what happened** (new contact, showed the plan, made a sale, …), plus **New event**, learning and check-ins. Anything logged can be **shared as a win** with one switch: it posts ready-made text to the Daily wins chat ("Just made a new contact 🙌"), which people can edit before posting. Win posts in chat and logged activity are the same record, so nothing is entered twice.

### Linking to posts and material

Messages can reference other things in the app, shown as a preview card that opens the original:

- an older message or post (quote and jump to it),
- an event, a person (for people allowed to see them), or a win,
- material from the media library (an audio talk, video, or document), with a play button inline.

### Automatic check-ins

A **conversation** counts as a contact for both people: messages in both directions within 24 hours, in a DM or a reply thread in a group. One "hey" to everyone doesn't count. The contact is recorded with source `message`, so it shows in the Today list, last-contact columns and activity feed exactly like a manual check-in, and can be told apart in reports.

## Roles and permissions

| Action                        | Member                           | Moderator | Leader |
| ----------------------------- | -------------------------------- | --------- | ------ |
| Read announcements, main chat | ✓                                | ✓         | ✓      |
| Draft an announcement         | ✓                                | ✓         | ✓      |
| Approve / post announcements  |                                  | ✓         | ✓      |
| Create group chats            | ✓ (creator is that chat's admin) | ✓         | ✓      |
| Remove messages in team chats |                                  | ✓         | ✓      |
| Designate moderators          |                                  |           | ✓      |
| Read other people's DMs       | never                            | never     | never  |

Business visibility rules (who sees whose CRM data) stay as they are and are unrelated to chat roles.

**Safety:** report a message, block a person, and a moderation queue for reports. Apple requires these for apps with user posts, so they ship before any app-store build.

## Data model (Supabase)

All tables carry `workspace_id`; row-level security limits every query to the viewer's workspace and, for chats, to conversations they belong to.

- `workspaces` — a team (name, logo, colors: branding is per workspace).
- `members` — user ↔ workspace, `role` (leader / moderator / member), linked to the person record in the CRM.
- `conversations` — `kind` (announcements / main / group / dm), title, created_by.
- `conversation_members` — membership, `last_read_at`, muted.
- `messages` — author, body, `reply_to`, `card` (JSON for event / win / learning posts), edited_at, deleted_at.
- `attachments` — storage path, type, size, duration (voice notes), dimensions (images).
- `reactions`, `mentions`.
- `announcement_drafts` — status (pending / approved / rejected), reviewer.
- `notifications` — recipient, type, target, read_at.
- `reports`, `blocks`.
- `contacts` (existing concept) gains `source` (manual / message / event).

Existing CRM data (people, events, attendance, contacts, learning, sales, costs) moves from browser storage into Postgres behind the same `@/data` hooks, so pages barely change.

Realtime: Supabase Realtime for new messages, reactions, read state and notifications. Storage: Supabase Storage buckets with the same membership rules.

## Chat data contract

The exact shape shared by the browser-storage implementation (TypeScript, camelCase) and the database (Postgres, snake_case: `conversationId` ↔ `conversation_id`). Both must match field for field. Ids are text (client-generated UUIDs; seed rows keep readable ids). Timestamps are ISO strings / `timestamptz`. Person ids are the existing CRM person ids.

| Entity (TS / table)                           | Fields                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WorkspaceMember` / `members`                 | `workspaceId`, `personId`, `role` (`leader` \| `moderator` \| `member`), `userId` (auth user, db only), `joinedAt`                                                                                                                                                                          |
| `Conversation` / `conversations`              | `id`, `workspaceId`, `kind` (`announcements` \| `main` \| `group` \| `dm`), `title` (null for DMs), `description`, `icon` (lucide name, optional), `pinned` (team chats), `retentionDays` (null = keep forever), `pinnedMessageId` (added in phase 0 integration), `createdBy`, `createdAt` |
| `ConversationMember` / `conversation_members` | `conversationId`, `personId`, `role` (`admin` \| `moderator` \| `member`), `lastReadAt`, `muted`, `joinedAt`, `pinnedAt` (personal pin, null = not pinned; added 2026-10-13)                                                                                                                |
| `Message` / `messages`                        | `id`, `conversationId`, `authorId`, `body`, `replyToId`, `card` (JSON, below), `createdAt`, `editedAt`, `deletedAt`                                                                                                                                                                         |
| `Attachment` / `attachments`                  | `id`, `messageId`, `kind` (`image` \| `voice` \| `file`), `storagePath`, `mime`, `size`, `durationMs`, `width`, `height`                                                                                                                                                                    |
| `Reaction` / `reactions`                      | `messageId`, `personId`, `emoji`, `createdAt`                                                                                                                                                                                                                                               |
| `Mention` / `mentions`                        | `messageId`, `personId`                                                                                                                                                                                                                                                                     |
| `AnnouncementDraft` / `announcement_drafts`   | `id`, `conversationId`, `authorId`, `body`, `card`, `status` (`pending` \| `approved` \| `rejected`), `reviewerId`, `reviewedAt`, `createdAt`                                                                                                                                               |
| `Notification` / `notifications`              | `id`, `recipientId`, `type` (`mention` \| `reply` \| `announcement_draft` \| `announcement_posted` \| `report` \| `event_post` \| `win` \| `checkin_logged` \| `reaction`), `actorId`, `conversationId`, `messageId`, `refId`, `createdAt`, `readAt`                                        |
| `Report` / `reports`                          | `id`, `messageId`, `reporterId`, `reason`, `createdAt`, `resolvedAt`, `resolvedBy`                                                                                                                                                                                                          |
| `Block` / `blocks`                            | `blockerId`, `blockedId`, `createdAt`                                                                                                                                                                                                                                                       |
| `LibraryItem` / `library_items`               | `id`, `workspaceId`, `kind` (`audio` \| `video` \| `document`), `title`, `durationSec`, `url`, `createdBy`, `createdAt`                                                                                                                                                                     |
| `Contact` (existing) / `contacts`             | gains `source` (`manual` \| `message` \| `event`)                                                                                                                                                                                                                                           |

`card` JSON (`MessageCard`):

- `{ "type": "event", "eventId": "e1" }` — RSVP buttons write attendance.
- `{ "type": "win", "winKind": "sale" | "contact" | "plan" | "ticket" | "rank" | "other", "refId": "<id of the logged record>", "title": "Made a sale", "detail": "XS Energy (case)" }` — the logged record is the source of truth; the card points at it.
- `{ "type": "learning", "learningId": "<id>", "title": "Momentum Daily" }`
- `{ "type": "link", "target": { "kind": "message" | "event" | "person" | "material", "id": "<id>" } }` — preview card that opens the original.

Rules (implemented as pure functions on the client and as row-level security / triggers in the database; both tested):

- **Chat eligibility:** people whose effective stage is apprentice or IBO, plus leaders. Prospects, customers and the candidate demo role have no chat.
- **Team chats:** every eligible member belongs to `announcements` and `main`; `Daily wins` and `High signal` are `group` chats with `pinned = true` created for the workspace.
- **Personal pins:** each person pins chats to the top of their own list (`ConversationMember.pinnedAt`); nobody else sees or changes them. Memberships of `pinned = true` chats start pinned, and each person may unpin them. At most 10 pins per list tab (groups, direct messages).
- **Group chats:** any eligible member can create one and becomes its `admin`; admins make others `moderator`.
- **Direct messages:** allowed between two eligible people who share at least one conversation and haven't blocked each other.
- **Announcements:** leaders and workspace moderators post directly; anyone else creates an `AnnouncementDraft` that a leader or moderator approves (approval posts the message and notifies the author). Leaders' own posts skip approval.
- **Reports** notify every workspace leader (`report` notification).
- **Mentions and replies** notify the mentioned / replied-to person.
- **Conversation check-in:** when person A posts in a DM (or replies to B in a group) and B posted to A in that conversation within the previous 24 hours, record one `contacts` row for each direction (`source = "message"`), at most once per pair per local day, and notify both (`checkin_logged`).
- **Retention:** `retentionDays` null keeps forever; otherwise messages older than that are deleted.

## Pipeline and conversions (next feature)

Mockup: [`docs/design/pipeline-mockup.html`](../design/pipeline-mockup.html). Agreed 2026-10-12, details still open.

- **Milestones (fixed):** Contact made → First meeting (MG1) → First plan → Registered. Nobody can rename, remove or reorder them; all upline rollups, cross-team comparisons and the activity goal use only these. First plan is Info 1 (the first info session).
- **Steps (set by leaders):** between milestones, each leader defines their team's steps — for the partner's team: Shared Story and Opened the Door after Contact made; Book and MG2 after First meeting; F1, Info 2, F2, Info 3 and F3+ after First plan. Downlines automatically inherit their leader's steps, can hide any of them and add their own, but can't change a milestone. A step always belongs to the milestone band it sits in.
- **Board:** every prospect is a card; cards show whose prospect it is, days in stage, the next step, and a stale flag after 14 days without movement. Columns are grouped into four bands, one per milestone. On desktop the board scrolls sideways when it's wider than the screen. On phones the whole board scrolls sideways one full column at a time (snap scrolling, next column peeking in, no visible scrollbar) — no stage buttons to tap; hold a card to drag it.
- **Activity, counted automatically:** the page leads with this month's milestone activity (contacts made, first meetings, first plans, registrations) against the team goal — **80 first meetings (MG1s) a month**, the activity needed to reach the 25% level after about 6 months. Moving a card or logging "Booked a meeting" / "Showed the plan" from the + records the activity with its date, so nobody counts by hand. "In this stage now" and "happened this month" are separate numbers.
- **Conversions:** milestone-to-milestone conversion rates over a period, compared with team targets, with the biggest gap called out; inside each band, your own steps show where people stall — so leaders can see where the process loses people and coach on it.
- **Per-person conversions (hotspot grid):** each person sees their **own** numbers and their **downline's** — leaders and smaller leaders alike, since uplines are invested in their downline's success. **Crosslines never see each other's numbers, and downlines don't see their upline's, unless that person chooses to share** with someone specific (e.g. a mentor in another leg). Steps with fewer than 10 people show "–" so small samples don't mislead.
- **Targets:** conversion targets are set by leaders for their own team; a new leader inherits their upline's targets until they change them. The MG1 activity goal (80 a month) is a team setting the same way.
- **Sharing stats:** on someone's profile, "Request to view stats" sends them an inbox request to approve or decline. On your own profile, "Share my stats" asks who to share with. Each person can see and revoke everyone who has access. Uplines don't need to request their downline's stats.

## Phases

0. **Database and accounts.** Local Supabase in Docker; schema and row-level security for the existing CRM data; `@/data` hooks re-implemented on Supabase; real sign-in with invite links that place new people under their sponsor; seed data for development. The demo-user picker stays available in development and in the browser-storage demo build (GitHub Pages), which keeps working without a database.
1. **Chats.** Main team chat, group chats, DMs, unread counts, notifications inbox, report and block. Text only.
2. **Announcements and roles.** Moderator designation, drafts and approval.
3. **Posts that fill in the data.** Event, win and learning cards; automatic conversation check-ins.
4. **Media.** Images and voice notes.
5. **Media library.** Our own audio talks and videos; finishing one logs learning. Video goes through a streaming service or unlisted links once volume justifies the cost.
6. **Notifications on devices.** Installable web app with push, then Capacitor apps.

Each phase ships on `develop` and is merged to `main` (which redeploys the public demo) only when Lyle says so.

Note: the GitHub Pages demo is a static site and can't run a database, so it stays on browser storage with seed data. The `@/data` layer gets two implementations, browser storage and Supabase, chosen at build time.

## Open questions

Answered 2026-10-12 (see the decisions table). Still open:

1. Does the My business hub work in practice? Check with the mockups and early users.
2. Should engagement numbers exist at all, and with what limits? (Lyle and partner to discuss.)

## Later

Saved to-dos, not in scope now:

- **Other teams.** Lyle's own team could adopt this if it works for the partner's team. Options: hosted multi-team workspaces, or self-hosting.
- **Self-hosting.** A leader downloads it and hosts their own copy in about three clicks: a one-click Railway (or similar) deploy, possibly an installer that asks where to host and sets everything up. Supabase is heavy to self-host (about ten services); a lighter self-hostable backend (for example a single Rust server plus Postgres) may be worth it then.
- **Open source.** Choose a license (MIT vs AGPL). Keep LTD names and logos out of the public code; branding is set per workspace.
- **Engagement metrics.** Only with clear limits and team agreement, to avoid people being hounded about activity.
- **Video at scale.** Streaming service (Mux, Cloudflare Stream) with transcoding.
