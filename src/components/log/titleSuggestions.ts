import {
  learningFor,
  type CatalogItem,
  type CatalogKind,
  type Learning,
  type LearningKind,
} from "@/data";

/** A title logged before (not necessarily in the library). */
export interface TitleSuggestion {
  title: string;
  /** Date it was last logged (YYYY-MM-DD). */
  lastDate: string;
}

/** A library item the viewer may open, offered under the kind it logs as. */
export interface LibraryTitle {
  title: string;
  itemId: string;
  /** What the file is (audio, video, slides, document). */
  itemKind: CatalogKind;
}

/** What the Title dropdown lists: library items first, then titles logged before. */
export type TitleOption =
  ({ source: "library" } & LibraryTitle) | ({ source: "past" } & TitleSuggestion);

/** The most library rows shown at once; typing narrows the rest. */
export const MAX_LIBRARY_ROWS = 5;

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

/**
 * The library items that finishing logs as `kind` (the library's own mapping,
 * `learningFor`), in the order given, one per title (the first wins). Only
 * reading ("pages") and listening ("podcast") take library items; any other
 * kind gets none.
 */
export function libraryTitles(
  items: Pick<CatalogItem, "id" | "title" | "kind" | "format" | "pageCount">[],
  kind: LearningKind,
): LibraryTitle[] {
  if (kind !== "pages" && kind !== "podcast") return [];
  const seen = new Set<string>();
  const out: LibraryTitle[] = [];
  for (const it of items) {
    const k = key(it.title);
    if (!k || seen.has(k) || learningFor(it).kind !== kind) continue;
    seen.add(k);
    out.push({ title: it.title.trim(), itemId: it.id, itemKind: it.kind });
  }
  return out;
}

/**
 * Library items first, then the titles logged before. A title that is both
 * (ignoring case and surrounding spaces) appears once, as the library item.
 */
export function mergeTitles(library: LibraryTitle[], past: TitleSuggestion[]): TitleOption[] {
  const inLibrary = new Set(library.map((l) => key(l.title)));
  return [
    ...library.map((l): TitleOption => ({ source: "library", ...l })),
    ...past
      .filter((p) => !inLibrary.has(key(p.title)))
      .map((p): TitleOption => ({ source: "past", ...p })),
  ];
}

/** Options whose title contains `query` (ignoring case); all of them when it's blank. */
export function filterTitles<T extends { title: string }>(titles: T[], query: string): T[] {
  const q = key(query);
  return q ? titles.filter((t) => key(t.title).includes(q)) : titles;
}

/** The option `query` names exactly (ignoring case), if any. Library items come first, so they win. */
export function matchTitle<T extends { title: string }>(titles: T[], query: string): T | undefined {
  const q = key(query);
  return q ? titles.find((t) => key(t.title) === q) : undefined;
}

/** At most `max` library rows (titles logged before are all kept, as the list always did). */
export function capTitles(options: TitleOption[], max = MAX_LIBRARY_ROWS): TitleOption[] {
  let lib = 0;
  return options.filter((o) => o.source !== "library" || lib++ < max);
}

/**
 * What a save logs under: the option the text names (its spelling), else the
 * text as typed, else `fallback`; and the library item it picked, if any.
 */
export function resolveTitle(
  options: TitleOption[],
  typed: string,
  fallback: string,
): { title: string; itemId: string | null } {
  const hit = matchTitle(options, typed);
  return {
    title: hit?.title ?? (typed.trim() || fallback),
    itemId: hit?.source === "library" ? hit.itemId : null,
  };
}
