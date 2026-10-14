/**
 * Generates supabase/seed.sql from the app's demo seeds, so the demo data
 * stays defined in one place:
 *   - CRM: src/data/seed.ts (people, events, attendance, contacts, ...)
 *   - chat: src/data/chat/seed.ts seedChat() (every chat table, row for row)
 *   - library: src/data/library/seed.ts seedLibrary() (catalog, channels, progress)
 *   - pipeline: src/data/pipeline/seed.ts seedPipeline() (steps, cards, moves,
 *     goals, stat shares and requests)
 * plus the local demo logins. Also generates the visibility-parity pgTAP test
 * (supabase/tests/001_visibility_parity.test.sql) from src/data/access.ts.
 *
 * Run with `npm run db:seed` (`npm run db:reset` runs it first).
 *
 * Dates stay relative: a "YYYY-MM-DD" N days from today becomes
 * `seed_tmp.d(N)` (today in the workspace's time zone at reset time) and an
 * ISO timestamp becomes `seed_tmp.ts(seconds from now)`.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { differenceInCalendarDays } from "date-fns";
import { localDate, parseDate } from "@/lib/dates";
import {
  seedActivity,
  seedAttendances,
  seedMissedNotes,
  seedContacts,
  seedEvents,
  seedLearning,
  seedLearningGoals,
  seedMilestoneMarks,
  seedOps,
  seedPeople,
  seedPvOverrides,
  seedSales,
} from "@/data/seed";
import { seedChat } from "@/data/chat/seed";
import { seedLibrary } from "@/data/library/seed";
import { seedPipeline } from "@/data/pipeline/seed";
import { seedCustomerPipeline } from "@/data/customerPipeline/seed";
import { seedDeputies, seedFeatureSwitches } from "@/data/team/seed";
import { deputyOfIds } from "@/data/team/rules";
import { visibleEntries } from "@/data/customerPipeline/rules";
import { WORKSPACE_ID } from "@/data/chat/types";
import { filterAttendances, visibleCustomers, visibleIdSet, type Viewer } from "@/data/access";
import type { CrmPerson } from "@/stores/peopleStore";

/**
 * The demo users (DEMO_USERS in src/stores/sessionStore.ts, not imported
 * because that module reads Vite's import.meta.env). Each gets a local login
 * <first name>@levelup.test with DEMO_PASSWORD.
 */
const DEMO_USERS = [
  { personId: "1", name: "Maria Reyes", role: "leader" },
  { personId: "2", name: "Anita Patel", role: "ibo" },
  { personId: "4", name: "Jamal Brown", role: "apprentice" },
  { personId: "20", name: "Beau Foster", role: "candidate" },
  { personId: "700", name: "Tasha Greene", role: "apprentice" },
  // Maria's deputy (src/data/team/seed.ts).
  { personId: "6", name: "Marcus Hill", role: "ibo" },
  // The admin login (admin@levelup.test): an app_admins row, and Maria's deputy.
  { personId: "800", name: "Admin Tester", role: "ibo", admin: true },
] as const;
const loginEmail = (name: string) => `${name.split(" ")[0].toLowerCase()}@levelup.test`;
/** Local development only. Documented in docs/backend.md. */
const DEMO_PASSWORD = "levelup-local";
const TIMEZONE = "America/Chicago";

const NOW = Date.now();
const TODAY = localDate();
const userId = (personId: string) => `00000000-0000-4000-8000-${personId.padStart(12, "0")}`;

/** pgTAP helpers: act as a demo user (by person id) or as the postgres owner. */
const LOGIN_HELPERS = `-- Act as a person: gives them a local auth user (and links their member row)
-- if they have none yet, then switches to the authenticated role.
create function pg_temp.login(p_person text) returns void language plpgsql as $$
declare
  v_uid uuid := ('00000000-0000-4000-8000-' || lpad(p_person, 12, '0'))::uuid;
begin
  perform set_config('role', 'postgres', true);
  insert into auth.users (instance_id, id, aud, role, email)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'person' || p_person || '@levelup.test')
  on conflict (id) do nothing;
  update public.members set user_id = v_uid where person_id = p_person and user_id is null;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-8000-' || lpad(p_person, 12, '0'), 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;`;

// ---------------------------------------------------------------------------
// SQL literals
// ---------------------------------------------------------------------------

type ColType = "text" | "date" | "ts" | "num" | "bool" | "json" | "textarr";

const str = (s: string) => `'${s.replace(/'/g, "''")}'`;
const dateExpr = (iso: string) =>
  `seed_tmp.d(${differenceInCalendarDays(parseDate(iso.slice(0, 10)), parseDate(TODAY))})`;
/** A "YYYY-MM" month as the same number of months before the reset month. */
const monthExpr = (month: string) => {
  const k =
    Number(TODAY.slice(0, 4)) * 12 +
    Number(TODAY.slice(5, 7)) -
    (Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)));
  return `to_char(date_trunc('month', seed_tmp.d(0)::timestamp) - interval '${k} months', 'YYYY-MM')`;
};
const tsExpr = (iso: string) => `seed_tmp.ts(${Math.round((Date.parse(iso) - NOW) / 1000)})`;

