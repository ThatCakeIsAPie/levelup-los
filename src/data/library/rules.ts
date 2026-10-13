/**
 * Library rules (pure: no React, no stores). The hooks in ./hooks apply them;
 * with real accounts the database enforces the same visibility and
 * permissions (row-level security) and these stay the client mirror.
 */
import type { LearningKind } from "@/stores/crmStore";
import type {
  CatalogFormat,
  CatalogItem,
  CatalogKind,
  CatalogSource,
  ChannelColor,
  LibraryChannel,
  LibraryProgress,
  LibraryVisibility,
  LinkProvider,
  Speaker,
} from "./types";

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

export const KIND_LABEL: Record<CatalogKind, string> = {
  audio: "Audio",
  video: "Video",
  slides: "Slides",
  document: "Document",
};

export const FORMAT_LABEL: Record<CatalogFormat, string> = {
  talk: "Talk",
  panel: "Panel",
  q_and_a: "Q&A",
  workshop: "Workshop",
  interview: "Interview",
};

export const VISIBILITY_LABEL: Record<LibraryVisibility, string> = {
  team: "My whole team",
  ibos: "IBOs and leaders",
  downline: "My downline",
};

export const CATALOG_KINDS: CatalogKind[] = ["audio", "video", "slides", "document"];
export const CATALOG_FORMATS: CatalogFormat[] = [
  "talk",
  "panel",
  "q_and_a",
  "workshop",
  "interview",
];
export const CHANNEL_COLORS: ChannelColor[] = ["teal", "navy", "amber", "green", "sky", "mist"];
/** lucide icon names a channel can use (src/modules/library/icons.ts maps them). */
export const CHANNEL_ICONS = [
  "flag",
  "user-plus",
  "shopping-bag",
  "sprout",
  "mic",
  "calendar-check",
  "book-open",
  "graduation-cap",
  "lightbulb",
  "target",
  "trophy",
  "rocket",
  "heart-handshake",
  "star",
] as const;

// ---------------------------------------------------------------------------
// Who is looking
// ---------------------------------------------------------------------------

export type LibraryRole = "leader" | "ibo" | "apprentice" | "candidate";
export type LibraryWorkspaceRole = "leader" | "moderator" | "member";

export interface LibraryViewer {
  personId: string;
  /** Session role (demo users) / account role. */
  role: LibraryRole;
  /** Workspace role (leader / moderator / member), null when not a workspace member. */
  workspaceRole: LibraryWorkspaceRole | null;
  /** Effective business stage (an apprentice past their anniversary is an IBO). */
  stage: "ibo" | "apprentice" | "prospect" | "customer" | null;
  /** Everyone above them on the sponsor line (their upline). */
  uplineIds: Set<string>;
  /** Has at least one person in their business downline. */
  hasDownline: boolean;
}

type PersonLink = { id: string; sponsorId?: string | null; bizClass: string };

/** Build a viewer from the full roster (local mode) or what the person may see. */
export function buildLibraryViewer(input: {
  personId: string;
  role: LibraryRole;
  workspaceRole: LibraryWorkspaceRole | null;
  stage: LibraryViewer["stage"];
  people: PersonLink[];
}): LibraryViewer {
  const byId = new Map(input.people.map((p) => [p.id, p]));
  const uplineIds = new Set<string>();
  let cur = byId.get(input.personId);
  while (cur?.sponsorId && !uplineIds.has(cur.sponsorId)) {
    uplineIds.add(cur.sponsorId);
    cur = byId.get(cur.sponsorId);
  }
  const hasDownline = input.people.some(
    (p) => p.sponsorId === input.personId && p.bizClass !== "customer",
  );
  return {
    personId: input.personId,
    role: input.role,
    workspaceRole: input.workspaceRole,
    stage: input.stage,
    uplineIds,
    hasDownline,
  };
}

/** Team leaders and workspace moderators: create for the whole team, manage topics, edit anything. */
export function isLibraryManager(v: LibraryViewer | null): boolean {
  if (!v) return false;
  return v.role === "leader" || v.workspaceRole === "leader" || v.workspaceRole === "moderator";
}

