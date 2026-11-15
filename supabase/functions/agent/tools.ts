/**
 * THE WHITELIST: everything an agent can do. One entry per `public.agent_<name>` SQL function
 * (supabase/migrations/20261105000200_agent_tools.sql and 20261106000100_agent_people_tools.sql); nothing else is reachable. To add a tool:
 *   1. a SECURITY INVOKER `agent_<name>` function that starts with `agent_private.ctx()` and
 *      writes one audit row (a new migration),
 *   2. one entry below (arguments, description, whether it changes data),
 *   3. tests: pgTAP for the function (and the catalog list in 043), vitest for the entry.
 * tools.test.ts fails when the registry and the migrations disagree.
 *
 * Arguments are validated here (clear 400s) and again in SQL (the function is the real gate).
 * The SQL text lives here as constants; nothing a caller sends ever becomes SQL.
 */

import { icsFromData, type IcsData } from "./ics.ts";

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface FieldSpec {
  /** `date`: a calendar date "YYYY-MM-DD"; `time`: a wall-clock time "HH:MM" (24 hours, no zone); `timestamp`: an ISO 8601 time WITH an offset or Z. */
  type: "string" | "integer" | "boolean" | "date" | "timestamp" | "time";
  description: string;
  /** string: length in characters; integer: value */
  min?: number;
  max?: number;
  default?: number | boolean;
  enum?: readonly string[];
  nullable?: boolean;
  required?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  /** Changes data: needs a connection with write access. */
  write: boolean;
  properties: Record<string, FieldSpec>;
  /** `select public.agent_<name>($1…) as r`, with explicit casts. */
  sql: string;
  /** The SQL parameters, from validated arguments. */
  params: (args: Record<string, Json>) => unknown[];
  /** A patch tool: the call must carry at least one of these fields (the tool's own message names them). */
  requireOneOf?: readonly string[];
  /** Turns what the SQL function returned into what the caller gets (formatting only; no data of its own). */
  format?: (raw: unknown, now: Date) => unknown;
}

const PATCH_FIELDS = ["name", "phone", "email", "location", "notes"] as const;
const PROFILE_FIELDS = ["full_name", "phone", "email", "location"] as const;

/** Contact fields in the terms of vCard (RFC 6350): said once, in every description that has them. */
const VCARD =
  "Contact fields follow vCard (RFC 6350): full_name (FN), phone (TEL), email (EMAIL), location (ADR locality and region as one text), notes (NOTE).";

const LIST_FIELDS = (noun: string): Record<string, FieldSpec> => ({
  search: {
    type: "string",
    description: `Only ${noun} whose name contains this text (case-insensitive, plain text).`,
    max: 100,
  },
  limit: {
    type: "integer",
    description: "How many to return, 1 to 200 (default 50).",
    min: 1,
    max: 200,
    default: 50,
  },
  offset: {
    type: "integer",
    description:
      "How many to skip, for the next page (default 0). `total` says how many there are.",
    min: 0,
    max: 100000,
  },
});

const EVENT_WINDOW_PROPERTIES = (withChangedSince: boolean): Record<string, FieldSpec> => ({
  from: {
    type: "date",
    description: "First day of the window, YYYY-MM-DD (default: today for the team).",
  },
  until: {
    type: "date",
    description:
      "Last day of the window, YYYY-MM-DD (default: 8 weeks after from; at most 26 weeks after from, a later date is cut back and `capped` says so).",
  },
  ...(withChangedSince
    ? {
        changed_since: {
          type: "timestamp" as const,
          description:
            "ISO 8601 time with an offset or Z, e.g. 2026-11-14T18:00:00Z: only events changed after it (series are always all listed).",
        },
      }
    : {}),
});

