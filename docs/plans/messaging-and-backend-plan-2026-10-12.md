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
- Phone tabs: Home · Chats · + · People · More. Events moves into More but stays one tap away from Home (next event card) and from event posts in chat. Lyle's concern is that this could feel crowded; the mockups test it.

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

1. Does Home · Chats · + · People · More feel crowded in practice? Check with the mockups.
2. Should engagement numbers exist at all, and with what limits? (Lyle and partner to discuss.)

## Later

Saved to-dos, not in scope now:

- **Other teams.** Lyle's own team could adopt this if it works for the partner's team. Options: hosted multi-team workspaces, or self-hosting.
- **Self-hosting.** A leader downloads it and hosts their own copy in about three clicks: a one-click Railway (or similar) deploy, possibly an installer that asks where to host and sets everything up. Supabase is heavy to self-host (about ten services); a lighter self-hostable backend (for example a single Rust server plus Postgres) may be worth it then.
- **Open source.** Choose a license (MIT vs AGPL). Keep LTD names and logos out of the public code; branding is set per workspace.
- **Engagement metrics.** Only with clear limits and team agreement, to avoid people being hounded about activity.
- **Video at scale.** Streaming service (Mux, Cloudflare Stream) with transcoding.