/** IBOs and leaders (who may open "IBOs and leaders" items and channels). */
export function isIboOrLeader(v: LibraryViewer | null): boolean {
  if (!v) return false;
  return isLibraryManager(v) || v.role === "ibo" || v.stage === "ibo";
}

type Owned = { createdBy: string; visibility: LibraryVisibility };

/** May the viewer open this item or channel? */
export function canSeeLibrary(thing: Owned, v: LibraryViewer | null): boolean {
  if (!v) return false;
  if (thing.createdBy === v.personId) return true;
  if (thing.visibility === "team") return true;
  if (thing.visibility === "ibos") return isIboOrLeader(v);
  return v.uplineIds.has(thing.createdBy);
}

/**
 * A channel the viewer can't open but should see as locked (an "IBOs and
 * leaders" channel shown to apprentices and candidates as something to grow into).
 */
export function isLockedForViewer(thing: Owned, v: LibraryViewer | null): boolean {
  return !!v && thing.visibility === "ibos" && !canSeeLibrary(thing, v);
}

/** Leaders/moderators (for the team) and anyone with a downline (for their downline). */
export function canCreateInLibrary(v: LibraryViewer | null): boolean {
  if (!v || v.role === "candidate") return false;
  return isLibraryManager(v) || v.hasDownline;
}

/** The "Who can see it" options the viewer may pick, widest first. */
export function allowedVisibilities(v: LibraryViewer | null): LibraryVisibility[] {
  if (!canCreateInLibrary(v)) return [];
  return isLibraryManager(v) ? ["team", "ibos", "downline"] : ["downline"];
}

/** The creator, or a leader/moderator, may edit or delete it. */
export function canEditLibrary(thing: Owned, v: LibraryViewer | null): boolean {
  if (!v) return false;
  if (isLibraryManager(v)) return true;
  return thing.createdBy === v.personId && canCreateInLibrary(v);
}

/** Leaders and moderators manage the topic list. */
export const canManageTopics = (v: LibraryViewer | null) => isLibraryManager(v);

/**
 * Can an item with this audience be a lesson in a channel with that audience
 * (so everyone who can open the channel can open its lessons)? A team channel
 * takes team items; an IBO channel team and IBO items; a downline channel team
 * and downline items.
 */
export function itemFitsChannel(channel: LibraryVisibility, item: LibraryVisibility): boolean {
  if (item === "team") return true;
  return channel === item;
}

/** Where a visible channel is listed: the team's, your upline's, or your own downline channel. */
export function channelGroup(c: Owned, v: LibraryViewer | null): "team" | "upline" | "mine" {
  if (c.visibility !== "downline") return "team";
  return v && c.createdBy === v.personId ? "mine" : "upline";
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export interface ParsedLink {
  provider: LinkProvider;
  /** URL to put in an <iframe> (null when the host can't be embedded). */
  embedUrl: string | null;
  /** Kind the link most likely is. */
  kind: CatalogKind;
}

/** Recognise a YouTube, Vimeo or Google Slides link and build its embed URL. */
export function parseLink(raw: string): ParsedLink | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    const id =
      host === "youtu.be"
        ? parts[0]
        : parts[0] === "watch"
          ? url.searchParams.get("v")
          : ["embed", "shorts", "live", "v"].includes(parts[0])
            ? parts[1]
            : null;
    if (!id || !/^[\w-]{6,20}$/.test(id))
      return { provider: "youtube", embedUrl: null, kind: "video" };
    return {
      provider: "youtube",
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0`,
      kind: "video",
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const nums = parts.filter((p) => /^\d+$/.test(p));
    const id = nums[0];
    if (!id) return { provider: "vimeo", embedUrl: null, kind: "video" };
    // Unlisted videos carry a hash after the id (vimeo.com/123/abcdef or ?h=abcdef).
    const after = parts[parts.indexOf(id) + 1];
    const hash = url.searchParams.get("h") ?? (after && /^[\da-f]+$/i.test(after) ? after : null);
    return {
      provider: "vimeo",
      embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`,
      kind: "video",
    };
  }
  if (host === "docs.google.com" && parts[0] === "presentation") {
    const d = parts.indexOf("d");
    const id = d >= 0 ? parts[d + 1] : null;
    if (!id) return { provider: "google_slides", embedUrl: null, kind: "slides" };
    const base = `https://docs.google.com/presentation/d/${id}`;
    return {
      provider: "google_slides",
      embedUrl: `${base}/embed?start=false&loop=false`,
      kind: "slides",
    };
  }
  return { provider: "other", embedUrl: null, kind: "document" };
}

