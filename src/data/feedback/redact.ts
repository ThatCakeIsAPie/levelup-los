/**
 * The value safety net for feedback snapshots (pure, no DOM; tested in
 * redact.test.ts). Marking with `data-sensitive` (src/lib/sensitive.ts) is the
 * main way names and contact details are blacked out, but a place nobody marked
 * would leak. So at capture time the client builds the set of sensitive VALUES it
 * knows (names, phones, emails, locations, ID numbers) and `matcher.find(text)`
 * says which stretches of any text contain one.
 *
 * What it matches (case-insensitive, whole words):
 *  - a full name, or any single part of a name that has 3 or more letters
 *    ("Maria Reyes", "Maria", "Reyes"; two-letter parts only inside a full name)
 *  - a known email, location (and its city), IBO or LTD number
 *  - ANY email address, and any phone written the US way, even if unknown
 *  - a known phone in any grouping ("(512) 555-0102", "512.555.0102", "+1 512 555 0102")
 * Neighbouring hits with only a space, dot, comma, apostrophe or hyphen between
 * them join into one stretch, so "Maria Reyes" is one bar.
 *
 * Free text (notes, chat messages) cannot be matched by value and relies on marking.
 */

export interface SensitiveSources {
  /** Full names, as shown ("Maria Reyes"). */
  names: Iterable<string | null | undefined>;
  phones: Iterable<string | null | undefined>;
  emails: Iterable<string | null | undefined>;
  /** Addresses and locations ("Dallas, TX"). */
  places: Iterable<string | null | undefined>;
  /** IBO and LTD numbers. */
  ids: Iterable<string | null | undefined>;
}

/** A stretch of a string: start (inclusive) and end (exclusive). */
export type Range = [number, number];

export interface SensitiveMatcher {
  /** Stretches of `text` that hold a sensitive value, in order, not overlapping. */
  find(text: string): Range[];
  /** How many distinct values it knows (for diagnostics). */
  size: number;
}

/**
 * Name parts that are also everyday words in the app's own text (months, days,
 * common words). A lone part like this is not matched, so "June 5" and "May"
 * stay readable; the full name ("June Park") still is.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "today",
  // Ranks and roles named like people: "Ruby", "Admin".
  "ruby",
  "pearl",
  "emerald",
  "diamond",
  "crystal",
  "sapphire",
  "platinum",
  "admin",
  "leader",
  "team",
  "will",
  "mark",
  "grant",
  "hope",
  "faith",
  "rose",
  "bill",
  "joy",
  "van",
  "the",
  "and",
  "new",
  "old",
  "all",
  "you",
  "your",
  "not",
  "for",
  "yes",
  "now",
]);

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
const LETTERS = /\p{L}/gu;
/** Gap between two hits that still reads as one name or value. */
const JOIN_GAP = /^[ \u00a0.,'’-]{1,2}$/;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");
/** A phone's digits, without a leading US country code. */
const phoneDigits = (s: string) => {
  const d = digitsOf(s);
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

/** The lower-case words of a name that are long enough to stand alone. */
export function nameParts(name: string): string[] {
  const parts = new Set<string>();
  for (const m of name.matchAll(WORD)) {
    const word = m[0].toLowerCase();
    for (const piece of [word, ...word.split(/['’]/)]) {
      const letters = piece.match(LETTERS)?.length ?? 0;
      if (letters >= 3 && !COMMON_WORDS.has(piece)) parts.add(piece);
    }
  }
  return [...parts];
}

// Any email, and a US-style phone, whether or not the client knows it.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const US_PHONE = /(?<!\d)(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
// A run that may be a phone in some other grouping; checked against the known numbers.
const PHONE_RUN = /\+?\(?\d[\d\s().-]{5,}\d/g;

/** Sort, drop overlaps and join neighbours. */
function mergeRanges(text: string, ranges: Range[]): Range[] {
  if (ranges.length < 2) return ranges;
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const out: Range[] = [ranges[0].slice() as Range];
  for (let i = 1; i < ranges.length; i++) {
    const last = out[out.length - 1];
    const [s, e] = ranges[i];
    if (s <= last[1]) last[1] = Math.max(last[1], e);
    else if (JOIN_GAP.test(text.slice(last[1], s))) last[1] = e;
    else out.push([s, e]);
  }
  return out;
}

/** Build the matcher for the values the client knows right now. */
export function buildMatcher(sources: SensitiveSources): SensitiveMatcher {
  const parts = new Set<string>();
  const phrases = new Set<string>();
  const phones = new Set<string>();

  for (const raw of sources.names) {
    const name = clean(raw);
    if (name.length < 3) continue;
    phrases.add(name.toLowerCase());
    for (const p of nameParts(name)) parts.add(p);
  }
  for (const raw of sources.emails) {
    const v = clean(raw);
    if (v.length >= 5) phrases.add(v.toLowerCase());
  }
  for (const raw of sources.places) {
    const v = clean(raw);
    if (v.length < 3) continue;
    phrases.add(v.toLowerCase());
    const city = v.split(",")[0].trim();
    if (city.length >= 4 && city !== v) phrases.add(city.toLowerCase());
  }
  for (const raw of sources.ids) {
    const v = clean(raw);
    if (v.length >= 3) phrases.add(v.toLowerCase());
  }
  for (const raw of sources.phones) {
    const d = phoneDigits(raw ?? "");
    if (d.length >= 7) phones.add(d);
  }

  const alternatives = [...phrases]
    .sort((a, b) => b.length - a.length)
    .map((p) => escapeRe(p).replace(/ /g, "\\s+"));
  const phrase = alternatives.length
    ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join("|")})(?![\\p{L}\\p{N}])`, "giu")
    : null;

  function find(text: string): Range[] {
    if (text.length < 3 || !/[\p{L}\p{N}]/u.test(text)) return [];
    const ranges: Range[] = [];

    if (phrase) {
      phrase.lastIndex = 0;
      for (let m = phrase.exec(text); m; m = phrase.exec(text)) {
        ranges.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) phrase.lastIndex++;
      }
    }

    if (parts.size) {
      for (const m of text.matchAll(WORD)) {
        const word = m[0].toLowerCase();
        const bare = word.replace(/['’]s$/, "");
        if (parts.has(word)) ranges.push([m.index, m.index + m[0].length]);
        else if (parts.has(bare)) ranges.push([m.index, m.index + bare.length]);
      }
    }

    if (text.includes("@")) {
      for (const m of text.matchAll(EMAIL)) ranges.push([m.index, m.index + m[0].length]);
    }

    if (/\d{3}/.test(text)) {
      for (const m of text.matchAll(US_PHONE)) ranges.push([m.index, m.index + m[0].length]);
      if (phones.size) {
        for (const m of text.matchAll(PHONE_RUN)) {
          if (phones.has(phoneDigits(m[0]))) ranges.push([m.index, m.index + m[0].length]);
        }
      }
    }

    return mergeRanges(text, ranges);
  }

  return { find, size: parts.size + phrases.size + phones.size };
}
