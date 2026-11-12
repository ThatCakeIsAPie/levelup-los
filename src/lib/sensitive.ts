/**
 * The registry of sensitive kinds. Anything the UI shows that is one of these
 * must be marked, so the feedback snapshot (src/data/feedback/capture.ts) can
 * paint it as a solid black bar. Marking only adds a `data-sensitive`
 * attribute: nothing changes on the live page.
 *
 *   <Sensitive kind="name">{person.name}</Sensitive>   inline text (@/components/brand)
 *   <td {...sensitive("phone")}>{displayPhone(p.phone)}</td>   an element you already have
 *
 * Mark the smallest element that holds the value; a sentence that embeds a name
 * marks the name part, free text about a person marks the whole line.
 */

export const SENSITIVE_KINDS = [
  /** A person's name: team members, prospects, customers, sponsors, chat authors, the signed-in user. Avatar initials too. */
  "name",
  "phone",
  "email",
  /** An address or location (city, state). */
  "address",
  /** IBO and LTD numbers. */
  "id-number",
  /** Notes and other free text written about a person: summaries, reasons, activity lines. */
  "note",
  /** Chat message text and previews. */
  "message",
  /** Photos of people and chat or media attachments. */
  "photo",
] as const;

export type SensitiveKind = (typeof SENSITIVE_KINDS)[number];

/** The attribute that marks an element. */
export const SENSITIVE_ATTR = "data-sensitive";

/** CSS selector for every marked element. */
export const SENSITIVE_SELECTOR = `[${SENSITIVE_ATTR}]`;

/**
 * Elements that are always blacked out although no code marks them: toast text
 * (sonner's title and description). Toasts are built from template strings such as
 * "Moved Ty to First meeting", so the whole line is treated as sensitive.
 */
export const ALWAYS_SENSITIVE_SELECTOR =
  "[data-sonner-toast] [data-title], [data-sonner-toast] [data-description]";

/** Props to spread on an element that shows a sensitive value. */
export function sensitive(kind: SensitiveKind): { "data-sensitive": SensitiveKind } {
  return { [SENSITIVE_ATTR]: kind } as { "data-sensitive": SensitiveKind };
}

/** Like `sensitive()`, but only when `when` is true (a title that is a name only in a direct message, a search box that holds typed text). */
export function sensitiveIf(
  when: boolean,
  kind: SensitiveKind,
): { "data-sensitive": SensitiveKind } | Record<string, never> {
  return when ? sensitive(kind) : {};
}