export const LINK_PROVIDER_LABEL: Record<LinkProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  google_slides: "Google Slides",
  other: "Link",
};

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Played this share of an audio/video and it counts as finished. */
export const COMPLETE_FRACTION = 0.9;
/** Items added in the last this-many days show as "New" until you start them. */
export const NEW_DAYS = 14;

/** Audio or video uploaded to the app: plays in the in-app player and tracks position. */
export function isPlayable(item: Pick<CatalogItem, "kind" | "source">): boolean {
  return item.source === "upload" && (item.kind === "audio" || item.kind === "video");
}

/** Has a position reached the completion threshold? */
export function reachedCompletion(positionSec: number, durationSec: number | null): boolean {
  return !!durationSec && durationSec > 0 && positionSec >= durationSec * COMPLETE_FRACTION;
}

/** 0..1 for one item (finished = 1; position / length for playable media). */
export function itemFraction(
  item: Pick<CatalogItem, "durationSec">,
  p: LibraryProgress | undefined,
): number {
  if (!p) return 0;
  if (p.completedAt) return 1;
  if (!item.durationSec) return 0;
  return Math.max(0, Math.min(1, p.positionSec / item.durationSec));
}

/** Started and not finished. */
export const isInProgress = (p: LibraryProgress | undefined) =>
  !!p && !p.completedAt && p.positionSec > 0;

/** Seconds left for playable media (null when unknown). */
export function remainingSec(
  item: Pick<CatalogItem, "durationSec">,
  p: LibraryProgress | undefined,
): number | null {
  if (!item.durationSec) return null;
  return Math.max(0, Math.round(item.durationSec - (p?.positionSec ?? 0)));
}

/** Where to start playing: the saved spot, or the beginning when finished or at the very end. */
export function resumePosition(
  item: Pick<CatalogItem, "durationSec">,
  p: LibraryProgress | undefined,
): number {
  if (!p || p.positionSec <= 0) return 0;
  if (p.completedAt) return 0;
  if (item.durationSec && p.positionSec >= item.durationSec - 2) return 0;
  return p.positionSec;
}

export type ProgressUpdate =
  | { type: "position"; positionSec: number; durationSec: number | null }
  | { type: "complete" }
  | { type: "uncomplete" };

/**
 * The next progress row for one person and item.
 *  - position: saved; reaching COMPLETE_FRACTION of the length finishes it.
 *  - complete: "Mark as done" (documents, slides, links; or by hand).
 *  - uncomplete: "Mark as not done" (keeps `loggedAt`, so finishing again never logs twice).
 * `shouldLog` is true exactly once per person and item: the first time it is finished.
 */
export function nextProgress(
  prev: LibraryProgress | undefined,
  update: ProgressUpdate,
  ctx: { personId: string; itemId: string; now: string },
): { progress: LibraryProgress; completedNow: boolean; shouldLog: boolean } {
  const base: LibraryProgress = prev ?? {
    personId: ctx.personId,
    itemId: ctx.itemId,
    positionSec: 0,
    completedAt: null,
    loggedAt: null,
    updatedAt: ctx.now,
  };
  let positionSec = base.positionSec;
  let completedAt = base.completedAt;
  if (update.type === "position") {
    const max = update.durationSec && update.durationSec > 0 ? update.durationSec : Infinity;
    positionSec = Math.max(0, Math.min(max, Math.round(update.positionSec * 10) / 10));
    if (!completedAt && reachedCompletion(positionSec, update.durationSec)) completedAt = ctx.now;
  } else if (update.type === "complete") {
    completedAt = completedAt ?? ctx.now;
  } else {
    completedAt = null;
  }
  const completedNow = !base.completedAt && !!completedAt;
  const shouldLog = completedNow && !base.loggedAt;
  return {
    progress: {
      ...base,
      positionSec,
      completedAt,
      loggedAt: shouldLog ? ctx.now : base.loggedAt,
      updatedAt: ctx.now,
    },
    completedNow,
    shouldLog,
  };
}

