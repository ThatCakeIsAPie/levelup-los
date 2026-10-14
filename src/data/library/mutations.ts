/**
 * Library writes. Plain functions: they apply at once; with real accounts the
 * sync engine (src/data/remote) writes them to the database, which enforces
 * the same permissions (row-level security) and rolls back a refused change.
 *
 * Finishing an item logs it to learning once. In the browser-storage demo
 * that's done here (logLearning); with real accounts the database does it
 * (library_progress trigger) and the app only shows the same row, with the
 * same id, until the next refetch confirms it.
 */
import { useSessionStore } from "@/stores/sessionStore";
import { effectiveBizClass, usePeopleStore } from "@/stores/peopleStore";
import { useChatStore } from "@/data/chat/store";
import { logLearning } from "@/data/crm";
import { IS_SUPABASE } from "@/lib/config";
import { localDate } from "@/lib/dates";
import { useCrmStore } from "@/stores/crmStore";
import { serverSide } from "@/data/remote";
import { deleteLibraryFile, libraryWorkspaceId } from "./files";
import { library, updateLibrary } from "./store";
import {
  buildLibraryViewer,
  canEditLibrary,
  canManageTopics,
  canSeeLibrary,
  learningFor,
  moveInSections,
  placeInSections,
  nextProgress,
  validateChannelDraft,
  validateItemDraft,
  type ItemDraft,
  type LibraryViewer,
  type ProgressUpdate,
} from "./rules";
import type {
  CatalogItem,
  ChannelColor,
  ChannelSection,
  LibraryChannel,
  LibraryTopic,
  LibraryVisibility,
} from "./types";

/** Id of the learning row that finishing an item logs (same as the database's). */
export const libraryLearningId = (personId: string, itemId: string) =>
  `library:${itemId}:${personId}`;

/** The current user for the rules (non-reactive). */
export function getLibraryViewer(): LibraryViewer | null {
  const user = useSessionStore.getState().user;
  if (!user) return null;
  const people = usePeopleStore.getState().people;
  const me = people.find((p) => p.id === user.personId);
  return buildLibraryViewer({
    personId: user.personId,
    role: user.role,
    workspaceRole:
      useChatStore.getState().members.find((m) => m.personId === user.personId)?.role ?? null,
    stage: me ? effectiveBizClass(me) : null,
    people,
  });
}

const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();

export type SaveResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

// ---------------------------------------------------------------------------
// Catalog items
// ---------------------------------------------------------------------------

/** Add a talk to the catalog ("All talks"). Optionally straight into a channel. */
export function addCatalogItem(
  draft: ItemDraft,
  opts: { id?: string; channelId?: string; sectionId?: string } = {},
): SaveResult<CatalogItem> {
  const v = getLibraryViewer();
  const errors = validateItemDraft(draft, v);
  if (!v || errors.length)
    return { ok: false, errors: errors.length ? errors : ["Sign in first."] };
  const at = nowIso();
  const item: CatalogItem = {
    id: opts.id ?? uid(),
    workspaceId: libraryWorkspaceId(),
    title: draft.title.trim(),
    description: draft.description?.trim() || null,
    kind: draft.kind,
    source: draft.source,
    storagePath: draft.source === "upload" ? (draft.storagePath ?? null) : null,
    mime: draft.source === "upload" ? (draft.mime ?? null) : null,
    sizeBytes: draft.source === "upload" ? (draft.sizeBytes ?? null) : null,
    fileName: draft.source === "upload" ? (draft.fileName ?? null) : null,
    linkUrl: draft.source === "link" ? (draft.linkUrl?.trim() ?? null) : null,
    linkProvider: draft.source === "link" ? linkProviderOf(draft.linkUrl ?? "") : null,
    durationSec: draft.durationSec ?? null,
    pageCount: draft.pageCount ?? null,
    speakers: cleanSpeakers(draft.speakers),
    format: draft.format,
    topicIds: [...new Set(draft.topicIds)],
    eventId: draft.eventId ?? null,
    recordedOn: draft.recordedOn ?? null,
    createdBy: v.personId,
    permissionConfirmed: true,
    visibility: draft.visibility,
    createdAt: at,
    updatedAt: at,
  };
  updateLibrary((s) => ({ items: [item, ...s.items] }));
  if (opts.channelId) addItemsToChannel(opts.channelId, [item.id], opts.sectionId);
  return { ok: true, value: item };
}