const LIST_EVENTS_DESCRIPTION = [
  "The team's events and repeating events in a date window, in the terms of iCalendar (RFC 5545), so they map onto Google, Apple and Outlook calendars without guessing.",
  "Arguments: from (YYYY-MM-DD, default the team's today), until (YYYY-MM-DD, default 8 weeks after from, at most 26 weeks after it: a later date is cut back and `capped` is true), changed_since (ISO 8601 time with an offset: only events changed after it, to ask what changed).",
  "Result: {from, until, capped, timezone (the team's IANA zone), truncated (true when more than 500 events matched), events, series}.",
  "Each event: id (the CRM's own id, for set_event_answer), uid (iCalendar UID: stable and globally unique, never changes when the event is edited or moved; use it to find your calendar copy), summary (the name), description (the notes), location, category (the category's name), url (the ticket link, if any), last_modified (LAST-MODIFIED, ISO 8601 UTC), my_answer (the connected person's own answer: yes, no, maybe or null) and partstat (that answer as ACCEPTED, DECLINED, TENTATIVE or NEEDS-ACTION). Fields an event has no value for are left out (my_answer is the exception: null when there is no answer). There is no sequence.",
  "All-day events (all_day true): start_date and end_date_exclusive, the day AFTER the last day (DTEND;VALUE=DATE).",
  "Timed events (all_day false): start and end as local wall-clock ISO 8601 without offset in `timezone` (DTSTART;TZID=timezone), and start_utc and end_utc as UTC instants (correct across daylight-saving changes). An event with a start time and no end time has no end and no end_utc: treat it as a point in time or apply your own default length. A multi-day timed event starts at its start time on the first day and ends at its end time on the last day; with no end time it runs to the end of its last day (end is midnight after it).",
  "An occurrence of a repeating event also has series_uid, recurrence_id (the occurrence's ORIGINAL slot in its series, a date for an all-day series or a local date-time for a timed one: RECURRENCE-ID) and is_exception (true when this occurrence was changed on its own, moved off its slot, or otherwise differs from the series: it must be an exception to the series in the calendar).",
  "series: every repeating event with an occurrence in the window or still running, always complete (changed_since does not filter it, since a deleted occurrence only shows in exdates): series_uid, summary, description, location, category, url, all_day, the FIRST occurrence's start_date and end_date_exclusive or start, end, start_utc and end_utc, timezone, rrule (the RFC 5545 RRULE value without the 'RRULE:' prefix, repeating the first start in local time, so a timed series keeps its wall-clock time across daylight-saving changes), exdates (skipped occurrences: dates for an all-day series, local date-times for a timed one) and until (when it ends: a date, or a UTC time for a timed series, the same as in the rrule).",
  "Make ONE repeating calendar entry per series from rrule and exdates, and one exception per occurrence with is_exception true (its recurrence_id names the slot it replaces). A deleted single event is not listed: compare uids with your calendar.",
].join(" ");

const EXPORT_ICS_DESCRIPTION = [
  "The same window as list_upcoming_events (arguments from and until, same defaults and cap) as ONE complete iCalendar file (BEGIN:VCALENDAR, CRLF line ends, lines folded at 75 octets, text escaped) that a calendar can import, returned as the file's text.",
  "One VEVENT per repeating event carrying its RRULE and EXDATEs, one VEVENT with RECURRENCE-ID for each exception occurrence (UID = the series' uid), one VEVENT per other event; UID, DTSTAMP, LAST-MODIFIED, SUMMARY, DESCRIPTION, LOCATION, CATEGORIES and URL as the events have them. All-day events are VALUE=DATE with the exclusive end. Timed single events are UTC instants (DTSTART:...Z).",
  "A timed repeating event is ONE repeating entry, written as DTSTART;TZID=<the team's zone> with a VTIMEZONE, so it stays at the same wall-clock time across daylight-saving changes, but only when the zone's rules can be written as a yearly rule that matches the database's time zone data every year from the year before the series' first date for 31 years; otherwise, and for a timed repeating event that spans more than one day, its occurrences in the window are written as separate UTC events (each with its own uid, none repeating) and the file says so in a comment. An event with a start time and no end time has no DTEND: treat it as a point in time.",
  "A repeating event's master VEVENT has no LAST-MODIFIED (its occurrences' own times are on the exceptions).",
].join(" ");

/** The card tools' shared wording: said once, in every description that has it. */
const CARD_WORDS =
  "A card is a prospect on the recruiting board or a name on someone's customer board; its tasks (a checklist with optional due date and time) and notes (a running log) are what some people call follow-ups or to-dos. The card's due date is `next_due`: the earliest due date among its open tasks, with its time when that task has one.";
const VTODO =
  "Each task is shaped after an iCalendar VTODO (RFC 5545): uid (stable, never changes), summary (the title), status (NEEDS-ACTION or COMPLETED), due (a date YYYY-MM-DD when it has no time, else the local date-time YYYY-MM-DDTHH:MM:SS in `timezone` (DUE;TZID), with due_utc as the UTC instant), completed, created and last_modified (UTC); plus the CRM's own id, done, due_date, due_time, card {board, person}, assignee {id, full_name} (null when unassigned: it is then the card owner's), completed_by and position.";
const BOARD_ID =
  "person_id: the card's id: a prospect's id on the recruiting board (from list_prospects), or the id of the name on the customer board (from list_cards with board customer).";
const BOARD_FIELD = (all: boolean): FieldSpec => ({
  type: "string",
  description: all
    ? "recruiting, customer or all (default all)."
    : "recruiting (default) or customer.",
  enum: all ? ["recruiting", "customer", "all"] : ["recruiting", "customer"],
});

