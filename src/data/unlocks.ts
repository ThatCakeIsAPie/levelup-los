/**
 * What a person has unlocked (pure; docs/plans/mvp-plan-2026-10-13.md "What
 * each person sees" and "Feature switches and the admin login").
 *
 * | Stage                              | Unlocks                                                         |
 * | ---------------------------------- | --------------------------------------------------------------- |
 * | New apprentice (until First sponsor) | Home, Customers (pipeline, your list), Learning, own profile, Events (attending), Wallet |
 * | After First sponsor                | + Team (mindmap), People and downline profiles, recruiting pipeline, Reports |
 * | 3/10 and up                        | + event planning (create and edit events, tickets, travel, shared costs) |
 * | Leaders, their deputies, admins    | everything, team settings and targets                           |
 * | Candidates                         | their existing limited view (no customers, pipeline or campaigns) |
 *
 * Chats, Library (phase 2) and Campaigns (phase 3) follow the team's
 * switches (off unless a leader turns them on); an admin account sees them
 * regardless. Wallet is always on. This is UI gating: row-level security
 * already limits the data.
 */
import type { Role } from "@/stores/sessionStore";
import type { FeatureKey } from "./team/types";

export type UnlockStage = "candidate" | "new_apprentice" | "first_sponsor" | "builder" | "leader";

/** Areas of the app that can be locked. */
export type UnlockArea =
  | "home"
  | "learning"
  | "profile"
  | "customers"
  | "events"
  | "wallet"
  | "business"
  | "settings"
  | "team"
  | "people"
  | "pipeline"
  | "reports"
  | "eventPlanning"
  | "teamSettings"
  | "chats"
  | "inbox"
  | "library"
  | "campaigns";

export interface UnlockInput {
  role: Role;
  /** The admin ("experimental") account: every feature regardless of switches. */
  admin?: boolean;
  /** Leaders this person is a deputy of. */
  deputyOf?: readonly string[];
  /** Growth milestones reached (from the milestone engine). */
  firstSponsor: boolean;
  threeTen: boolean;
  /** The team's feature switches (missing = off). */
  switches: Partial<Record<FeatureKey, boolean>>;
  /** Chat eligible (apprentice, IBO or leader; not a candidate or prospect). */
  canChat: boolean;
}

/** The next milestone that opens something new (the sidebar hint). */
export interface NextUnlock {
  milestone: "first_sponsor" | "3_10";
  text: string;
}

export interface Unlocks {
  stage: UnlockStage;
  admin: boolean;
  /** Acting for one or more leaders. */
  deputy: boolean;
  can: Record<UnlockArea, boolean>;
  /** A feature is on for this person (switch on, or admin). */
  feature: Record<FeatureKey, boolean>;
  next: NextUnlock | null;
}

export const NEXT_UNLOCK_TEXT: Record<NextUnlock["milestone"], string> = {
  first_sponsor:
    "Sponsor your first person to unlock your team, the recruiting pipeline and reports.",
  "3_10":
    "Reach 3/10 to unlock event planning: create events and track tickets, travel and shared costs.",
};

/** The person's own stage (leaders and deputies count as "leader"). */
export function unlockStage(i: UnlockInput): UnlockStage {
  if (i.role === "candidate") return "candidate";
  if (i.role === "leader" || (i.deputyOf?.length ?? 0) > 0) return "leader";
  if (i.threeTen) return "builder";
  if (i.firstSponsor) return "first_sponsor";
  return "new_apprentice";
}