function linkProviderOf(url: string): CatalogItem["linkProvider"] {
  if (/youtu\.?be/.test(url)) return "youtube";
  if (/vimeo\.com/.test(url)) return "vimeo";
  if (/docs\.google\.com\/presentation/.test(url)) return "google_slides";
  return "other";
}

const cleanSpeakers = (list: ItemDraft["speakers"]) =>
  list
    .map((s) =>
      s.personId
        ? { personId: s.personId, name: null }
        : { personId: null, name: s.name?.trim() || null },
    )
    .filter((s) => s.personId || s.name);

/** Edit a catalog item (creator, leaders and moderators). */
export function updateCatalogItem(id: string, draft: ItemDraft): SaveResult<CatalogItem> {
  const v = getLibraryViewer();
  const cur = library().items.find((i) => i.id === id);
  if (!cur || !canEditLibrary(cur, v)) return { ok: false, errors: ["You can't edit this."] };
  // Keeping the current audience is always allowed (a moderator editing a downline item).
  const errors = validateItemDraft(draft, v).filter(
    (e) => !(draft.visibility === cur.visibility && e.includes("audience")),
  );
  if (errors.length) return { ok: false, errors };
  const next: CatalogItem = {
    ...cur,
    title: draft.title.trim(),
    description: draft.description?.trim() || null,
    kind: draft.kind,
    durationSec: draft.durationSec ?? null,
    pageCount: draft.pageCount ?? null,
    speakers: cleanSpeakers(draft.speakers),
    format: draft.format,
    topicIds: [...new Set(draft.topicIds)],
    eventId: draft.eventId ?? null,
    recordedOn: draft.recordedOn ?? null,
    visibility: draft.visibility,
    linkUrl: cur.source === "link" ? (draft.linkUrl?.trim() ?? cur.linkUrl) : null,
    linkProvider: cur.source === "link" ? linkProviderOf(draft.linkUrl ?? cur.linkUrl ?? "") : null,
    updatedAt: nowIso(),
  };
  updateLibrary((s) => ({ items: s.items.map((i) => (i.id === id ? next : i)) }));
  return { ok: true, value: next };
}

/** Delete a catalog item: it leaves every channel, progress rows go, the file is removed. */
export function removeCatalogItem(id: string): boolean {
  const cur = library().items.find((i) => i.id === id);
  if (!cur || !canEditLibrary(cur, getLibraryViewer())) return false;
  updateLibrary((s) => ({
    items: s.items.filter((i) => i.id !== id),
    progress: s.progress.filter((p) => p.itemId !== id),
    channels: s.channels.map((c) =>
      c.sections.some((sec) => sec.itemIds.includes(id))
        ? {
            ...c,
            sections: c.sections.map((sec) => ({
              ...sec,
              itemIds: sec.itemIds.filter((x) => x !== id),
            })),
            updatedAt: nowIso(),
          }
        : c,
    ),
  }));
  void deleteLibraryFile(cur.storagePath);
  return true;
}

// ---------------------------------------------------------------------------
// Topics (leaders and moderators)
// ---------------------------------------------------------------------------

/** Add a topic (returns the existing one when the name is taken). */
export function addTopic(name: string): LibraryTopic | null {
  const v = getLibraryViewer();
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || !canManageTopics(v)) return null;
  const existing = library().topics.find((t) => t.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const topic: LibraryTopic = {
    id: uid(),
    workspaceId: libraryWorkspaceId(),
    name: clean,
    createdBy: v!.personId,
    createdAt: nowIso(),
  };
  updateLibrary((s) => ({ topics: [...s.topics, topic] }));
  return topic;
}

/** Rename a topic (false when the name is empty or taken). */
export function renameTopic(id: string, name: string): boolean {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean || !canManageTopics(getLibraryViewer())) return false;
  const taken = library().topics.some(
    (t) => t.id !== id && t.name.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) return false;
  updateLibrary((s) => ({
    topics: s.topics.map((t) => (t.id === id ? { ...t, name: clean } : t)),
  }));
  return true;
}

