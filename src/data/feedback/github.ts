/**
 * Filing a report on GitHub: a link to the repo's public "new issue" form with
 * the title and body filled in. No token and no API call; the person submits
 * the form while signed in to GitHub, so a fork's deployment reaches the
 * upstream repo with no credentials.
 */
import type { FeedbackContext } from "./types";

/** The upstream repo that receives issues unless `VITE_FEEDBACK_GITHUB_REPO` says otherwise. */
export const DEFAULT_FEEDBACK_REPO = "ThatCakeIsAPie/levelup-los";

const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*)\/[A-Za-z0-9._-]+$/;
const OFF_VALUES = new Set(["off", "none", "false", "disabled"]);

/** Longest issue URL we build; GitHub refuses very long ones. */
const MAX_URL_LENGTH = 7000;
const TITLE_LENGTH = 70;

/**
 * Pure: the "owner/repo" to file on, from the env value. Unset or blank means
 * the default; "off" (or none/false/disabled) means no GitHub issue (null); a
 * value that is not "owner/repo" falls back to the default.
 */
export function resolveFeedbackRepo(raw: string | undefined): string | null {
  const value = raw
    ?.trim()
    .replace(/^https:\/\/github\.com\//i, "")
    .replace(/\/+$/, "");
  if (!value) return DEFAULT_FEEDBACK_REPO;
  if (OFF_VALUES.has(value.toLowerCase())) return null;
  return REPO_PATTERN.test(value) ? value : DEFAULT_FEEDBACK_REPO;
}

/** The repo for this build (null when GitHub issues are turned off). */
export const FEEDBACK_GITHUB_REPO = resolveFeedbackRepo(import.meta.env.VITE_FEEDBACK_GITHUB_REPO);

function issueTitle(message: string): string {
  const line = message.trim().split(/\r?\n/)[0] ?? "";
  const short = line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : line;
  return `Feedback: ${short}`;
}

/** The sender's name is left out: an issue on a public repo is public. */
function issueBody(message: string, context: Partial<FeedbackContext>): string {
  const where = [context.path, context.search].filter(Boolean).join("");
  const details = [
    where && `Page: ${where}`,
    context.title && `Page name: ${context.title}`,
    context.viewport && `Viewport: ${context.viewport.width}x${context.viewport.height}`,
    context.theme && `Theme: ${context.theme}`,
    context.brand && `Brand: ${context.brand}`,
    context.appVersion && `Version: ${context.appVersion}`,
    context.userAgent && `Browser: ${context.userAgent}`,
  ].filter(Boolean);
  return [
    message.trim(),
    "",
    "---",
    "Sent from the in-app Feedback button.",
    ...details,
    "",
    "A snapshot of the page was saved with the report in the app. Paste or attach it here if you want it on this issue.",
  ].join("\n");
}

/**
 * Pure: the prefilled "new issue" URL, or null when `repo` is null. The message
 * is cut (with "…") if the URL would be too long for GitHub.
 */
export function buildIssueUrl(
  repo: string | null,
  input: { message: string; context: Partial<FeedbackContext> },
): string | null {
  if (!repo) return null;
  const make = (message: string) => {
    const params = new URLSearchParams({
      title: issueTitle(message),
      body: issueBody(message, input.context),
    });
    return `https://github.com/${repo}/issues/new?${params.toString()}`;
  };
  let message = input.message.trim();
  let url = make(message);
  while (url.length > MAX_URL_LENGTH && message.length > 1) {
    message = `${message.slice(0, Math.floor(message.length * 0.8)).trimEnd()}…`;
    url = make(message);
  }
  return url;
}