const CARD_TOOLS: readonly ToolDef[] = [
  {
    name: "list_cards",
    description: [
      "List pipeline cards with their tasks and notes summary, in the CRM's terms (there is no external standard for a card).",
      CARD_WORDS,
      "Arguments: board (recruiting, customer or all), person_id (one card: a prospect, a name on the customer board, or the customer it became), mine_only (default true: the cards the connected person owns; false adds their team's, never another line's), has_open_tasks, due_from and due_until (YYYY-MM-DD, inclusive, on next_due), overdue (an open task is due before the team's now; a task with no time is due at the end of its day), search (the person's name), limit (default 50, at most 200), offset.",
      "Result: {total, limit, offset, timezone (the team's IANA zone), cards, note}. Each card: board, person {id, full_name}, customer_id (a customer-board name that became a customer), owner {id, full_name}, column {id, name}, tasks_done, tasks_total, next_due (a date, or a local date-time in `timezone` beside it; absent when no open task has a due date), assignees (of open tasks), notes_count. Ordered by next_due, then name. `note` is present only when the list is empty or past its end and says why and what to use. Use get_card for one card's tasks and notes.",
    ].join(" "),
    write: false,
    properties: {
      board: BOARD_FIELD(true),
      person_id: { type: "string", description: "Only this card.", min: 1, max: 100 },
      mine_only: {
        type: "boolean",
        description: "Only cards the connected person owns (default true).",
        default: true,
      },
      has_open_tasks: {
        type: "boolean",
        description: "true: cards with an open task; false: cards with none.",
      },
      due_from: {
        type: "date",
        description: "Cards whose next_due is on or after this day, YYYY-MM-DD.",
      },
      due_until: {
        type: "date",
        description: "Cards whose next_due is on or before this day, YYYY-MM-DD.",
      },
      overdue: {
        type: "boolean",
        description: "Only cards with an open task due before the team's now.",
      },
      search: { type: "string", description: "Part of the person's name.", min: 1, max: 100 },
      limit: {
        type: "integer",
        description: "How many (default 50, at most 200).",
        min: 1,
        max: 200,
        default: 50,
      },
      offset: {
        type: "integer",
        description: "How many to skip (default 0).",
        min: 0,
        max: 100000,
        default: 0,
      },
    },
    sql: "select public.agent_list_cards($1::text, $2::text, $3::boolean, $4::boolean, $5::date, $6::date, $7::boolean, $8::text, $9::int, $10::int) as r",
    params: (a) => [
      a.board ?? "all",
      a.person_id ?? null,
      a.mine_only ?? true,
      a.has_open_tasks ?? null,
      a.due_from ?? null,
      a.due_until ?? null,
      a.overdue ?? false,
      a.search ?? null,
      a.limit ?? 50,
      a.offset ?? 0,
    ],
  },
  {
    name: "get_card",
    description: [
      "One pipeline card with ALL its tasks and its notes (newest first, the 100 newest, `notes_truncated` says when more exist).",
      CARD_WORDS,
      VTODO,
      "The card as list_cards shows it, plus tasks and notes [{id, author {id, full_name}, body, created_at}]. A card the connected person cannot see gets the same refusal as one that does not exist.",
      BOARD_ID,
    ].join(" "),
    write: false,
    properties: {
      person_id: {
        type: "string",
        description: "The card's id (see below).",
        min: 1,
        max: 100,
        required: true,
      },
      board: BOARD_FIELD(false),
    },
    sql: "select public.agent_get_card($1::text, $2::text) as r",
    params: (a) => [a.person_id, a.board ?? "recruiting"],
  },
  {
    name: "list_card_tasks",
    description: [
      "List card tasks (checklist items on pipeline cards; what some people call follow-ups or to-dos) across cards.",
      VTODO,
      "Arguments: status (open default, done, all), assigned (me default: assigned to the connected person, or unassigned on cards they own; team: assigned to people in their downline, or unassigned on those people's cards; all: both), person_id (one card), due_from and due_until (YYYY-MM-DD, inclusive), overdue (open and due before the team's now; a task with no time is due at the end of its day), changed_since (ISO 8601 with an offset: only tasks changed after it; a deleted task is not reported), limit (default 50, at most 200), offset.",
      "Result: {total, limit, offset, timezone (the team's IANA zone), tasks, note}; dated tasks first by due date and time, then the undated. `note` is present only when the list is empty or past its end and says why and what to use (add_card_task).",
    ].join(" "),
    write: false,
    properties: {
      status: {
        type: "string",
        description: "open (default), done or all.",
        enum: ["open", "done", "all"],
      },
      assigned: {
        type: "string",
        description: "me (default), team or all.",
        enum: ["me", "team", "all"],
      },
      person_id: {
        type: "string",
        description: "Only this card (see get_card).",
        min: 1,
        max: 100,
      },
      due_from: { type: "date", description: "Due on or after this day, YYYY-MM-DD." },
      due_until: { type: "date", description: "Due on or before this day, YYYY-MM-DD." },
      overdue: { type: "boolean", description: "Only open tasks due before the team's now." },
      changed_since: {
        type: "timestamp",
        description: "ISO 8601 time with an offset or Z: only tasks changed after it.",
      },
      limit: {
        type: "integer",
        description: "How many (default 50, at most 200).",
        min: 1,
        max: 200,
        default: 50,
      },
      offset: {
        type: "integer",
        description: "How many to skip (default 0).",
        min: 0,
        max: 100000,
        default: 0,
      },
    },
    sql: "select public.agent_list_card_tasks($1::text, $2::date, $3::date, $4::boolean, $5::text, $6::text, $7::timestamptz, $8::int, $9::int) as r",
    params: (a) => [
      a.status ?? "open",
      a.due_from ?? null,
      a.due_until ?? null,
      a.overdue ?? false,
      a.assigned ?? "me",
      a.person_id ?? null,
      a.changed_since ?? null,
      a.limit ?? 50,
      a.offset ?? 0,
    ],
  },
  {
    name: "add_card_task",
    description: [
      "Add ONE task (a checklist item; what some people call a follow-up or a to-do) to a pipeline card, optionally with a due date and time and an assignee.",
      CARD_WORDS,
      VTODO,
      "due_time is the team's wall-clock time (the team's timezone, not yours) and needs a due_date. assignee_id may only be the card's owner or the connected person; leave it out for the owner. Result: the card as get_card shows it (without notes) plus `task`, the new one. Not deduplicated: adding the same title twice makes two tasks.",
      BOARD_ID,
    ].join(" "),
    write: true,
    properties: {
      person_id: {
        type: "string",
        description: "The card's id (see below).",
        min: 1,
        max: 100,
        required: true,
      },
      title: {
        type: "string",
        description: "What to do, 1 to 200 characters.",
        min: 1,
        max: 200,
        required: true,
      },
      board: BOARD_FIELD(false),
      due_date: {
        type: "date",
        description: "Due day, YYYY-MM-DD (the team's calendar; a past date is allowed).",
      },
      due_time: {
        type: "time",
        description: "Due time of day, HH:MM, 24 hours, the team's time. Needs due_date.",
      },
      assignee_id: {
        type: "string",
        description: "Who has to do it: the card's owner (default) or the connected person.",
        min: 1,
        max: 100,
      },
    },
    sql: "select public.agent_add_card_task($1::text, $2::text, $3::text, $4::date, $5::time, $6::text) as r",
    params: (a) => [
      a.person_id,
      a.title,
      a.board ?? "recruiting",
      a.due_date ?? null,
      a.due_time ?? null,
      a.assignee_id ?? null,
    ],
  },
  {
    name: "update_card_task",
    description: [
      "Change a card task's title, due date, due time or assignee (complete_card_task ticks it). Send the task id and only the fields to change; null clears due_date, due_time or assignee_id. A time needs a date: clear both to remove the due date. Nothing else about a task can be changed and a field outside that list is refused.",
      VTODO,
      "assignee_id may only be the card's owner or the connected person. Result: the card as get_card shows it (without notes), whose `tasks` include the changed task, and a `note` when nothing changed.",
    ].join(" "),
    write: true,
    requireOneOf: ["title", "due_date", "due_time", "assignee_id"],
    properties: {
      task_id: {
        type: "string",
        description: "The task's id (from get_card or list_card_tasks).",
        min: 1,
        max: 100,
        required: true,
      },
      title: { type: "string", description: "New title, 1 to 200 characters.", min: 1, max: 200 },
      due_date: {
        type: "date",
        description: "New due day, YYYY-MM-DD, or null to clear.",
        nullable: true,
      },
      due_time: {
        type: "time",
        description: "New due time, HH:MM (the team's time), or null to clear.",
        nullable: true,
      },
      assignee_id: {
        type: "string",
        description: "The card's owner or the connected person, or null for unassigned.",
        min: 1,
        max: 100,
        nullable: true,
      },
    },
    sql: "select public.agent_update_card_task($1::text, $2::text::jsonb) as r", // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
    params: (a) => {
      const patch: Record<string, Json> = {};
      for (const k of ["title", "due_date", "due_time", "assignee_id"] as const)
        if (k in a) patch[k] = a[k];
      return [a.task_id, JSON.stringify(patch)];
    },
  },
  {
    name: "complete_card_task",
    description: [
      "Tick a card task (done true, the default) or untick it (done false). Ticking the last open task does not close or remove anything: the card stays, with tasks_done equal to tasks_total and no next_due. A `note` is present only when the task was already in the state you asked for.",
      VTODO,
      "Result: the card as get_card shows it (without notes) plus `task`.",
    ].join(" "),
    write: true,
    properties: {
      task_id: {
        type: "string",
        description: "The task's id (from get_card or list_card_tasks).",
        min: 1,
        max: 100,
        required: true,
      },
      done: {
        type: "boolean",
        description: "true ticks it (default), false reopens it.",
        default: true,
      },
    },
    sql: "select public.agent_complete_card_task($1::text, $2::boolean) as r",
    params: (a) => [a.task_id, a.done ?? true],
  },
  {
    name: "add_card_note",
    description: [
      "Add a note to a pipeline card's running log, stamped with the time and the connected person as author. Notes are never edited or deleted through this connector.",
      CARD_WORDS,
      "Result: {card, note {id, author, body, created_at}, notes_count}.",
      BOARD_ID,
    ].join(" "),
    write: true,
    properties: {
      person_id: {
        type: "string",
        description: "The card's id (see below).",
        min: 1,
        max: 100,
        required: true,
      },
      body: {
        type: "string",
        description: "The note, 1 to 2000 characters.",
        min: 1,
        max: 2000,
        required: true,
      },
      board: BOARD_FIELD(false),
    },
    sql: "select public.agent_add_card_note($1::text, $2::text, $3::text) as r",
    params: (a) => [a.person_id, a.body, a.board ?? "recruiting"],
  },
];