/** Delete a topic; items keep everything else. */
export function removeTopic(id: string): boolean {
  if (!canManageTopics(getLibraryViewer())) return false;
  updateLibrary((s) => ({
    topics: s.topics.filter((t) => t.id !== id),
    items: s.items.map((i) =>
      i.topicIds.includes(id) ? { ...i, topicIds: i.topicIds.filter((t) => t !== id) } : i,
    ),
  }));
  return true;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelDraft {
  title: string;
  description?: string | null;
  icon: string;
  color: ChannelColor;
  visibility: LibraryVisibility;
}

/** Create a channel (one untitled section to start). */
export function createChannel(d: ChannelDraft): SaveResult<LibraryChannel> {
  const v = getLibraryViewer();
  const errors = validateChannelDraft(d, v);
  if (!v || errors.length)
    return { ok: false, errors: errors.length ? errors : ["Sign in first."] };
  const at = nowIso();
  const id = uid();
  const channel: LibraryChannel = {
    id,
    workspaceId: libraryWorkspaceId(),
    title: d.title.trim(),
    description: d.description?.trim() || null,
    icon: d.icon,
    color: d.color,
    createdBy: v.personId,
    visibility: d.visibility,
    sections: [{ id: uid(), title: null, itemIds: [] }],
    createdAt: at,
    updatedAt: at,
  };
  updateLibrary((s) => ({ channels: [...s.channels, channel] }));
  return { ok: true, value: channel };
}

function editChannel(id: string, fn: (c: LibraryChannel) => Partial<LibraryChannel>): boolean {
  const cur = library().channels.find((c) => c.id === id);
  if (!cur || !canEditLibrary(cur, getLibraryViewer())) return false;
  updateLibrary((s) => ({
    channels: s.channels.map((c) => (c.id === id ? { ...c, ...fn(c), updatedAt: nowIso() } : c)),
  }));
  return true;
}

/** Edit a channel's name, description, icon, color or audience. */
export function updateChannel(id: string, d: ChannelDraft): SaveResult<LibraryChannel> {
  const v = getLibraryViewer();
  const cur = library().channels.find((c) => c.id === id);
  if (!cur || !canEditLibrary(cur, v))
    return { ok: false, errors: ["You can't edit this channel."] };
  const errors = validateChannelDraft(d, v).filter(
    (e) => !(d.visibility === cur.visibility && e.includes("audience")),
  );
  if (errors.length) return { ok: false, errors };
  editChannel(id, () => ({
    title: d.title.trim(),
    description: d.description?.trim() || null,
    icon: d.icon,
    color: d.color,
    visibility: d.visibility,
  }));
  return { ok: true, value: library().channels.find((c) => c.id === id)! };
}

/** Delete a channel (its lessons stay in All talks). */
export function removeChannel(id: string): boolean {
  const cur = library().channels.find((c) => c.id === id);
  if (!cur || !canEditLibrary(cur, getLibraryViewer())) return false;
  updateLibrary((s) => ({ channels: s.channels.filter((c) => c.id !== id) }));
  return true;
}

/** Add catalog items to the end of a section (default: the last one). Skips ones already in. */
export function addItemsToChannel(
  channelId: string,
  itemIds: string[],
  sectionId?: string,
): boolean {
  return editChannel(channelId, (c) => {
    const present = new Set(c.sections.flatMap((s) => s.itemIds));
    const add = itemIds.filter((id) => !present.has(id));
    const target = sectionId ?? c.sections[c.sections.length - 1]?.id;
    const sections: ChannelSection[] = c.sections.length
      ? c.sections
      : [{ id: uid(), title: null, itemIds: [] }];
    return {
      sections: sections.map((s) =>
        s.id === target || (!target && s === sections[sections.length - 1])
          ? { ...s, itemIds: [...s.itemIds, ...add] }
          : s,
      ),
    };
  });
}

/** Take a lesson out of a channel (it stays in All talks). */
export function removeItemFromChannel(channelId: string, itemId: string): boolean {
  return editChannel(channelId, (c) => ({
    sections: c.sections.map((s) => ({ ...s, itemIds: s.itemIds.filter((x) => x !== itemId) })),
  }));
}

/** Move a lesson one place up or down (crossing into the next section at an edge). */
export function moveChannelItem(channelId: string, itemId: string, dir: -1 | 1): boolean {
  return editChannel(channelId, (c) => ({ sections: moveInSections(c.sections, itemId, dir) }));
}

/** Drop a lesson into a section before the lesson at `index` (drag and drop). */
export function placeChannelItem(
  channelId: string,
  itemId: string,
  sectionId: string,
  index: number,
): boolean {
  return editChannel(channelId, (c) => ({
    sections: placeInSections(c.sections, itemId, sectionId, index),
  }));
}

/** Add a section at the end. */
export function addChannelSection(channelId: string, title: string): boolean {
  const clean = title.trim();
  if (!clean) return false;
  return editChannel(channelId, (c) => ({
    sections: [...c.sections, { id: uid(), title: clean, itemIds: [] }],
  }));
}

/** Rename a section (empty = untitled). */
export function renameChannelSection(channelId: string, sectionId: string, title: string): boolean {
  return editChannel(channelId, (c) => ({
    sections: c.sections.map((s) =>
      s.id === sectionId ? { ...s, title: title.trim() || null } : s,
    ),
  }));
}

/** Remove a section; its lessons join the section before it (or after, for the first). */
export function removeChannelSection(channelId: string, sectionId: string): boolean {
  return editChannel(channelId, (c) => {
    const i = c.sections.findIndex((s) => s.id === sectionId);
    if (i < 0 || c.sections.length === 1) return {};
    const moved = c.sections[i].itemIds;
    const rest = c.sections.filter((s) => s.id !== sectionId);
    const into = Math.max(0, i - 1);
    return {
      sections: rest.map((s, j) =>
        j === into
          ? { ...s, itemIds: i === 0 ? [...moved, ...s.itemIds] : [...s.itemIds, ...moved] }
          : s,
      ),
    };
  });
}

/** Move a section one place up or down. */
export function moveChannelSection(channelId: string, sectionId: string, dir: -1 | 1): boolean {
  return editChannel(channelId, (c) => {
    const i = c.sections.findIndex((s) => s.id === sectionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= c.sections.length) return {};
    const sections = [...c.sections];
    [sections[i], sections[j]] = [sections[j], sections[i]];
    return { sections };
  });
}

// ---------------------------------------------------------------------------
// Progress (and the learning log)
// ---------------------------------------------------------------------------

export interface ProgressResult {
  /** It became finished with this change. */
  completedNow: boolean;
  /** Finishing it was logged to learning now (once per person and item). */
  logged: boolean;
}

function applyProgress(itemId: string, update: ProgressUpdate): ProgressResult {
  const v = getLibraryViewer();
  const item = library().items.find((i) => i.id === itemId);
  // Real accounts: the store only holds what the database let you see.
  if (!v || !item || !(IS_SUPABASE || canSeeLibrary(item, v)))
    return { completedNow: false, logged: false };
  const prev = library().progress.find((p) => p.personId === v.personId && p.itemId === itemId);
  const { progress, completedNow, shouldLog } = nextProgress(prev, update, {
    personId: v.personId,
    itemId,
    now: nowIso(),
  });
  updateLibrary((s) => ({
    progress: prev ? s.progress.map((p) => (p === prev ? progress : p)) : [...s.progress, progress],
  }));
  if (shouldLog) {
    const { kind, amount } = learningFor(item);
    if (IS_SUPABASE) {
      // The database logs it (same id); show it now without writing it.
      const id = libraryLearningId(v.personId, item.id);
      serverSide(() => {
        const learning = useCrmStore.getState().learning;
        if (learning.some((l) => l.id === id)) return;
        useCrmStore.setState({
          learning: [
            { id, personId: v.personId, kind, title: item.title, amount, date: localDate() },
            ...learning,
          ],
        });
      });
    } else {
      logLearning({ kind, title: item.title, amount, personId: v.personId });
    }
  }
  return { completedNow, logged: shouldLog };
}

/** Save where the current user is in an audio/video (finishing ≥ 90% marks it done and logs it). */
export function saveLibraryPosition(
  itemId: string,
  positionSec: number,
  durationSec: number | null,
): ProgressResult {
  return applyProgress(itemId, { type: "position", positionSec, durationSec });
}

/** "Mark as done" (documents, slides, links, or any item by hand). Logs to learning once. */
export function markLibraryItemDone(itemId: string): ProgressResult {
  return applyProgress(itemId, { type: "complete" });
}

/** "Mark as not done" (the learning entry stays; finishing again won't log twice). */
export function markLibraryItemNotDone(itemId: string): void {
  applyProgress(itemId, { type: "uncomplete" });
}
