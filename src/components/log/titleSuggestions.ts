import type { Learning, LearningKind } from "@/data";

export interface TitleSuggestion {
  title: string;
  /** Date it was last logged (YYYY-MM-DD). */
  lastDate: string;
}

const key = (s: string) => s.trim().toLocaleLowerCase();

/**
 * Titles already logged for `kind`, most recently logged first, one per title
 * (matched ignoring case and surrounding spaces; the latest spelling wins).
 */
export function pastTitles(entries: Learning[], kind: LearningKind): TitleSuggestion[] {
  const seen = new Map<string, TitleSuggestion>();
  for (const l of entries) {
    if (l.kind !== kind || !l.title.trim()) continue;
    const k = key(l.title);
    const prev = seen.get(k);
    if (!prev || l.date > prev.lastDate) seen.set(k, { title: l.title.trim(), lastDate: l.date });
  }
  return [...seen.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Suggestions whose title contains `query` (ignoring case); all of them when it's blank. */
export function filterTitles(titles: TitleSuggestion[], query: string): TitleSuggestion[] {
  const q = key(query);
  return q ? titles.filter((t) => key(t.title).includes(q)) : titles;
}

/** The past title `query` names exactly (ignoring case), if any. */
export function matchTitle(titles: TitleSuggestion[], query: string): TitleSuggestion | undefined {
  const q = key(query);
  return q ? titles.find((t) => key(t.title) === q) : undefined;
}