export const TOOLS: readonly ToolDef[] = [
  {
    name: "whoami",
    description:
      "Who the connected person is: their name, stage and role, their team, today's date for the team, what this connection may do (access: read or write), `can` (the tool names this connection may call) and `team_size` (how many registered people are in their downline, the count list_team lists) and `open_tasks` (open card tasks assigned to them, or unassigned on cards they own: something to do). Call it first.",
    write: false,
    properties: {},
    sql: "select public.agent_whoami() as r",
    params: () => [],
  },
  {
    name: "list_prospects",
    description: [
      "List the connected person's prospects: people who are not registered yet, their own and their downline's. The registered team (apprentices and IBOs under them) is in list_team, and customers are in list_customers.",
      VCARD,
      "Each prospect: id, full_name, phone, email, location, notes, sponsor_id and sponsor_name (whose prospect it is: the connected person, or a member of their downline).",
      "Result: {total (all matches), limit, offset, prospects, note}; ordered by name. `note` is present only when the list is empty and says why and what to do (use add_prospect to add one).",
    ].join(" "),
    write: false,
    properties: LIST_FIELDS("prospects"),
    sql: "select public.agent_list_prospects($1::int, $2::text, $3::int) as r",
    params: (a) => [a.limit ?? 50, a.search ?? null, a.offset ?? 0],
  },
  {
    name: "list_team",
    description: [
      "List the connected person's TEAM: their downline, the registered people (apprentices and IBOs) below them on the sponsor line that they can see, never themselves. Prospects are in list_prospects and customers in list_customers.",
      VCARD,
      "Each person: id, full_name, stage (apprentice or ibo: the effective stage, so an apprentice past their first contract year is an ibo), sponsor_id, sponsor_name (null when the connected person cannot see the sponsor), level (1 = sponsored by the connected person, 2 = their downline's, and so on), phone, email, location and business_start_date (YYYY-MM-DD, ISO 8601).",
      "Result: {total (all matches), limit, offset, team, note}; ordered by level, then name. `note` is present only when the list is empty and says why (for example: You have no registered team members under you yet).",
    ].join(" "),
    write: false,
    properties: LIST_FIELDS("team members"),
    sql: "select public.agent_list_team($1::text, $2::int, $3::int) as r",
    params: (a) => [a.search ?? null, a.limit ?? 50, a.offset ?? 0],
  },
  {
    name: "list_customers",
    description: [
      "List the connected person's customers. Customers are private to their owner: the app and the database show a person only their own, a leader included, so this is the connected person's own customers; mine_only=false asks for every customer they can see, which is the same list.",
      VCARD,
      "Each customer: id, full_name, phone, email, location, owner_id and owner_name.",
      "Result: {total (all matches), limit, offset, customers, note}; ordered by name. `note` is present only when the list is empty and says why.",
    ].join(" "),
    write: false,
    properties: {
      mine_only: {
        type: "boolean",
        description: "Only the connected person's own customers (default true).",
        default: true,
      },
      ...LIST_FIELDS("customers"),
    },
    sql: "select public.agent_list_customers($1::boolean, $2::text, $3::int, $4::int) as r",
    params: (a) => [a.mine_only ?? true, a.search ?? null, a.limit ?? 50, a.offset ?? 0],
  },
  {
    name: "get_person",
    description: [
      "One person the connected person can see, by id (from list_team, list_prospects or list_customers; their own id is in whoami).",
      VCARD,
      "Result: id, kind (self, team, prospect or customer), full_name, phone, email, location, notes; for self and team also stage (the effective stage) and business_start_date (YYYY-MM-DD); for a team member their level below the connected person (as in list_team); sponsor {id, name} (a customer has owner {id, name} instead), null when the connected person cannot see that person.",
      "A person they cannot see, and an id that does not exist, get the same refusal.",
    ].join(" "),
    write: false,
    properties: {
      id: {
        type: "string",
        description: "The person's id.",
        min: 1,
        max: 100,
        required: true,
      },
    },
    sql: "select public.agent_get_person($1::text) as r",
    params: (a) => [a.id],
  },
  {
    name: "add_prospect",
    description:
      "Add a prospect under the connected person. Only a name and an optional phone number; use update_prospect to add more details afterwards.",
    write: true,
    properties: {
      name: {
        type: "string",
        description: "The prospect's name.",
        min: 1,
        max: 120,
        required: true,
      },
      phone: { type: "string", description: "Phone number (optional).", max: 40 },
    },
    sql: "select public.agent_add_prospect($1::text, $2::text) as r",
    params: (a) => [a.name, a.phone ?? null],
  },
  {
    name: "update_prospect",
    description:
      "Change a prospect's name, phone, email, location or notes. Send the id and only the fields to change; null clears a field (not the name). Nothing else about a person can be changed through this connector, and a field outside that list is refused.",
    write: true,
    requireOneOf: PATCH_FIELDS,
    properties: {
      id: {
        type: "string",
        description: "The prospect's id (from list_prospects).",
        min: 1,
        max: 100,
        required: true,
      },
      name: { type: "string", description: "New name.", min: 1, max: 120 },
      phone: {
        type: "string",
        description: "New phone number, or null to clear.",
        max: 40,
        nullable: true,
      },
      email: {
        type: "string",
        description: "New e-mail address, or null to clear.",
        max: 200,
        nullable: true,
      },
      location: {
        type: "string",
        description: "New location, or null to clear.",
        max: 200,
        nullable: true,
      },
      notes: {
        type: "string",
        description: "New notes (replaces the old text), or null to clear.",
        max: 4000,
        nullable: true,
      },
    },
    sql: "select public.agent_update_prospect($1::text, $2::text::jsonb) as r", // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
    params: (a) => {
      const patch: Record<string, Json> = {};
      for (const k of PATCH_FIELDS) if (k in a) patch[k] = a[k];
      return [a.id, JSON.stringify(patch)];
    },
  },
  {
    name: "update_my_profile",
    description: [
      "Change the connected person's OWN contact details, never anyone else's. Send only the fields to change; null clears phone, email or location (not full_name).",
      "Fields follow vCard (RFC 6350): full_name (FN), phone (TEL), email (EMAIL), location (ADR locality and region as one text).",
      "The e-mail here is contact information shown in the CRM; it does not change the address used to sign in.",
      "Nothing else about a person can be changed through this connector (stage, sponsor, IBO and LTD numbers, business start date, notes and the rest); such a field is refused by name and nothing changes.",
      "Result: the stored id, full_name, phone, email, location.",
    ].join(" "),
    write: true,
    requireOneOf: PROFILE_FIELDS,
    properties: {
      full_name: { type: "string", description: "New full name.", min: 1, max: 120 },
      phone: {
        type: "string",
        description: "New phone number, or null to clear.",
        max: 40,
        nullable: true,
      },
      email: {
        type: "string",
        description: "New contact e-mail address, or null to clear.",
        max: 200,
        nullable: true,
      },
      location: {
        type: "string",
        description: "New location (for example: Austin, TX), or null to clear.",
        max: 200,
        nullable: true,
      },
    },
    sql: "select public.agent_update_my_profile($1::text::jsonb) as r", // ::text::jsonb: postgres.js double-encodes a string bound as jsonb
    params: (a) => {
      const patch: Record<string, Json> = {};
      for (const k of PROFILE_FIELDS) if (k in a) patch[k] = a[k];
      return [JSON.stringify(patch)];
    },
  },
  {
    name: "list_upcoming_events",
    description: LIST_EVENTS_DESCRIPTION,
    write: false,
    properties: EVENT_WINDOW_PROPERTIES(true),
    sql: "select public.agent_list_upcoming_events($1::date, $2::date, $3::timestamptz) as r",
    params: (a) => [a.from ?? null, a.until ?? null, a.changed_since ?? null],
  },
  {
    name: "export_events_ics",
    description: EXPORT_ICS_DESCRIPTION,
    write: false,
    properties: EVENT_WINDOW_PROPERTIES(false),
    sql: "select public.agent_export_events_ics($1::date, $2::date) as r",
    params: (a) => [a.from ?? null, a.until ?? null],
    format: (raw, now) => icsFromData(raw as IcsData, now),
  },
  {
    name: "set_event_answer",
    description:
      "Set the connected person's own answer to an event: yes, no or maybe. It only ever sets their own answer, never anyone else's.",
    write: true,
    properties: {
      event_id: {
        type: "string",
        description: "The event's id (from list_upcoming_events).",
        min: 1,
        max: 100,
        required: true,
      },
      answer: {
        type: "string",
        description: "yes, no or maybe.",
        enum: ["yes", "no", "maybe"],
        required: true,
      },
    },
    sql: "select public.agent_set_event_answer($1::text, $2::text) as r",
    params: (a) => [a.event_id, a.answer],
  },
  {
    name: "log_learning",
    description: [
      "Log ONE learning entry for the connected person (never for anyone else), as the app's Log learning form does. Dates are ISO 8601 (YYYY-MM-DD); there is no external standard for the rest.",
      "kind: pages (reading), podcast, workshop or conference.",
      "unit: only reading and podcasts take one: reading in minutes, pages (default) or chapters; a podcast in minutes or episodes (default). A workshop or conference takes no unit and counts as one entry (leave amount out).",
      "amount: required for reading and a podcast, a whole number from 1 to 100000 in the unit.",
      "title: optional (the book, the show); empty is stored as Unnamed, as the app does.",
      "date: default the team's today; not in the future, not before 2000-01-01.",
      "Result: the stored entry {id, kind, title, amount, unit, date, created_at}. It is not deduplicated: logging the same thing twice makes two entries, so do not retry a call that succeeded.",
    ].join(" "),
    write: true,
    properties: {
      kind: {
        type: "string",
        description: "pages (reading), podcast, workshop or conference.",
        enum: ["pages", "podcast", "workshop", "conference"],
        required: true,
      },
      title: {
        type: "string",
        description: "What it was (a book, a show, an event); empty means Unnamed.",
        max: 200,
        nullable: true,
      },
      amount: {
        type: "integer",
        description:
          "How much, in the unit: a whole number from 1 to 100000. Not for a workshop or conference.",
        min: 1,
        max: 100000,
      },
      unit: {
        type: "string",
        description:
          "Reading: minutes, pages (default) or chapters. Podcast: minutes or episodes (default). None for a workshop or conference.",
        enum: ["minutes", "pages", "chapters", "episodes"],
      },
      date: {
        type: "date",
        description:
          "The day it happened, YYYY-MM-DD (default the team's today; not in the future).",
      },
    },
    sql: "select public.agent_log_learning($1::text, $2::text, $3::int, $4::text, $5::date) as r",
    params: (a) => [a.kind, a.title ?? null, a.amount ?? null, a.unit ?? null, a.date ?? null],
  },
  {
    name: "list_learning",
    description: [
      "The connected person's OWN learning entries (never their team's) from a date to a date, newest first, with totals per kind for the window. Dates are ISO 8601 (YYYY-MM-DD); there is no external standard for the rest.",
      "Arguments: from and until, both days inclusive (default the last 30 days, ending on the team's today; at most 367 days).",
      "Result: {from, until, truncated (true when more than 500 entries matched; the totals still count them all), entries, totals}. Each entry: id, kind, title, amount, unit (an entry stored without one shows the unit the app counts it in: pages for reading, episodes for a podcast), date. Each total: kind, unit, entries (how many), amount (their sum); minutes and pages are never added together, so a kind can have several totals.",
    ].join(" "),
    write: false,
    properties: {
      from: { type: "date", description: "First day, YYYY-MM-DD (default 29 days before until)." },
      until: { type: "date", description: "Last day, YYYY-MM-DD (default the team's today)." },
    },
    sql: "select public.agent_list_learning($1::date, $2::date) as r",
    params: (a) => [a.from ?? null, a.until ?? null],
  },
  ...CARD_TOOLS,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export function findTool(name: string): ToolDef | undefined {
  return BY_NAME.get(name);
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: false;
}

export function inputSchema(t: ToolDef): JsonSchema {
  const properties: JsonSchema["properties"] = {};
  const required: string[] = [];
  for (const [k, f] of Object.entries(t.properties)) {
    const p: Record<string, unknown> = {
      type: f.nullable ? [f.type, "null"] : f.type,
      description: f.description,
    };
    if (f.type === "string") {
      if (f.min !== undefined) p.minLength = f.min;
      if (f.max !== undefined) p.maxLength = f.max;
    } else if (f.type === "date" || f.type === "timestamp") {
      p.type = "string";
      p.format = f.type === "date" ? "date" : "date-time";
    } else if (f.type === "time") {
      p.type = f.nullable ? ["string", "null"] : "string";
      p.pattern = "^([01][0-9]|2[0-3]):[0-5][0-9]$";
    } else {
      if (f.min !== undefined) p.minimum = f.min;
      if (f.max !== undefined) p.maximum = f.max;
    }
    if (f.default !== undefined) p.default = f.default;
    if (f.enum) p.enum = [...f.enum];
    properties[k] = p;
    if (f.required) required.push(k);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/** The tool list as the plain HTTP surface and the pairing reply show it. */
export function toolList() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    changes_data: t.write,
    input_schema: inputSchema(t),
  }));
}