function lit(v: unknown, type: ColType): string {
  if (v === undefined || v === null) return "null";
  switch (type) {
    case "text":
      return str(String(v));
    case "date":
      return dateExpr(String(v));
    case "ts":
      return tsExpr(String(v));
    case "num":
      return String(Number(v));
    case "bool":
      return v ? "true" : "false";
    case "json":
      return `${str(JSON.stringify(v))}::jsonb`;
    case "textarr":
      return `array[${(v as string[]).map(str).join(", ")}]::text[]`;
  }
}

/** A raw SQL expression (bypasses quoting). */
class Sql {
  constructor(public readonly sql: string) {}
}
const raw = (sql: string) => new Sql(sql);

function insert(table: string, cols: [string, ColType][], rows: unknown[][]): string {
  if (!rows.length) return `-- ${table}: no rows\n`;
  const names = cols.map(([c]) => c).join(", ");
  const values = rows
    .map(
      (r) => `  (${r.map((v, i) => (v instanceof Sql ? v.sql : lit(v, cols[i][1]))).join(", ")})`,
    )
    .join(",\n");
  return `insert into ${table} (${names}) values\n${values};\n`;
}

const stageHistory = (p: CrmPerson) =>
  raw(
    p.stageHistory?.length
      ? `jsonb_build_array(${p.stageHistory
          .map((h) => `jsonb_build_object('stage', ${str(h.stage)}, 'at', ${tsExpr(h.at)})`)
          .join(", ")})`
      : `'[]'::jsonb`,
  );

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const people = seedPeople();
const events = seedEvents();
const attendances = seedAttendances();
const missedNotes = seedMissedNotes();
const contacts = seedContacts(people);
const sales = seedSales();
const pvOverrides = seedPvOverrides();
const milestoneMarks = seedMilestoneMarks();
const learning = seedLearning();
const goals = seedLearningGoals();
const ops = seedOps();
const activity = seedActivity(people, attendances);
const chat = seedChat(people, NOW);
const library = seedLibrary(new Date(NOW));
const pipeline = seedPipeline(people, new Date(NOW));
const customerPipeline = seedCustomerPipeline(people, new Date(NOW));

// Workspace members: the chat seed's members (apprentices, IBOs, the leader)
// plus any demo user who isn't one (Beau, the candidate: can sign in, no chat).
const members = [
  ...chat.members,
  ...DEMO_USERS.filter((u) => !chat.members.some((m) => m.personId === u.personId)).map((u) => ({
    workspaceId: WORKSPACE_ID,
    personId: u.personId,
    role: "member" as const,
    joinedAt: new Date(NOW - 14 * 86_400_000).toISOString(),
  })),
];
const demoIds = new Set<string>(DEMO_USERS.map((u) => u.personId));

// ---------------------------------------------------------------------------
// seed.sql
// ---------------------------------------------------------------------------

const out: string[] = [];
const emit = (s: string) => out.push(s);
const section = (title: string) =>
  emit(`\n-- ${title} ${"-".repeat(Math.max(4, 72 - title.length))}\n`);

emit(`-- GENERATED by scripts/db/generate-seed.ts from src/data/seed.ts and
-- src/data/chat/seed.ts. Do not edit by hand: run \`npm run db:seed\`.
-- Dates are relative to the moment the seed runs (npm run db:reset).

create schema if not exists seed_tmp;
-- Today in the workspace's time zone, plus n days.
create or replace function seed_tmp.d(n integer) returns date language sql stable
  as $$ select (now() at time zone ${str(TIMEZONE)})::date + n $$;
-- now() plus n seconds (negative = past).
create or replace function seed_tmp.ts(n bigint) returns timestamptz language sql stable
  as $$ select now() + make_interval(secs => n) $$;
`);

section("Workspace");
emit(
  insert(
    "public.workspaces",
    [
      ["id", "text"],
      ["name", "text"],
      ["colors", "json"],
      ["timezone", "text"],
    ],
    [
      [
        WORKSPACE_ID,
        "LevelUp",
        { navy: "#1a365d", teal: "#067781", sky: "#199bd7", amber: "#f2a93b" },
        TIMEZONE,
      ],
    ],
  ),
);

section("People (seedPeople)");
emit(
  insert(
    "public.people",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["name", "text"],
      ["email", "text"],
      ["phone", "text"],
      ["biz_class", "text"],
      ["ibo_number", "text"],
      ["ltd_number", "text"],
      ["location", "text"],
      ["sponsor_id", "text"],
      ["business_start_date", "date"],
      ["joined_date", "date"],
      ["owner_id", "text"],
      ["monthly_volume", "num"],
      ["notes", "text"],
      ["pipeline_stage", "text"],
      ["stage_history", "json"],
      ["tags", "textarr"],
      ["los_uid", "text"],
      ["ditto_since", "date"],
    ],
    people.map((p) => [
      p.id,
      WORKSPACE_ID,
      p.name,
      p.email,
      p.phone,
      p.bizClass,
      p.iboNumber,
      p.ltdNumber,
      p.location,
      p.sponsorId,
      p.businessStartDate,
      p.joinedDate,
      p.ownerId,
      p.monthlyVolume,
      p.notes,
      p.pipelineStage,
      stageHistory(p),
      p.tags ?? [],
      p.losUid,
      p.dittoSince,
    ]),
  ),
);

