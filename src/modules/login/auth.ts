/**
 * Real sign-in ("supabase" mode): keeps the session store in step with
 * Supabase Auth and wraps the auth calls the login, callback and invite
 * screens use. In "local" mode every hook here still works (useWorkspaceRole
 * derives from the demo role) and the calls are never reached.
 *
 * After sign-in the person's data is loaded from the database (src/data/remote)
 * before the status becomes "ready", so the app never shows empty stores; on
 * sign-out the stores are emptied.
 */
import type { Session } from "@supabase/supabase-js";
import { appUrl, IS_SUPABASE } from "@/lib/config";
import { getSupabase, supabase } from "@/lib/supabase";
import { closeRemoteSession, openRemoteSession, remotePersonId } from "@/data/remote";
import {
  useSessionStore,
  type Account,
  type AuthStatus,
  type WorkspaceRole,
} from "@/stores/sessionStore";
import { friendlyAuthError } from "./authErrors";
import { sessionUserFrom, toWorkspaceRole, type SessionRow } from "./roles";

// ---------------------------------------------------------------------------
// Auth state → session store
// ---------------------------------------------------------------------------

let started = false;
/** Bumped on every auth change so a slow load can't overwrite a newer one. */
let generation = 0;
/** Auth user whose member row is loaded (skip reloads on token refresh). */
let loadedUserId: string | null = null;

/** Subscribe to Supabase Auth once (no-op in local mode). */
export function startAuth(): void {
  if (started || !supabase) return;
  started = true;
  supabase.auth.onAuthStateChange((event, session) => {
    // Signed out, or someone else signed in (possibly in another tab of this
    // browser: the client already sends their token). Stop syncing the
    // previous person's data right away, before the deferred reload below,
    // so none of it is written with the new session.
    if (loadedUserId !== null && (session?.user.id ?? null) !== loadedUserId) {
      closeRemoteSession();
    }
    // Never await Supabase calls inside this callback (it holds the auth
    // lock); defer the work instead.
    setTimeout(() => {
      if (event === "TOKEN_REFRESHED" && session && session.user.id === loadedUserId) return;
      void applySession(session);
    }, 0);
  });
}

async function applySession(session: Session | null): Promise<void> {
  const gen = ++generation;
  const set = useSessionStore.setState;
  if (!session) {
    loadedUserId = null;
    closeRemoteSession();
    set({ status: "signedOut", user: null, account: null, error: null });
    return;
  }
  const base: Account = { userId: session.user.id, email: session.user.email ?? "" };
  // Keep showing the current screen while reloading the same user (e.g. after
  // accepting an invite); show the loading state for a new user.
  if (loadedUserId !== session.user.id) set({ status: "loading", account: base, error: null });

  let loadingData = false;
  try {
    const client = getSupabase();
    const [sessionRes, workspaceRes] = await Promise.all([
      client.rpc("get_session"),
      client.from("workspaces").select("id, name").limit(1).maybeSingle(),
    ]);
    if (gen !== generation) return;
    if (sessionRes.error) throw sessionRes.error;
    const rows = (sessionRes.data ?? []) as SessionRow[];
    const row = rows[0];
    loadedUserId = session.user.id;
    if (!row) {
      closeRemoteSession();
      set({ status: "noTeam", user: null, account: base, error: null });
      return;
    }
    // Load everything this person may see before showing the app (once per
    // person; a reload for the same person keeps the live data).
    const user = sessionUserFrom(row);
    if (remotePersonId() !== user.personId) {
      loadingData = true;
      if (useSessionStore.getState().status !== "loading") set({ status: "loading" });
      await openRemoteSession({ personId: user.personId, name: user.name });
      loadingData = false;
      if (gen !== generation) return;
    }
    const workspace = workspaceRes.error
      ? null
      : (workspaceRes.data as { id: string; name: string } | null);
    set({
      status: "ready",
      user,
      account: {
        ...base,
        workspaceId: row.workspace_id,
        workspaceName: workspace?.name,
        workspaceRole: toWorkspaceRole(row.member_role),
      },
      error: null,
    });
  } catch (err) {
    if (gen !== generation) return;
    loadedUserId = null;
    set({
      status: "error",
      user: null,
      account: base,
      error: loadingData
        ? "We couldn't load your team's data. Check your connection."
        : friendlyAuthError(err),
    });
  }
}