export function computeUnlocks(i: UnlockInput): Unlocks {
  const stage = unlockStage(i);
  const admin = !!i.admin;
  const deputy = (i.deputyOf?.length ?? 0) > 0;
  const candidate = stage === "candidate";
  const all = admin || stage === "leader";
  const sponsor = all || stage === "first_sponsor" || stage === "builder";
  const feature: Record<FeatureKey, boolean> = {
    chats: admin || !!i.switches.chats,
    library: admin || !!i.switches.library,
    campaigns: admin || !!i.switches.campaigns,
  };
  // Candidates keep their existing view: themselves on the team pages.
  const team = candidate || sponsor;
  const pipeline = !candidate && sponsor;
  const chats = feature.chats && i.canChat;
  const can: Record<UnlockArea, boolean> = {
    home: true,
    learning: true,
    profile: true,
    events: true,
    wallet: true,
    business: true,
    settings: true,
    customers: !candidate,
    team,
    people: team,
    reports: team,
    pipeline,
    eventPlanning: !candidate && (all || stage === "builder"),
    teamSettings: admin || i.role === "leader" || deputy,
    chats,
    // Without chats the inbox only carries pipeline notifications (stat requests).
    inbox: feature.chats || pipeline,
    library: feature.library,
    campaigns: !candidate && feature.campaigns,
  };
  const next: NextUnlock | null = all
    ? null
    : stage === "new_apprentice"
      ? { milestone: "first_sponsor", text: NEXT_UNLOCK_TEXT.first_sponsor }
      : stage === "first_sponsor"
        ? { milestone: "3_10", text: NEXT_UNLOCK_TEXT["3_10"] }
        : null;
  return { stage, admin, deputy, can, feature, next };
}

/** Why a page is locked, for the friendly panel. */
export type LockReason =
  | { kind: "milestone"; milestone: "first_sponsor" }
  | { kind: "feature"; feature: FeatureKey }
  | { kind: "candidate" }
  | { kind: "leaders" };

export type RouteAccess = { ok: true } | { ok: false; reason: LockReason };

const OK: RouteAccess = { ok: true };

function under(pathname: string, base: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === base || p.startsWith(`${base}/`);
}

/**
 * May this person open `pathname` (a path inside the app, without the
 * deployment's base path)? `/people/<id>` is always open for yourself and
 * for customers you own; the rest of People needs the team unlock.
 */
export function routeAccess(
  pathname: string,
  u: Unlocks,
  ctx: { me: string; ownsCustomer: (id: string) => boolean },
): RouteAccess {
  const milestone: RouteAccess = {
    ok: false,
    reason: { kind: "milestone", milestone: "first_sponsor" },
  };
  const needTeam = (): RouteAccess =>
    u.can.team
      ? OK
      : u.stage === "candidate"
        ? { ok: false, reason: { kind: "candidate" } }
        : milestone;
  const feature = (f: FeatureKey, open: boolean): RouteAccess =>
    open ? OK : { ok: false, reason: { kind: "feature", feature: f } };

  if (under(pathname, "/chats")) {
    if (u.can.chats) return OK;
    // Switched on, but this person can't chat (a candidate or prospect).
    return u.feature.chats ? { ok: false, reason: { kind: "candidate" } } : feature("chats", false);
  }
  if (under(pathname, "/library")) return feature("library", u.can.library);
  if (under(pathname, "/campaigns")) {
    if (u.stage === "candidate") return { ok: false, reason: { kind: "candidate" } };
    return feature("campaigns", u.can.campaigns);
  }
  if (under(pathname, "/inbox")) {
    if (u.can.inbox) return OK;
    return u.stage === "new_apprentice" ? milestone : feature("chats", false);
  }
  // Team settings: leaders, deputies and the admin; with chats on, everyone
  // can still manage the people they blocked there.
  if (under(pathname, "/settings/team"))
    return u.can.teamSettings || u.can.chats ? OK : { ok: false, reason: { kind: "leaders" } };
  if (under(pathname, "/customers"))
    return u.can.customers ? OK : { ok: false, reason: { kind: "candidate" } };
  if (under(pathname, "/pipeline")) {
    if (u.can.pipeline) return OK;
    return u.stage === "candidate" ? { ok: false, reason: { kind: "candidate" } } : milestone;
  }
  if (under(pathname, "/mindmap") || under(pathname, "/reports")) return needTeam();
  if (under(pathname, "/people")) {
    const id = pathname.replace(/\/+$/, "").split("/")[2];
    if (id && (id === ctx.me || ctx.ownsCustomer(decodeURIComponent(id)))) return OK;
    return needTeam();
  }
  return OK;
}
