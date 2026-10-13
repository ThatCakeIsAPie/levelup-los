/**
 * Plain-language messages for Supabase Auth / RPC errors. Pure so it can be
 * unit-tested; matches on the error `code` first and the message second
 * (older servers only send a message).
 */
export interface AuthErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

export function friendlyAuthError(error: unknown): string {
  const e = (error ?? {}) as AuthErrorLike;
  const code = e.code ?? "";
  const msg = (e.message ?? "").toLowerCase();

  if (code === "invalid_credentials" || msg.includes("invalid login credentials"))
    return "That email or password doesn't match.";
  if (code === "otp_disabled" || code === "signup_disabled" || msg.includes("signups not allowed"))
    return "We don't have an account for that email. New here? Ask your leader for an invite link.";
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    msg.includes("already registered")
  )
    return "There's already an account for that email. Sign in instead.";
  if (code === "email_not_confirmed" || msg.includes("email not confirmed"))
    return "That email isn't confirmed yet. Use the link we emailed you, or ask for a new sign-in link.";
  if (code === "weak_password" || msg.includes("password should be"))
    return "Pick a longer password (at least 6 characters).";
  if (code === "same_password") return "That's your current password. Pick a new one.";
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    e.status === 429
  )
    return "Too many emails just now. Wait a minute and try again.";
  if (
    code === "validation_failed" ||
    msg.includes("unable to validate email") ||
    msg.includes("invalid format")
  )
    return "That doesn't look like an email address.";
  if (
    code === "otp_expired" ||
    code === "flow_state_expired" ||
    msg.includes("expired") ||
    msg.includes("invalid flow state")
  )
    return "That sign-in link has expired or was already used. Ask for a new one.";
  if (
    code === "bad_code_verifier" ||
    msg.includes("code verifier") ||
    msg.includes("both auth code and code verifier")
  )
    return "Open the sign-in link in the same browser you asked for it from, or ask for a new one.";
  if (
    e.name === "AuthRetryableFetchError" ||
    msg.includes("failed to fetch") ||
    msg.includes("network")
  )
    return "Can't reach the server. Check your connection and try again.";
  return e.message?.trim() ? e.message : "Something went wrong. Please try again.";
}