/** Reload the member row for the current auth session (after accepting an invite, or Retry). */
export async function refreshAccount(): Promise<AuthStatus> {
  const { data } = await getSupabase().auth.getSession();
  loadedUserId = null;
  await applySession(data.session);
  return useSessionStore.getState().status;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useAuthStatus(): AuthStatus {
  return useSessionStore((s) => s.status);
}

export function useAccount(): Account | null {
  return useSessionStore((s) => s.account);
}

export function useAuthError(): string | null {
  return useSessionStore((s) => s.error);
}

/**
 * The signed-in person's team role (leader / moderator / member). In local
 * mode the demo leader is "leader" and everyone else "member".
 */
export function useWorkspaceRole(): WorkspaceRole {
  return useSessionStore((s) =>
    IS_SUPABASE
      ? (s.account?.workspaceRole ?? "member")
      : s.user?.role === "leader"
        ? "leader"
        : "member",
  );
}

// ---------------------------------------------------------------------------
// Pending invite (survives the round trip through the email link)
// ---------------------------------------------------------------------------

const PENDING_INVITE_KEY = "levelup.pendingInvite";

export function rememberPendingInvite(token: string): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, token);
  } catch {
    // Storage unavailable: the token still travels in the link itself.
  }
}

export function takePendingInvite(): string | null {
  try {
    const t = localStorage.getItem(PENDING_INVITE_KEY);
    localStorage.removeItem(PENDING_INVITE_KEY);
    return t;
  } catch {
    return null;
  }
}

export function clearPendingInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Auth calls. Each returns an error message in plain language, or null.
// ---------------------------------------------------------------------------

function callbackUrl(params: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const qs = q.toString();
  return appUrl(`auth/callback${qs ? `?${qs}` : ""}`);
}

/**
 * Email a sign-in link. From the login page only existing accounts get one
 * (`createUser: false`); from an invite page a new account is created.
 */
export async function sendSignInLink(
  email: string,
  opts: { invite?: string; name?: string; createUser?: boolean } = {},
): Promise<string | null> {
  if (opts.invite) rememberPendingInvite(opts.invite);
  const { error } = await getSupabase().auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: callbackUrl({ invite: opts.invite }),
      shouldCreateUser: opts.createUser ?? false,
      data: opts.name?.trim() ? { name: opts.name.trim() } : undefined,
    },
  });
  return error ? friendlyAuthError(error) : null;
}

export async function signInWithPassword(email: string, password: string): Promise<string | null> {
  const { error } = await getSupabase().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return error ? friendlyAuthError(error) : null;
}

/**
 * Create an account with a password (invite page). Returns `needsConfirm`
 * when the server requires email confirmation before signing in.
 */
export async function signUpWithPassword(
  email: string,
  password: string,
  opts: { name?: string; invite?: string } = {},
): Promise<{ error: string | null; needsConfirm: boolean }> {
  if (opts.invite) rememberPendingInvite(opts.invite);
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim(),
    password,
    options: {
      emailRedirectTo: callbackUrl({ invite: opts.invite }),
      data: opts.name?.trim() ? { name: opts.name.trim() } : undefined,
    },
  });
  if (error) return { error: friendlyAuthError(error), needsConfirm: false };
  // An existing, confirmed email comes back as a user with no identities and
  // no session (Supabase hides whether the account exists).
  if (data.user && data.user.identities?.length === 0)
    return {
      error: "There's already an account for that email. Sign in instead.",
      needsConfirm: false,
    };
  return { error: null, needsConfirm: !data.session };
}

export async function sendPasswordReset(email: string): Promise<string | null> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim(), {
    redirectTo: callbackUrl({ next: "reset" }),
  });
  return error ? friendlyAuthError(error) : null;
}

export async function updatePassword(password: string): Promise<string | null> {
  const { error } = await getSupabase().auth.updateUser({ password });
  return error ? friendlyAuthError(error) : null;
}

/** Finish a sign-in link (PKCE): trade the `code` for a session. */
export async function exchangeCode(code: string): Promise<string | null> {
  const { error } = await getSupabase().auth.exchangeCodeForSession(code);
  return error ? friendlyAuthError(error) : null;
}

/** Sign out of the real account (the gate then shows /login). */
export async function signOut(): Promise<void> {
  if (!supabase) {
    useSessionStore.getState().logout();
    return;
  }
  // Clear the UI right away; the SIGNED_OUT event confirms it.
  generation++;
  loadedUserId = null;
  closeRemoteSession();
  useSessionStore.setState({ status: "signedOut", user: null, account: null, error: null });
  // "local" scope: this device only. Even if the network call fails the
  // stored session is removed.
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
