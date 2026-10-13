import { DEMO_USERS, type BizClass, type DemoUser, type Role } from "@/data";

/** Stage color for each demo role's avatar (the login page has no session, so no person lookup). */
export const ROLE_STAGE: Record<Role, BizClass> = {
  leader: "ibo",
  ibo: "ibo",
  apprentice: "apprentice",
  candidate: "prospect",
};

/** One line on what each role can see. */
export const ROLE_SEES: Record<Role, string> = {
  leader: "sees the whole team, rollups and money tools",
  ibo: "sees their own team and customers",
  apprentice: "first contract year, some tools are limited",
  candidate: "sees their own journey and events",
};

/**
 * Seeded local-database logins (supabase/seed.sql, from
 * scripts/db/generate-seed.ts; see docs/backend.md). Development builds only:
 * production builds get an empty list and no password.
 */
const DEV_EMAIL: Record<string, string> = {
  "1": "maria@levelup.test",
  "2": "anita@levelup.test",
  "4": "jamal@levelup.test",
  "20": "beau@levelup.test",
  "700": "tasha@levelup.test",
  "6": "marcus@levelup.test",
  "800": "admin@levelup.test",
};

export const DEV_PASSWORD: string = import.meta.env.DEV ? "levelup-local" : "";

export const DEV_ACCOUNTS: (DemoUser & { email: string })[] = import.meta.env.DEV
  ? DEMO_USERS.filter((u) => DEV_EMAIL[u.personId]).map((u) => ({
      ...u,
      email: DEV_EMAIL[u.personId],
    }))
  : [];