section("Demo logins (local only; password in docs/backend.md)");
for (const u of DEMO_USERS) {
  const id = userId(u.personId);
  const email = loginEmail(u.name);
  emit(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  is_sso_user, is_anonymous)
values ('00000000-0000-0000-0000-000000000000', ${str(id)}, 'authenticated', 'authenticated',
  ${str(email)}, extensions.crypt(${str(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, ${str(JSON.stringify({ name: u.name }))}::jsonb,
  now(), now(), '', '', '', '', '', '', '', '', false, false);
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (${str(id)}, ${str(id)}, ${str(id)},
  ${str(JSON.stringify({ sub: id, email, email_verified: true }))}::jsonb, 'email', now(), now(), now());
`);
}

section("Events, attendance, travel, shared costs");
emit(
  insert(
    "public.events",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["name", "text"],
      ["type", "text"],
      ["date", "date"],
      ["end_date", "date"],
      ["location", "text"],
      ["notes", "text"],
      ["format", "text"],
      ["created_by", "text"],
    ],
    events.map((e) => [
      e.id,
      WORKSPACE_ID,
      e.name,
      e.type,
      e.date,
      e.endDate,
      e.location,
      e.notes,
      e.format ?? "in_person",
      "1",
    ]),
  ),
);
emit(
  insert(
    "public.attendances",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["event_id", "text"],
      ["person_id", "text"],
      ["desire_to_attend", "text"],
      ["follow_up_date", "date"],
      ["has_ticket", "bool"],
      ["mode", "text"],
      ["planned_purchase_date", "date"],
      ["helper_id", "text"],
      ["leadership_qualified", "bool"],
      ["special_event_qualified", "bool"],
      ["notes", "text"],
      ["attended", "bool"],
    ],
    attendances.map((a) => [
      a.id,
      WORKSPACE_ID,
      a.eventId,
      a.personId,
      a.desireToAttend,
      a.followUpDate,
      a.hasTicket,
      a.mode,
      a.plannedPurchaseDate,
      a.helperId,
      a.leadershipQualified,
      a.specialEventQualified,
      a.notes,
      a.attended,
    ]),
  ),
);
emit(
  insert(
    "public.missed_event_notes",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["person_id", "text"],
      ["event_id", "text"],
      ["note", "text"],
      ["by_id", "text"],
      ["created_at", "ts"],
    ],
    missedNotes.map((n) => [
      n.id,
      WORKSPACE_ID,
      n.personId,
      n.eventId,
      n.note,
      n.byId,
      n.createdAt,
    ]),
  ),
);
emit(
  insert(
    "public.logistics",
    [
      ["workspace_id", "text"],
      ["event_id", "text"],
      ["person_id", "text"],
      ["ticket", "text"],
      ["plan_date", "date"],
      ["mode", "text"],
      ["flight_booked", "bool"],
      ["carpool", "text"],
      ["van_paid", "text"],
      ["van_pay_date", "date"],
    ],
    Object.entries(ops.logistics).map(([key, l]) => {
      const [eventId, personId] = key.split(":");
      return [
        WORKSPACE_ID,
        eventId,
        personId,
        l.ticket,
        l.planDate,
        l.mode,
        l.flightBooked,
        l.carpool,
        l.vanPaid,
        l.vanPayDate,
      ];
    }),
  ),
);
emit(
  insert(
    "public.shared_costs",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["event_id", "text"],
      ["name", "text"],
      ["total", "num"],
      ["owner_id", "text"],
    ],
    ops.costs.map((c) => [c.id, WORKSPACE_ID, c.eventId, c.name, c.total, c.ownerId]),
  ),
);
emit(
  insert(
    "public.shared_cost_members",
    [
      ["cost_id", "text"],
      ["person_id", "text"],
    ],
    ops.costs.flatMap((c) => c.members.map((m) => [c.id, m])),
  ).replace(/;\n$/, "\non conflict do nothing;\n"),
);
emit(
  insert(
    "public.cost_overrides",
    [
      ["cost_id", "text"],
      ["person_id", "text"],
      ["amount", "num"],
    ],
    ops.costs.flatMap((c) => Object.entries(c.overrides).map(([p, amt]) => [c.id, p, amt])),
  ),
);

section("Contacts, sales, learning, goals");
emit(
  insert(
    "public.contacts",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["person_id", "text"],
      ["by_id", "text"],
      ["date", "date"],
      ["note", "text"],
      ["source", "text"],
    ],
    contacts.map((c) => [
      c.id,
      WORKSPACE_ID,
      c.personId,
      c.byId,
      c.date,
      c.note,
      (c as { source?: string }).source ?? "manual",
    ]),
  ),
);
emit(
  insert(
    "public.sales",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["customer_id", "text"],
      ["product", "text"],
      ["date", "date"],
      ["amount", "num"],
      ["pv", "num"],
      ["person_id", "text"],
    ],
    sales.map((s) => [
      s.id,
      WORKSPACE_ID,
      s.customerId,
      s.product,
      s.date,
      s.amount,
      s.pv,
      s.personId,
    ]),
  ),
);
emit(
  insert(
    "public.pv_overrides",
    [
      ["person_id", "text"],
      ["month", "text"],
      ["workspace_id", "text"],
      ["pv", "num"],
      ["set_by", "text"],
      ["set_at", "ts"],
    ],
    pvOverrides.map((o) => [
      o.personId,
      raw(monthExpr(o.month)),
      WORKSPACE_ID,
      o.pv,
      o.setBy,
      o.setAt,
    ]),
  ),
);
emit(
  insert(
    "public.milestone_marks",
    [
      ["person_id", "text"],
      ["code", "text"],
      ["workspace_id", "text"],
      ["reached_on", "date"],
      ["marked_by", "text"],
      ["marked_at", "ts"],
      ["note", "text"],
    ],
    milestoneMarks.map((k) => [
      k.personId,
      k.code,
      WORKSPACE_ID,
      k.reachedOn,
      k.markedBy,
      k.markedAt,
      k.note,
    ]),
  ),
);
emit(
  insert(
    "public.learning",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["person_id", "text"],
      ["kind", "text"],
      ["title", "text"],
      ["amount", "num"],
      ["unit", "text"],
      ["date", "date"],
    ],
    learning.map((l) => [
      l.id,
      WORKSPACE_ID,
      l.personId,
      l.kind,
      l.title,
      l.amount,
      l.unit ?? null,
      l.date,
    ]),
  ),
);
emit(
  insert(
    "public.learning_goals",
    [
      ["person_id", "text"],
      ["workspace_id", "text"],
      ["pages", "num"],
      ["podcasts", "num"],
      ["workshops", "num"],
      ["reading_unit", "text"],
      ["podcast_unit", "text"],
    ],
    Object.entries(goals).map(([p, g]) => [
      p,
      WORKSPACE_ID,
      g.pages,
      g.podcasts,
      g.workshops,
      g.readingUnit ?? null,
      g.podcastUnit ?? null,
    ]),
  ),
);

section("Activity timeline");
emit(
  insert(
    "public.activity",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ['"timestamp"', "ts"],
      ["actor_name", "text"],
      ["entity_type", "text"],
      ["entity_id", "text"],
      ["related_person_id", "text"],
      ["related_event_id", "text"],
      ["kind", "text"],
      ["summary", "text"],
      ["meta", "json"],
    ],
    activity.map((a) => [
      a.id,
      WORKSPACE_ID,
      a.timestamp,
      a.actorName,
      a.entityType,
      a.entityId,
      a.relatedPersonId,
      a.relatedEventId,
      a.kind,
      a.summary,
      a.meta,
    ]),
  ),
);

section("Library (seedLibrary)");
emit(
  insert(
    "public.library_topics",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["name", "text"],
      ["created_by", "text"],
      ["created_at", "ts"],
    ],
    library.topics.map((t) => [t.id, t.workspaceId, t.name, t.createdBy, t.createdAt]),
  ),
);
emit(
  insert(
    "public.library_items",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["title", "text"],
      ["description", "text"],
      ["kind", "text"],
      ["source", "text"],
      ["storage_path", "text"],
      ["mime", "text"],
      ["size_bytes", "num"],
      ["file_name", "text"],
      ["link_url", "text"],
      ["link_provider", "text"],
      ["duration_sec", "num"],
      ["page_count", "num"],
      ["format", "text"],
      ["event_id", "text"],
      ["recorded_on", "date"],
      ["created_by", "text"],
      ["permission_confirmed", "bool"],
      ["visibility", "text"],
      ["created_at", "ts"],
      ["updated_at", "ts"],
    ],
    library.items.map((i) => [
      i.id,
      i.workspaceId,
      i.title,
      i.description,
      i.kind,
      i.source,
      i.storagePath,
      i.mime,
      i.sizeBytes,
      i.fileName,
      i.linkUrl,
      i.linkProvider,
      i.durationSec,
      i.pageCount,
      i.format,
      i.eventId,
      i.recordedOn,
      i.createdBy,
      i.permissionConfirmed,
      i.visibility,
      i.createdAt,
      i.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.library_item_speakers",
    [
      ["item_id", "text"],
      ["position", "num"],
      ["person_id", "text"],
      ["name", "text"],
    ],
    library.items.flatMap((i) => i.speakers.map((sp, n) => [i.id, n, sp.personId, sp.name])),
  ),
);
emit(
  insert(
    "public.library_item_topics",
    [
      ["item_id", "text"],
      ["topic_id", "text"],
    ],
    library.items.flatMap((i) => i.topicIds.map((t) => [i.id, t])),
  ),
);
emit(
  insert(
    "public.library_channels",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["title", "text"],
      ["description", "text"],
      ["icon", "text"],
      ["color", "text"],
      ["created_by", "text"],
      ["visibility", "text"],
      ["created_at", "ts"],
      ["updated_at", "ts"],
    ],
    library.channels.map((c) => [
      c.id,
      c.workspaceId,
      c.title,
      c.description,
      c.icon,
      c.color,
      c.createdBy,
      c.visibility,
      c.createdAt,
      c.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.library_channel_sections",
    [
      ["id", "text"],
      ["channel_id", "text"],
      ["position", "num"],
      ["title", "text"],
    ],
    library.channels.flatMap((c) => c.sections.map((sec, n) => [sec.id, c.id, n, sec.title])),
  ),
);
emit(
  insert(
    "public.library_channel_items",
    [
      ["section_id", "text"],
      ["item_id", "text"],
      ["channel_id", "text"],
      ["position", "num"],
    ],
    library.channels.flatMap((c) =>
      c.sections.flatMap((sec) => sec.itemIds.map((id, n) => [sec.id, id, c.id, n])),
    ),
  ),
);
// Finished rows carry logged_at, so the trigger doesn't log them again.
emit(
  insert(
    "public.library_progress",
    [
      ["person_id", "text"],
      ["item_id", "text"],
      ["workspace_id", "text"],
      ["position_sec", "num"],
      ["completed_at", "ts"],
      ["logged_at", "ts"],
      ["updated_at", "ts"],
    ],
    library.progress.map((r) => [
      r.personId,
      r.itemId,
      WORKSPACE_ID,
      r.positionSec,
      r.completedAt,
      r.loggedAt,
      r.updatedAt,
    ]),
  ),
);

section("Pipeline (seedPipeline)");
emit(`-- History moves of prospects who have left the CRM keep their "x..." person
-- ids (moves keep no link to people). Stat request notifications come with
-- the chat seed, so the request trigger is off while they load.
alter table public.stat_requests disable trigger user;

`);
emit(
  insert(
    "public.pipeline_steps",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["owner_id", "text"],
      ["band", "text"],
      ["label", "text"],
      ["position", "num"],
      ["created_at", "ts"],
    ],
    pipeline.steps.map((x) => [
      x.id,
      WORKSPACE_ID,
      x.ownerId,
      x.band,
      x.label,
      x.position,
      x.createdAt,
    ]),
  ),
);
emit(
  insert(
    "public.pipeline_step_hides",
    [
      ["person_id", "text"],
      ["step_id", "text"],
      ["workspace_id", "text"],
      ["created_at", "ts"],
    ],
    pipeline.hides.map((h) => [h.personId, h.stepId, WORKSPACE_ID, h.createdAt]),
  ),
);
emit(
  insert(
    "public.pipeline_cards",
    [
      ["person_id", "text"],
      ["workspace_id", "text"],
      ["column_id", "text"],
      ["entered_at", "ts"],
      ["next_step", "text"],
      ["next_step_date", "date"],
      ["hot", "bool"],
      ["source", "text"],
      ["dropped_at", "ts"],
      ["updated_at", "ts"],
    ],
    pipeline.cards.map((c) => [
      c.personId,
      WORKSPACE_ID,
      c.column,
      c.enteredAt,
      c.nextStep,
      c.nextStepDate,
      c.hot,
      c.source,
      c.droppedAt,
      c.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.pipeline_moves",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["person_id", "text"],
      ["owner_id", "text"],
      ["from_column", "text"],
      ["to_column", "text"],
      ["milestone", "text"],
      ["moved_at", "ts"],
      ["moved_by", "text"],
    ],
    pipeline.moves.map((m) => [
      m.id,
      WORKSPACE_ID,
      m.personId,
      m.ownerId,
      m.from,
      m.to,
      m.milestone,
      m.movedAt,
      m.movedBy,
    ]),
  ),
);
emit(
  insert(
    "public.pipeline_team_settings",
    [
      ["person_id", "text"],
      ["workspace_id", "text"],
      ["mg1_goal", "num"],
      ["target_contact_to_meeting", "num"],
      ["target_meeting_to_plan", "num"],
      ["target_plan_to_registered", "num"],
      ["updated_at", "ts"],
    ],
    pipeline.settings.map((t) => [
      t.personId,
      WORKSPACE_ID,
      t.mg1Goal,
      t.targets?.contactToMeeting,
      t.targets?.meetingToPlan,
      t.targets?.planToRegistered,
      t.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.stat_shares",
    [
      ["owner_id", "text"],
      ["viewer_id", "text"],
      ["workspace_id", "text"],
      ["created_at", "ts"],
    ],
    pipeline.shares.map((x) => [x.ownerId, x.viewerId, WORKSPACE_ID, x.createdAt]),
  ),
);
emit(
  insert(
    "public.stat_requests",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["requester_id", "text"],
      ["owner_id", "text"],
      ["status", "text"],
      ["created_at", "ts"],
      ["decided_at", "ts"],
    ],
    pipeline.requests.map((r) => [
      r.id,
      WORKSPACE_ID,
      r.requesterId,
      r.ownerId,
      r.status,
      r.createdAt,
      r.decidedAt,
    ]),
  ),
);
emit(`
alter table public.stat_requests enable trigger user;
`);

section("Your list and the customer pipeline (seedCustomerPipeline)");
emit(`-- History moves of names no longer on a list keep their "xl-..." entry ids
-- (moves keep no link to entries). Names at First sale / On Ditto link to
-- the seed's existing customers, so no people are made here.
`);
emit(
  insert(
    "public.list_entries",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["owner_id", "text"],
      ["name", "text"],
      ["how_known", "text"],
      ["phone", "text"],
      ["email", "text"],
      ["notes", "text"],
      ["rating", "text"],
      ["customer_id", "text"],
      ["prospect_id", "text"],
      ["added_by", "text"],
      ["created_at", "ts"],
      ["updated_at", "ts"],
    ],
    customerPipeline.entries.map((e) => [
      e.id,
      WORKSPACE_ID,
      e.ownerId,
      e.name,
      e.howKnown,
      e.phone,
      e.email,
      e.notes,
      e.rating,
      e.customerId,
      e.prospectId,
      e.addedBy,
      e.createdAt,
      e.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.customer_steps",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["owner_id", "text"],
      ["band", "text"],
      ["label", "text"],
      ["position", "num"],
      ["created_at", "ts"],
    ],
    customerPipeline.steps.map((x) => [
      x.id,
      WORKSPACE_ID,
      x.ownerId,
      x.band,
      x.label,
      x.position,
      x.createdAt,
    ]),
  ),
);
if (customerPipeline.hides.length)
  emit(
    insert(
      "public.customer_step_hides",
      [
        ["person_id", "text"],
        ["step_id", "text"],
        ["workspace_id", "text"],
        ["created_at", "ts"],
      ],
      customerPipeline.hides.map((h) => [h.personId, h.stepId, WORKSPACE_ID, h.createdAt]),
    ),
  );
emit(
  insert(
    "public.customer_cards",
    [
      ["entry_id", "text"],
      ["workspace_id", "text"],
      ["column_id", "text"],
      ["entered_at", "ts"],
      ["next_step", "text"],
      ["next_step_date", "date"],
      ["updated_at", "ts"],
    ],
    customerPipeline.cards.map((c) => [
      c.entryId,
      WORKSPACE_ID,
      c.column,
      c.enteredAt,
      c.nextStep,
      c.nextStepDate,
      c.updatedAt,
    ]),
  ),
);
emit(
  insert(
    "public.customer_moves",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["entry_id", "text"],
      ["owner_id", "text"],
      ["from_column", "text"],
      ["to_column", "text"],
      ["band", "text"],
      ["moved_at", "ts"],
      ["moved_by", "text"],
      ["created_customer_id", "text"],
      ["set_ditto", "bool"],
    ],
    customerPipeline.moves.map((m) => [
      m.id,
      WORKSPACE_ID,
      m.entryId,
      m.ownerId,
      m.from,
      m.to,
      m.band,
      m.movedAt,
      m.movedBy,
      m.createdCustomerId,
      m.setDitto,
    ]),
  ),
);

section("Chat (seedChat, row for row)");
emit(`-- The browser demo's chat seed already contains the notifications, read
-- state and roles the triggers would create, so user triggers are off while
-- these rows load (FK checks stay on).
alter table public.members disable trigger user;
alter table public.conversations disable trigger user;
alter table public.conversation_members disable trigger user;
alter table public.messages disable trigger user;
alter table public.mentions disable trigger user;
alter table public.reactions disable trigger user;
alter table public.announcement_drafts disable trigger user;
alter table public.reports disable trigger user;
alter table public.notifications disable trigger user;

`);
emit(
  insert(
    "public.members",
    [
      ["workspace_id", "text"],
      ["person_id", "text"],
      ["user_id", "text"],
      ["role", "text"],
      ["joined_at", "ts"],
    ],
    members.map((m) => [
      m.workspaceId,
      m.personId,
      demoIds.has(m.personId) ? raw(`${str(userId(m.personId))}::uuid`) : null,
      m.role,
      m.joinedAt,
    ]),
  ),
);
emit(
  insert(
    "public.conversations",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["kind", "text"],
      ["title", "text"],
      ["description", "text"],
      ["icon", "text"],
      ["pinned", "bool"],
      ["retention_days", "num"],
      ["created_by", "text"],
      ["created_at", "ts"],
    ],
    chat.conversations.map((c) => [
      c.id,
      c.workspaceId,
      c.kind,
      c.title,
      c.description,
      c.icon,
      c.pinned,
      c.retentionDays,
      c.createdBy,
      c.createdAt,
    ]),
  ),
);
emit(
  insert(
    "public.conversation_members",
    [
      ["conversation_id", "text"],
      ["person_id", "text"],
      ["role", "text"],
      ["last_read_at", "ts"],
      ["muted", "bool"],
      ["joined_at", "ts"],
      ["pinned_at", "ts"],
    ],
    chat.conversationMembers.map((m) => [
      m.conversationId,
      m.personId,
      m.role,
      m.lastReadAt,
      m.muted,
      m.joinedAt,
      m.pinnedAt,
    ]),
  ),
);
emit(
  insert(
    "public.messages",
    [
      ["id", "text"],
      ["conversation_id", "text"],
      ["author_id", "text"],
      ["body", "text"],
      ["reply_to_id", "text"],
      ["card", "json"],
      ["created_at", "ts"],
      ["edited_at", "ts"],
      ["deleted_at", "ts"],
    ],
    [...chat.messages]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((m) => [
        m.id,
        m.conversationId,
        m.authorId,
        m.body,
        m.replyToId,
        m.card,
        m.createdAt,
        m.editedAt,
        m.deletedAt,
      ]),
  ),
);
// Pinned messages (the column references messages, so it is set afterwards).
for (const c of chat.conversations) {
  if (c.pinnedMessageId) {
    emit(
      `update public.conversations set pinned_message_id = ${str(c.pinnedMessageId)} where id = ${str(c.id)};\n`,
    );
  }
}
emit("\n");
emit(
  insert(
    "public.attachments",
    [
      ["id", "text"],
      ["message_id", "text"],
      ["kind", "text"],
      ["storage_path", "text"],
      ["mime", "text"],
      ["size", "num"],
      ["duration_ms", "num"],
      ["width", "num"],
      ["height", "num"],
    ],
    chat.attachments.map((a) => [
      a.id,
      a.messageId,
      a.kind,
      a.storagePath,
      a.mime,
      a.size,
      a.durationMs,
      a.width,
      a.height,
    ]),
  ),
);
emit(
  insert(
    "public.reactions",
    [
      ["message_id", "text"],
      ["person_id", "text"],
      ["emoji", "text"],
      ["created_at", "ts"],
    ],
    chat.reactions.map((r) => [r.messageId, r.personId, r.emoji, r.createdAt]),
  ),
);
emit(
  insert(
    "public.mentions",
    [
      ["message_id", "text"],
      ["person_id", "text"],
    ],
    chat.mentions.map((m) => [m.messageId, m.personId]),
  ),
);
emit(
  insert(
    "public.announcement_drafts",
    [
      ["id", "text"],
      ["conversation_id", "text"],
      ["author_id", "text"],
      ["body", "text"],
      ["card", "json"],
      ["status", "text"],
      ["reviewer_id", "text"],
      ["reviewed_at", "ts"],
      ["created_at", "ts"],
    ],
    chat.drafts.map((d) => [
      d.id,
      d.conversationId,
      d.authorId,
      d.body,
      d.card,
      d.status,
      d.reviewerId,
      d.reviewedAt,
      d.createdAt,
    ]),
  ),
);
emit(
  insert(
    "public.reports",
    [
      ["id", "text"],
      ["message_id", "text"],
      ["reporter_id", "text"],
      ["reason", "text"],
      ["created_at", "ts"],
      ["resolved_at", "ts"],
      ["resolved_by", "text"],
    ],
    chat.reports.map((r) => [
      r.id,
      r.messageId,
      r.reporterId,
      r.reason,
      r.createdAt,
      r.resolvedAt,
      r.resolvedBy,
    ]),
  ),
);
emit(
  insert(
    "public.notifications",
    [
      ["id", "text"],
      ["recipient_id", "text"],
      ["type", "text"],
      ["actor_id", "text"],
      ["conversation_id", "text"],
      ["message_id", "text"],
      ["ref_id", "text"],
      ["created_at", "ts"],
      ["read_at", "ts"],
    ],
    chat.notifications.map((n) => [
      n.id,
      n.recipientId,
      n.type,
      n.actorId,
      n.conversationId,
      n.messageId,
      n.refId,
      n.createdAt,
      n.readAt,
    ]),
  ),
);
emit(
  insert(
    "public.blocks",
    [
      ["blocker_id", "text"],
      ["blocked_id", "text"],
      ["created_at", "ts"],
    ],
    chat.blocks.map((b) => [b.blockerId, b.blockedId, b.createdAt]),
  ),
);
section("Team settings: deputies, feature switches, the admin flag (src/data/team/seed.ts)");
const deputies = seedDeputies();
emit(
  insert(
    "public.deputies",
    [
      ["workspace_id", "text"],
      ["leader_id", "text"],
      ["deputy_id", "text"],
      ["added_by", "text"],
      ["added_at", "ts"],
    ],
    deputies.map((d) => [
      WORKSPACE_ID,
      d.leaderId,
      d.deputyId,
      d.addedBy ?? d.leaderId,
      d.addedAt ?? new Date(NOW).toISOString(),
    ]),
  ),
);
emit(
  insert(
    "public.feature_switches",
    [
      ["workspace_id", "text"],
      ["feature", "text"],
      ["enabled", "bool"],
    ],
    seedFeatureSwitches().map((f) => [WORKSPACE_ID, f.feature, f.enabled]),
  ),
);
for (const u of DEMO_USERS) {
  if (!("admin" in u && u.admin)) continue;
  emit(`insert into public.app_admins (user_id, note)
values (${str(userId(u.personId))}::uuid, 'Demo admin login: every feature regardless of switches');
`);
}

emit(`
alter table public.members enable trigger user;
alter table public.conversations enable trigger user;
alter table public.conversation_members enable trigger user;
alter table public.messages enable trigger user;
alter table public.mentions enable trigger user;
alter table public.reactions enable trigger user;
alter table public.announcement_drafts enable trigger user;
alter table public.reports enable trigger user;
alter table public.notifications enable trigger user;

drop schema seed_tmp cascade;
`);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
writeFileSync(resolve(root, "supabase/seed.sql"), out.join(""), "utf8");
console.log(
  `Wrote supabase/seed.sql: ${people.length} people, ${members.length} members, ` +
    `${chat.conversations.length} conversations, ${chat.messages.length} messages, ` +
    `${pipeline.moves.length} pipeline moves.`,
);

// ---------------------------------------------------------------------------
// Visibility parity test: what src/data/access.ts lets each demo user see,
// asserted against row-level security on the seeded database.
// ---------------------------------------------------------------------------

const arr = (ids: string[]) =>
  ids.length ? `array[${[...ids].sort().map(str).join(", ")}]::text[]` : `array[]::text[]`;
// Only seed rows are compared, so the test holds while others use the database.
const seedPeopleIds = arr(people.map((p) => p.id));
const seedAttendanceIds = arr(attendances.map((a) => a.id));
const t: string[] = [];
let n = 0;
const check = (sql: string) => {
  n++;
  t.push(sql);
};
t.push(`select set_config('role', 'anon', true); -- not signed in`);
check(`select is((select count(*)::int from public.people), 0, 'nobody signed in: no people');`);
check(`select is((select count(*)::int from public.events), 0, 'nobody signed in: no events');`);
t.push(`select pg_temp.logout();`);
for (const u of DEMO_USERS) {
  const deputyOf = deputyOfIds(deputies, u.personId);
  const v: Viewer = deputyOf.length
    ? { personId: u.personId, role: u.role, deputyOf }
    : { personId: u.personId, role: u.role };
  const ids = visibleIdSet(people, v);
  t.push(`\nselect pg_temp.login(${str(u.personId)}); -- ${u.name} (${u.role})`);
  check(
    `select is(array(select id from public.people where id = any(${seedPeopleIds}) order by id collate "C"), ${arr([...ids])}, ${str(`${u.name}: people match access.ts`)});`,
  );
  check(
    `select is(array(select id from public.people where biz_class = 'customer' and id = any(${seedPeopleIds}) order by id collate "C"), ${arr(visibleCustomers(people, v).map((c) => c.id))}, ${str(`${u.name}: only own customers`)});`,
  );
  check(
    `select is(array(select id from public.attendances where id = any(${seedAttendanceIds}) order by id collate "C"), ${arr(filterAttendances(attendances, ids).map((a) => a.id))}, ${str(`${u.name}: attendance rows of visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.contacts where id = any(${arr(contacts.map((c) => c.id))})), ${contacts.filter((c) => ids.has(c.personId)).length}, ${str(`${u.name}: contacts with visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.sales where id = any(${arr(sales.map((x) => x.id))})), ${sales.filter((s) => ids.has(s.customerId) || (!!s.personId && ids.has(s.personId))).length}, ${str(`${u.name}: sales of visible customers or sellers`)});`,
  );
  check(
    `select is((select count(*)::int from public.pv_overrides), ${pvOverrides.filter((o) => ids.has(o.personId)).length}, ${str(`${u.name}: monthly PV of visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.milestone_marks), ${milestoneMarks.filter((k) => ids.has(k.personId)).length}, ${str(`${u.name}: milestone marks of visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.learning where id = any(${arr(learning.map((x) => x.id))})), ${learning.filter((l) => ids.has(l.personId)).length}, ${str(`${u.name}: learning of visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.events where id = any(${arr(events.map((e) => e.id))})), ${events.length}, ${str(`${u.name}: everyone sees every event`)});`,
  );
  // Pipeline: cards of visible prospects and moves of visible owners (not candidates).
  const candidate = u.role === "candidate";
  check(
    `select is((select count(*)::int from public.pipeline_cards where person_id = any(${arr(pipeline.cards.map((c) => c.personId))})), ${candidate ? 0 : pipeline.cards.filter((c) => ids.has(c.personId)).length}, ${str(`${u.name}: pipeline cards of visible prospects`)});`,
  );
  check(
    `select is((select count(*)::int from public.pipeline_moves where id like 'pm%'), ${candidate ? 0 : pipeline.moves.filter((m) => ids.has(m.ownerId)).length}, ${str(`${u.name}: pipeline moves of their team`)});`,
  );
  // Lists: the viewer's own and their downline's (rules.ts visibleEntries).
  const entries = visibleEntries(customerPipeline.entries, people, v);
  const entryIds = new Set(entries.map((e) => e.id));
  check(
    `select is(array(select id from public.list_entries where id like 'le-%' order by id collate "C"), ${arr(entries.map((e) => e.id))}, ${str(`${u.name}: list entries match visibleEntries`)});`,
  );
  check(
    `select is((select count(*)::int from public.customer_cards where entry_id like 'le-%'), ${customerPipeline.cards.filter((c) => entryIds.has(c.entryId)).length}, ${str(`${u.name}: customer cards of visible lists`)});`,
  );
  check(
    `select is((select count(*)::int from public.customer_moves where id like 'cm%'), ${candidate ? 0 : customerPipeline.moves.filter((m) => ids.has(m.ownerId)).length}, ${str(`${u.name}: customer moves of their team`)});`,
  );
  t.push(`select pg_temp.logout();`);
}

writeFileSync(
  resolve(root, "supabase/tests/001_visibility_parity.test.sql"),
  `-- GENERATED by scripts/db/generate-seed.ts from src/data/access.ts and the
-- demo seed. Do not edit by hand: run \`npm run db:seed\`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(${n});

${LOGIN_HELPERS}

${t.join("\n")}

select * from finish();
rollback;
`,
  "utf8",
);
console.log(`Wrote supabase/tests/001_visibility_parity.test.sql: ${n} checks.`);