/**
 * What finishing an item logs to learning (so it counts toward the streak and
 * the weekly goal, src/stores/crmStore.ts):
 *  - documents: "pages", amount = page count (1 when unknown);
 *  - workshops (audio, video or slides): "workshop", 1;
 *  - other audio and video (talks, panels, Q&As, interviews): "podcast", 1;
 *  - other slides: "pages", amount = slide count (1 when unknown).
 */
export function learningFor(item: Pick<CatalogItem, "kind" | "format" | "pageCount">): {
  kind: LearningKind;
  amount: number;
} {
  const pages = Math.max(1, item.pageCount ?? 1);
  if (item.kind === "document") return { kind: "pages", amount: pages };
  if (item.format === "workshop") return { kind: "workshop", amount: 1 };
  if (item.kind === "audio" || item.kind === "video") return { kind: "podcast", amount: 1 };
  return { kind: "pages", amount: pages };
}

/** Created in the last NEW_DAYS days by someone else and not started by the viewer. */
export function isNewItem(
  item: Pick<CatalogItem, "createdAt" | "createdBy">,
  p: LibraryProgress | undefined,
  now = Date.now(),
  viewerId?: string,
): boolean {
  if (viewerId && item.createdBy === viewerId) return false;
  if (p && (p.positionSec > 0 || p.completedAt)) return false;
  return now - Date.parse(item.createdAt) < NEW_DAYS * 86_400_000;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Every item id in lesson order (first occurrence only). */
export function channelItemIds(c: Pick<LibraryChannel, "sections">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of c.sections) {
    for (const id of s.itemIds) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

export interface ChannelStats {
  done: number;
  total: number;
  /** done / total (0 for an empty channel). */
  fraction: number;
  /** The lesson to continue with: the first unfinished one (null when all done). */
  nextId: string | null;
  /** Its 1-based lesson number. */
  nextNumber: number | null;
}

/** Progress through a channel's lessons (ids the viewer can't see are skipped by the caller). */
export function channelStats(
  orderedIds: string[],
  progressByItem: Map<string, LibraryProgress>,
): ChannelStats {
  let done = 0;
  let nextIdx = -1;
  orderedIds.forEach((id, i) => {
    if (progressByItem.get(id)?.completedAt) done++;
    else if (nextIdx < 0) nextIdx = i;
  });
  const total = orderedIds.length;
  return {
    done,
    total,
    fraction: total ? done / total : 0,
    nextId: nextIdx >= 0 ? orderedIds[nextIdx] : null,
    nextNumber: nextIdx >= 0 ? nextIdx + 1 : null,
  };
}

/** The lesson after `itemId` in a channel (null at the end or when not in it). */
export function nextInChannel(orderedIds: string[], itemId: string): string | null {
  const i = orderedIds.indexOf(itemId);
  return i >= 0 && i < orderedIds.length - 1 ? orderedIds[i + 1] : null;
}

/** The lesson before `itemId` in a channel. */
export function prevInChannel(orderedIds: string[], itemId: string): string | null {
  const i = orderedIds.indexOf(itemId);
  return i > 0 ? orderedIds[i - 1] : null;
}

/** Move an item one place up or down within the channel, across section borders. */
export function moveInSections(
  sections: LibraryChannel["sections"],
  itemId: string,
  dir: -1 | 1,
): LibraryChannel["sections"] {
  const out = sections.map((s) => ({ ...s, itemIds: [...s.itemIds] }));
  const si = out.findIndex((s) => s.itemIds.includes(itemId));
  if (si < 0) return sections;
  const sec = out[si];
  const i = sec.itemIds.indexOf(itemId);
  const j = i + dir;
  if (j >= 0 && j < sec.itemIds.length) {
    [sec.itemIds[i], sec.itemIds[j]] = [sec.itemIds[j], sec.itemIds[i]];
    return out;
  }
  // Past the edge of its section: move into the neighbouring section.
  const ni = si + dir;
  if (ni < 0 || ni >= out.length) return sections;
  sec.itemIds.splice(i, 1);
  if (dir < 0) out[ni].itemIds.push(itemId);
  else out[ni].itemIds.unshift(itemId);
  return out;
}

/**
 * Drop a lesson at a place (drag and drop): into `sectionId` before the
 * lesson at `index` (counted without the moved lesson; past the end = last).
 */
export function placeInSections(
  sections: LibraryChannel["sections"],
  itemId: string,
  sectionId: string,
  index: number,
): LibraryChannel["sections"] {
  if (!sections.some((s) => s.id === sectionId)) return sections;
  const out = sections.map((s) => ({ ...s, itemIds: s.itemIds.filter((id) => id !== itemId) }));
  const target = out.find((s) => s.id === sectionId)!;
  const at = Math.max(0, Math.min(index, target.itemIds.length));
  target.itemIds.splice(at, 0, itemId);
  return out;
}

/** The item to "Continue": the one you touched most recently and haven't finished. */
export function continueCandidate(
  progress: LibraryProgress[],
  isAvailable: (itemId: string) => boolean,
): LibraryProgress | null {
  let best: LibraryProgress | null = null;
  for (const p of progress) {
    if (!isInProgress(p) || !isAvailable(p.itemId)) continue;
    if (!best || p.updatedAt > best.updatedAt) best = p;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Catalog ("All talks")
// ---------------------------------------------------------------------------

/** Stable key for a speaker: the person id, or "guest:<name>". */
export function speakerKey(s: Speaker): string {
  return s.personId ?? `guest:${(s.name ?? "").trim().toLowerCase()}`;
}

export type CatalogSort = "newest" | "oldest" | "title" | "shortest" | "longest";

export const SORT_LABEL: Record<CatalogSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A to Z",
  shortest: "Shortest first",
  longest: "Longest first",
};

export interface CatalogFilters {
  q?: string;
  /** speakerKey() */
  speaker?: string;
  format?: CatalogFormat;
  topic?: string;
  kind?: CatalogKind;
  event?: string;
  sort?: CatalogSort;
}

/** The date an item is sorted and shown by: when it was recorded, else when it was added. */
export const itemDate = (i: Pick<CatalogItem, "recordedOn" | "createdAt">) =>
  i.recordedOn ?? i.createdAt.slice(0, 10);

/** Rough length in minutes for sorting (documents count a minute per page). */
const sortLength = (i: CatalogItem) =>
  i.durationSec ? i.durationSec / 60 : i.pageCount ? i.pageCount : Number.MAX_SAFE_INTEGER;

/**
 * Filter and sort the catalog. `names` resolves speaker, topic and event names
 * for the free-text search (title, description, speakers, topics, event).
 */
export function filterCatalog(
  items: CatalogItem[],
  f: CatalogFilters,
  names: {
    person: (id: string) => string | undefined;
    topic: (id: string) => string | undefined;
    event: (id: string) => string | undefined;
  },
): CatalogItem[] {
  const q = f.q?.trim().toLowerCase();
  const out = items.filter((i) => {
    if (f.kind && i.kind !== f.kind) return false;
    if (f.format && i.format !== f.format) return false;
    if (f.topic && !i.topicIds.includes(f.topic)) return false;
    if (f.event && i.eventId !== f.event) return false;
    if (f.speaker && !i.speakers.some((s) => speakerKey(s) === f.speaker)) return false;
    if (q) {
      const hay = [
        i.title,
        i.description ?? "",
        ...i.speakers.map((s) => (s.personId ? names.person(s.personId) : s.name) ?? ""),
        ...i.topicIds.map((t) => names.topic(t) ?? ""),
        i.eventId ? (names.event(i.eventId) ?? "") : "",
        FORMAT_LABEL[i.format],
      ]
        .join(" ")
        .toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const sort = f.sort ?? "newest";
  const byNewest = (a: CatalogItem, b: CatalogItem) =>
    itemDate(b).localeCompare(itemDate(a)) || b.createdAt.localeCompare(a.createdAt);
  out.sort((a, b) => {
    switch (sort) {
      case "oldest":
        return -byNewest(a, b);
      case "title":
        return a.title.localeCompare(b.title);
      case "shortest":
        return sortLength(a) - sortLength(b) || byNewest(a, b);
      case "longest":
        return sortLength(b) - sortLength(a) || byNewest(a, b);
      default:
        return byNewest(a, b);
    }
  });
  return out;
}

/** How many of `items` carry each topic id. */
export function topicCounts(items: CatalogItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) for (const t of i.topicIds) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "11:02", "1:04:09". */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "18 min", "1 h 5 min" (at least 1 min). */
export function formatMinutes(sec: number): string {
  const m = Math.max(1, Math.round(sec / 60));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "Audio · 18 min", "Slides · 24 slides", "Document · 2 pages", "Video · YouTube". */
export function lengthLabel(
  i: Pick<CatalogItem, "kind" | "durationSec" | "pageCount" | "source" | "linkProvider">,
): string {
  const kind = KIND_LABEL[i.kind];
  if ((i.kind === "audio" || i.kind === "video") && i.durationSec)
    return `${kind} · ${formatMinutes(i.durationSec)}`;
  if (i.kind === "slides" && i.pageCount)
    return `${kind} · ${i.pageCount} ${i.pageCount === 1 ? "slide" : "slides"}`;
  if (i.kind === "document" && i.pageCount)
    return `${kind} · ${i.pageCount} ${i.pageCount === 1 ? "page" : "pages"}`;
  if (i.source === "link" && i.linkProvider)
    return `${kind} · ${LINK_PROVIDER_LABEL[i.linkProvider]}`;
  return kind;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ItemDraft {
  title: string;
  description?: string | null;
  kind: CatalogKind;
  source: CatalogSource;
  storagePath?: string | null;
  mime?: string | null;
  sizeBytes?: number | null;
  fileName?: string | null;
  linkUrl?: string | null;
  durationSec?: number | null;
  pageCount?: number | null;
  speakers: Speaker[];
  format: CatalogFormat;
  topicIds: string[];
  eventId?: string | null;
  recordedOn?: string | null;
  permissionConfirmed: boolean;
  visibility: LibraryVisibility;
}

/** Largest upload accepted (bytes). */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Problems that stop an item from being saved (empty = fine). */
export function validateItemDraft(d: ItemDraft, v: LibraryViewer | null): string[] {
  const errors: string[] = [];
  if (!d.title.trim()) errors.push("Give it a title.");
  if (d.source === "upload" && !d.storagePath) errors.push("Choose a file to upload.");
  if (d.source === "upload" && (d.sizeBytes ?? 0) > MAX_UPLOAD_BYTES)
    errors.push("That file is too big (200 MB at most).");
  if (d.source === "link" && !parseLink(d.linkUrl ?? ""))
    errors.push("Paste a full link (https://…).");
  if (!d.speakers.some((s) => s.personId || s.name?.trim()))
    errors.push("Add at least one speaker.");
  if (!d.permissionConfirmed) errors.push('Tick "I have permission to share this".');
  if (!allowedVisibilities(v).includes(d.visibility))
    errors.push("You can't share with that audience.");
  return errors;
}

/** Problems that stop a channel from being saved. */
export function validateChannelDraft(
  d: { title: string; visibility: LibraryVisibility },
  v: LibraryViewer | null,
): string[] {
  const errors: string[] = [];
  if (!d.title.trim()) errors.push("Give the channel a name.");
  if (!allowedVisibilities(v).includes(d.visibility))
    errors.push("You can't share with that audience.");
  return errors;
}
