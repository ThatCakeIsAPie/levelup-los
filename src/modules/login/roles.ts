import type { BizClass } from "@/stores/peopleStore";
import type { DemoUser, Role, WorkspaceRole } from "@/stores/sessionStore";

/** One row of the database's `get_session()` RPC (snake_case, as returned). */
export interface SessionRow {
  person_id: string;
  workspace_id: string;
  name: string;
  /** Team role: leader | moderator | member. */
  member_role: string;
  biz_class: string;
  /** biz_class after the apprentice → IBO anniversary rule (server-computed). */
  effective_stage: string;
  /** Server's own derivation (leader | ibo | apprentice | candidate); informational. */
  app_role?: string;
  is_chat_eligible?: boolean;
}

const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["leader", "moderator", "member"];

/** Unknown / missing roles are treated as plain members (least privilege). */
export function toWorkspaceRole(role: string | null | undefined): WorkspaceRole {
  return WORKSPACE_ROLES.includes(role as WorkspaceRole) ? (role as WorkspaceRole) : "member";
}

/**
 * Effective business stage (mirror of effectiveBizClass / the database's
 * effective_biz_class): an apprentice whose first contract year has elapsed
 * counts as an IBO. `businessStartDate` is "YYYY-MM-DD" (local date).
 */
export function effectiveStage(
  bizClass: string,
  businessStartDate: string | null | undefined,
  today = new Date(),
): BizClass | "unknown" {
  if (!["prospect", "apprentice", "ibo", "customer"].includes(bizClass)) return "unknown";
  if (bizClass !== "apprentice" || !businessStartDate) return bizClass as BizClass;
  const [y, m, d] = businessStartDate.split("-").map(Number);
  if (!y || !m || !d) return "apprentice";
  const anniversary = new Date(y + 1, m - 1, d);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return anniversary <= startOfToday ? "ibo" : "apprentice";
}

/**
 * The app role (what the pages and access rules use) for a signed-in member:
 * a workspace leader is "leader"; everyone else follows their effective
 * business stage (IBO → "ibo", apprentice → "apprentice", prospect or
 * anything else → "candidate", who only sees themselves).
 */
export function deriveRole(
  workspaceRole: WorkspaceRole,
  bizClass: string,
  businessStartDate: string | null | undefined,
  today = new Date(),
): Role {
  if (workspaceRole === "leader") return "leader";
  const stage = effectiveStage(bizClass, businessStartDate, today);
  if (stage === "ibo") return "ibo";
  if (stage === "apprentice") return "apprentice";
  return "candidate";
}

/**
 * Build the session user (DemoUser shape) from a `get_session()` row. The
 * stage is already effective (the server applied the anniversary rule).
 * `admin` comes from `is_app_admin()`.
 */
export function sessionUserFrom(row: SessionRow, admin = false): DemoUser {
  const user: DemoUser = {
    personId: row.person_id,
    name: row.name,
    role: deriveRole(toWorkspaceRole(row.member_role), row.effective_stage || row.biz_class, null),
  };
  return admin ? { ...user, admin: true } : user;
}

/** Who may invite people: anyone with a team (leaders, IBOs, apprentices). */
export function canInvite(role: Role | undefined): boolean {
  return role === "leader" || role === "ibo" || role === "apprentice";
}