const chars = (s: string) => Array.from(s).length;

/** A real calendar date, "YYYY-MM-DD" (2000 to 2100 is checked again in SQL). */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** A wall-clock time of day, "HH:MM" (24 hours). */
export function isTime(s: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

/** An ISO 8601 date-time that names its offset (Z or +hh:mm), so it is one instant. */
export function isTimestamp(s: string): boolean {
  const m =
    /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/.exec(
      s,
    );
  return m !== null && isDate(m[1]) && !Number.isNaN(Date.parse(s));
}

export type Validated = { ok: true; args: Record<string, Json> } | { ok: false; error: string };

/** Check a call's arguments against the entry; unknown fields are refused, never ignored. */
export function validateArgs(t: ToolDef, raw: unknown): Validated {
  const input = raw === undefined || raw === null ? {} : raw;
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Invalid arguments: send a JSON object." };
  }
  const given = input as Record<string, unknown>;
  const names = Object.keys(t.properties);
  const problems: string[] = [];
  for (const k of Object.keys(given)) {
    if (!Object.hasOwn(t.properties, k)) {
      problems.push(
        `${k}: not a field of ${t.name}` +
          (names.length ? ` (allowed: ${names.join(", ")})` : " (it takes no arguments)"),
      );
    }
  }
  const args: Record<string, Json> = {};
  for (const [k, f] of Object.entries(t.properties)) {
    if (!Object.hasOwn(given, k) || given[k] === undefined) {
      if (f.required) problems.push(`${k}: required`);
      else if (f.default !== undefined) args[k] = f.default;
      continue;
    }
    const v = given[k];
    if (v === null) {
      if (f.nullable) args[k] = null;
      else problems.push(`${k}: cannot be null`);
      continue;
    }
    if (f.type === "date") {
      if (typeof v !== "string" || !isDate(v)) problems.push(`${k}: must be a date, YYYY-MM-DD`);
      else args[k] = v;
    } else if (f.type === "time") {
      if (typeof v !== "string" || !isTime(v))
        problems.push(`${k}: must be a time of day, HH:MM (24 hours)`);
      else args[k] = v;
    } else if (f.type === "timestamp") {
      if (typeof v !== "string" || !isTimestamp(v))
        problems.push(
          `${k}: must be an ISO 8601 time with an offset or Z, e.g. 2026-11-14T18:00:00Z`,
        );
      else args[k] = v;
    } else if (f.type === "string") {
      if (typeof v !== "string") problems.push(`${k}: must be text`);
      else if (f.enum && !f.enum.includes(v))
        problems.push(`${k}: must be one of ${f.enum.join(", ")}`);
      else if (f.min !== undefined && chars(v.trim()) < f.min)
        problems.push(`${k}: must not be empty`);
      else if (f.max !== undefined && chars(v) > f.max)
        problems.push(`${k}: at most ${f.max} characters`);
      else args[k] = v;
    } else if (f.type === "boolean") {
      if (typeof v !== "boolean") problems.push(`${k}: must be true or false`);
      else args[k] = v;
    } else if (typeof v !== "number" || !Number.isInteger(v)) {
      problems.push(`${k}: must be a whole number`);
    } else if ((f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
      problems.push(`${k}: must be between ${f.min} and ${f.max}`);
    } else args[k] = v;
  }
  if (t.requireOneOf && problems.length === 0 && !t.requireOneOf.some((k) => k in args)) {
    problems.push("nothing to change: give at least one of " + t.requireOneOf.join(", "));
  }
  if (problems.length) return { ok: false, error: "Invalid arguments: " + problems.join("; ") };
  return { ok: true, args };
}
