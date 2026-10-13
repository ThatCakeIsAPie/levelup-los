# Messaging and backend plan

Status: draft for Lyle and his partner to agree on before any code is written. Written 2026-10-12.

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

| Topic              | Decision                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend            | Supabase (Postgres, auth, realtime, storage). Local Supabase in Docker for development; hosted later.                                                        |
| Team roles         | Leader, moderator, member — separate from business stage (Prospect / Apprentice / IBO). Leaders designate moderators.                                        |
| Announcements      | Anyone can draft; a leader or moderator approves before it's posted.                                                                                         |
| Engagement numbers | No new tracking for now (no "last opened the app"). Keep the existing activity feed. Revisit with care: the worry is leaders hounding people about activity. |
| Audio and video    | Our own recordings only, never LTD training material.                                                                                                        |
| Push notifications | Later, but required before launch.                                                                                                                           |

## What it looks like

A WhatsApp-style structure inside the app:

- **Announcements** — one per team. Read-only for members; posts go through approval.
- **Main team chat** — everyone in the team.
- **Group chats** — side chats (a leadership circle, an event carpool, a new-apprentice group).
- **Direct messages** — one-to-one.
- **Notifications inbox** — mentions, replies, approvals waiting, event posts, wins, and reminders, in one list with unread state.

Navigation: add **Chats** with an unread badge to the sidebar and phone tab bar, and a bell for notifications in the header. The phone tab bar has room for four tabs plus the + button, so one of today's tabs moves into More. Proposed: Home · Chats · + · People · More (Events moves into More; upcoming events still appear on Home and as event posts in chat). See open question 1.

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

The existing **Log** sheet keeps working, and can optionally share what you logged to a chat.

### Automatic check-ins

A **conversation** counts as a contact for both people: messages in both directions within 24 hours, in a DM or a reply thread in a group. One "hey" to everyone doesn't count. The contact is recorded with source `message`, so it shows in the Today list, last-contact columns and activity feed exactly like a manual check-in, and can be told apart in reports.

## Roles and permissions

| Action                        | Member                  | Moderator | Leader |
| ----------------------------- | ----------------------- | --------- | ------ |
| Read announcements, main chat | ✓                       | ✓         | ✓      |
| Draft an announcement         | ✓                       | ✓         | ✓      |
| Approve / post announcements  |                         | ✓         | ✓      |
| Create group chats            | ✓ (see open question 3) | ✓         | ✓      |
| Remove messages in team chats |                         | ✓         | ✓      |
| Designate moderators          |                         |           | ✓      |
| Read other people's DMs       | never                   | never     | never  |

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

0. **Database and accounts.** Local Supabase in Docker; schema and row-level security for the existing CRM data; `@/data` hooks re-implemented on Supabase; real sign-in with invite links that place new people under their sponsor; seed data for development. The demo-user picker stays available in development only.
1. **Chats.** Main team chat, group chats, DMs, unread counts, notifications inbox, report and block. Text only.
2. **Announcements and roles.** Moderator designation, drafts and approval.
3. **Posts that fill in the data.** Event, win and learning cards; automatic conversation check-ins.
4. **Media.** Images and voice notes.
5. **Media library.** Our own audio talks and videos; finishing one logs learning. Video goes through a streaming service or unlisted links once volume justifies the cost.
6. **Notifications on devices.** Installable web app with push, then Capacitor apps.

Each phase ships on `develop` and is merged to `main` (which redeploys the public demo) only when Lyle says so.

Note: the GitHub Pages demo is a static site and can't run a database. Once phase 0 lands, the demo either stays on the browser-only version or moves to a host with a backend.

## Open questions

1. Phone tabs: Home · Chats · + · People · More (Events in More)? Or keep Events and move People?
2. Who can DM whom: anyone in the team, or only people in your line (upline and downline)?
3. Can members create group chats, or only moderators and leaders?
4. Can candidates and prospects use chat, and if so, which chats?
5. Should announcement approval apply to leaders' own posts? (Proposed: no.)
6. Message retention: keep forever, or delete after a period?
7. Sign-in method: email magic link, phone number code, or password?

## Later

Saved to-dos, not in scope now:

- **Other teams.** Lyle's own team could adopt this if it works for the partner's team. Options: hosted multi-team workspaces, or self-hosting.
- **Self-hosting.** A leader downloads it and hosts their own copy in about three clicks: a one-click Railway (or similar) deploy, possibly an installer that asks where to host and sets everything up. Supabase is heavy to self-host (about ten services); a lighter self-hostable backend (for example a single Rust server plus Postgres) may be worth it then.
- **Open source.** Choose a license (MIT vs AGPL). Keep LTD names and logos out of the public code; branding is set per workspace.
- **Engagement metrics.** Only with clear limits and team agreement, to avoid people being hounded about activity.
- **Video at scale.** Streaming service (Mux, Cloudflare Stream) with transcoding.
