/**
 * Phone numbers: US style "(512) 555-0102" while typing and when saved.
 *
 * - `formatPhone(text)` formats as you type: "512" → "(512) 555" →
 *   "(512) 555-0102". A leading 1 or +1 stays in front ("+1 (512) 555-0102").
 *   A number starting with + and another country code keeps the person's own
 *   grouping (only stray characters go), so international numbers are never
 *   reshaped. More than 10 US digits falls back to plain digits.
 * - `normalizePhone(text)` is the stored form: a full US number (with or
 *   without 1 / +1) becomes "(512) 555-0102", 7 digits "555-0102", anything
 *   else is kept as typed (cleaned up). Empty stays "".
 * - `displayPhone(stored)` shows any saved number in the stored form, so
 *   older "512-555-0102" numbers read "(512) 555-0102".
 *
 * Pure and unit-tested (phone.test.ts).
 */

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Progressive US national format for up to 10 digits. */
function national(d: string): string {
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 10)}`;
}

/** Keep digits and the usual separators, one space at a time, a single leading "+". */
function cleanInternational(s: string): string {
  const body = s
    .slice(1)
    .replace(/[^\d\s().-]/g, "")
    .replace(/\s+/g, " ");
  return `+${body.replace(/^\s+/, "")}`;
}

/** Format while typing (see the module comment). */
export function formatPhone(input: string): string {
  const s = input.trimStart();
  if (!s) return "";
  if (s.startsWith("+")) {
    const d = digitsOf(s);
    if (!d) return "+";
    if (d.startsWith("1")) {
      const rest = d.slice(1);
      if (!rest) return "+1";
      if (rest.length > 10) return `+${d}`;
      return `+1 ${national(rest)}`;
    }
    return cleanInternational(s);
  }
  const d = digitsOf(s);
  if (!d) return "";
  if (d.startsWith("1")) {
    const rest = d.slice(1);
    if (!rest) return "1";
    if (rest.length > 10) return d;
    return `1 ${national(rest)}`;
  }
  if (d.length > 10) return d;
  return national(d);
}

/** The stored form (see the module comment). */
export function normalizePhone(input: string | null | undefined): string {
  const s = (input ?? "").trim();
  if (!s) return "";
  const d = digitsOf(s);
  const plus = s.startsWith("+");
  if (plus && !d.startsWith("1")) {
    if (!d) return "";
    return cleanInternational(s)
      .replace(/[\s(.-]+$/, "")
      .trim();
  }
  const rest = d.startsWith("1") && (plus || d.length === 11) ? d.slice(1) : d;
  if (rest.length === 10) return national(rest);
  if (!plus && rest.length === 7) return `${rest.slice(0, 3)}-${rest.slice(3)}`;
  if (!d) return "";
  return plus ? `+${d}` : d;
}

/** A saved number as it should read (older formats tidied up). */
export function displayPhone(stored: string | null | undefined): string {
  if (!stored) return "";
  return normalizePhone(stored) || stored;
}

/** For tel: and sms: links. */
export function phoneHref(stored: string): string {
  return stored.replace(/[^\d+]/g, "");
}

/**
 * Where the caret goes after reformatting: just after the same number of
 * digits (and "+") that were before it in the raw text.
 */
export function caretAfter(formatted: string, digitsBefore: number): number {
  if (digitsBefore <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d+]/.test(formatted[i])) seen++;
    if (seen === digitsBefore) return i + 1;
  }
  return formatted.length;
}

/** Count of digits (and "+") in the text before `pos`. */
export function digitsBefore(text: string, pos: number): number {
  return (text.slice(0, pos).match(/[\d+]/g) ?? []).length;
}
