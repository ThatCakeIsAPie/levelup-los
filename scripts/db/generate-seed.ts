/**
 * Generates supabase/seed.sql from the app's demo seeds, so the demo data
 * stays defined in one place:
 *   - CRM: src/data/seed.ts (people, events, attendance, contacts, ...)
 *   - chat: src/data/chat/seed.ts seedChat() (every chat table, row for row)
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
  seedContacts,
  seedEvents,
  seedLearning,
  seedLearningGoals,
  seedOps,
  seedPeople,
  seedSales,
} from "@/data/seed";
import { seedChat } from "@/data/chat/seed";
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
const contacts = seedContacts(people);
const sales = seedSales();
const learning = seedLearning();
const goals = seedLearningGoals();
const ops = seedOps();
const activity = seedActivity(people, attendances);
const chat = seedChat(people, NOW);

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
      ["ticket_type", "text"],
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
      a.ticketType,
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
    ],
    sales.map((s) => [s.id, WORKSPACE_ID, s.customerId, s.product, s.date, s.amount]),
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
      ["date", "date"],
    ],
    learning.map((l) => [l.id, WORKSPACE_ID, l.personId, l.kind, l.title, l.amount, l.date]),
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
    ],
    Object.entries(goals).map(([p, g]) => [p, WORKSPACE_ID, g.pages, g.podcasts, g.workshops]),
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
    "public.library_items",
    [
      ["id", "text"],
      ["workspace_id", "text"],
      ["kind", "text"],
      ["title", "text"],
      ["duration_sec", "num"],
      ["url", "text"],
      ["created_by", "text"],
      ["created_at", "ts"],
    ],
    chat.library.map((l) => [
      l.id,
      l.workspaceId,
      l.kind,
      l.title,
      l.durationSec,
      l.url,
      l.createdBy,
      l.createdAt,
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
    ],
    chat.conversationMembers.map((m) => [
      m.conversationId,
      m.personId,
      m.role,
      m.lastReadAt,
      m.muted,
      m.joinedAt,
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
    `${chat.conversations.length} conversations, ${chat.messages.length} messages.`,
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
  const v: Viewer = { personId: u.personId, role: u.role };
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
    `select is((select count(*)::int from public.sales where id = any(${arr(sales.map((x) => x.id))})), ${sales.filter((s) => ids.has(s.customerId)).length}, ${str(`${u.name}: sales of visible customers`)});`,
  );
  check(
    `select is((select count(*)::int from public.learning where id = any(${arr(learning.map((x) => x.id))})), ${learning.filter((l) => ids.has(l.personId)).length}, ${str(`${u.name}: learning of visible people`)});`,
  );
  check(
    `select is((select count(*)::int from public.events where id = any(${arr(events.map((e) => e.id))})), ${events.length}, ${str(`${u.name}: everyone sees every event`)});`,
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
