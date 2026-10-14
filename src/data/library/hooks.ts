/**
 * Library read hooks. Everything returned is something the current user may
 * see (rules in ./rules). With real accounts the database already filtered the
 * rows (row-level security), so the client trusts what it was given.
 */
import { useMemo } from "react";
import { IS_SUPABASE } from "@/lib/config";
import { useSessionStore } from "@/stores/sessionStore";
import { effectiveBizClass, usePeopleStore } from "@/stores/peopleStore";
import { useChatStore } from "@/data/chat/store";
import { useChatPeople } from "@/data/chat/hooks";
import { getLibraryViewer } from "./mutations";
import { useLibraryExtras, type ChannelTeaser } from "./extras";
import { useLibraryStore } from "./store";
import {
  allowedVisibilities,
  buildLibraryViewer,
  canCreateInLibrary,
  canEditLibrary,
  canManageTopics,
  canSeeLibrary,
  channelGroup,
  channelItemIds,
  channelStats,
  continueCandidate,
  isLibraryManager,
  isLockedForViewer,
  isNewItem,
  itemFraction,
  nextInChannel,
  prevInChannel,
  remainingSec,
  type ChannelStats,
  type LibraryViewer,
} from "./rules";
import type {
  CatalogItem,
  CatalogKind,
  LibraryChannel,
  LibraryProgress,
  LibraryTopic,
  LibraryVisibility,
  Speaker,
} from "./types";

// ---------------------------------------------------------------------------
// Viewer and access
// ---------------------------------------------------------------------------

/** The current user as the library rules see them (null when signed out). */
export function useLibraryViewer(): LibraryViewer | null {
  const user = useSessionStore((s) => s.user);
  const people = usePeopleStore((s) => s.people);
  const members = useChatStore((s) => s.members);
  return useMemo(() => {
    if (!user) return null;
    const me = people.find((p) => p.id === user.personId);
    return buildLibraryViewer({
      personId: user.personId,
      role: user.role,
      workspaceRole: members.find((m) => m.personId === user.personId)?.role ?? null,
      stage: me ? effectiveBizClass(me) : null,
      people,
    });
  }, [user, people, members]);
}

export interface LibraryAccess {
  viewer: LibraryViewer | null;
  /** May add talks and channels (for the team, or for their downline). */
  canCreate: boolean;
  /** "Who can see it" choices, widest first. */
  visibilities: LibraryVisibility[];
  /** Leader or moderator: shares with the whole team, edits anything. */
  isManager: boolean;
  /** Leader or moderator: edits the topic list. */
  canManageTopics: boolean;
}

/** What the current user may do in the library. */
export function useLibraryAccess(): LibraryAccess {
  const viewer = useLibraryViewer();
  return useMemo(
    () => ({
      viewer,
      canCreate: canCreateInLibrary(viewer),
      visibilities: allowedVisibilities(viewer),
      isManager: isLibraryManager(viewer),
      canManageTopics: canManageTopics(viewer),
    }),
    [viewer],
  );
}

/** Visibility check for the current mode (real accounts: the server already filtered). */
function useCanSee() {
  const viewer = useLibraryViewer();
  return useMemo(
    () => (t: { createdBy: string; visibility: LibraryVisibility }) =>
      IS_SUPABASE || canSeeLibrary(t, viewer),
    [viewer],
  );
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Team people by id (names for speakers and channel owners). */
export function useLibraryPeople(): Map<string, { id: string; name: string }> {
  const chatPeople = useChatPeople();
  // Real accounts: people outside your CRM view and chat directory (e.g. your
  // upline, for a candidate) come from the library's own name list.
  const names = useLibraryExtras((s) => s.names);
  return useMemo(() => {
    const extra = Object.entries(names).filter(([id]) => !chatPeople.has(id));
    if (!extra.length) return chatPeople;
    const out = new Map<string, { id: string; name: string }>(chatPeople);
    for (const [id, name] of extra) out.set(id, { id, name });
    return out;
  }, [chatPeople, names]);
}

/** "Maria Reyes", or the guest's name. */
export function speakerName(
  s: Speaker,
  people: Map<string, { name: string }>,
  short = false,
): string {
  const full = s.personId ? (people.get(s.personId)?.name ?? "Team member") : (s.name ?? "Guest");
  return short ? full.split(" ")[0] : full;
}

/** "Maria Reyes, Anita Patel" (or first names with `short`); guests as "Guest: Sam Ortega" when alone. */
export function speakerLine(
  speakers: Speaker[],
  people: Map<string, { name: string }>,
  short = false,
): string {
  if (speakers.length === 1 && !speakers[0].personId) return `Guest: ${speakers[0].name ?? ""}`;
  return speakers.map((s) => speakerName(s, people, short)).join(", ");
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/** Every catalog item the current user may open, newest first. */
export function useCatalog(): CatalogItem[] {
  const items = useLibraryStore((s) => s.items);
  const canSee = useCanSee();
  return useMemo(
    () => items.filter(canSee).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [items, canSee],
  );
}

/** One catalog item, or undefined when missing or not visible. */
export function useCatalogItem(id: string | undefined): CatalogItem | undefined {
  const items = useLibraryStore((s) => s.items);
  const canSee = useCanSee();
  return useMemo(() => {
    const it = items.find((i) => i.id === id);
    return it && canSee(it) ? it : undefined;
  }, [items, id, canSee]);
}

/** The team's topics, in the order they were added. */
export function useLibraryTopics(): LibraryTopic[] {
  return useLibraryStore((s) => s.topics);
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** The current user's progress rows by item id. */
export function useMyLibraryProgress(): Map<string, LibraryProgress> {
  const progress = useLibraryStore((s) => s.progress);
  const me = useSessionStore((s) => s.user?.personId ?? "");
  return useMemo(
    () => new Map(progress.filter((p) => p.personId === me).map((p) => [p.itemId, p])),
    [progress, me],
  );
}

/** The current user's progress on one item. */
export function useItemProgress(itemId: string | undefined): LibraryProgress | undefined {
  const mine = useMyLibraryProgress();
  return itemId ? mine.get(itemId) : undefined;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelView {
  channel: LibraryChannel;
  /** "IBOs and leaders" channel shown to someone who can't open it yet. */
  locked: boolean;
  /** Listed under the team's channels, "From <upline>", or your own downline channels. */
  group: "team" | "upline" | "mine";
  ownerName: string;
  /** Sections with the lessons the viewer can open (empty when locked). */
  sections: { id: string; title: string | null; items: CatalogItem[] }[];
  /** Lessons in order (empty when locked). */
  items: CatalogItem[];
  /** Lesson count (also for locked channels). */
  lessonCount: number;
  stats: ChannelStats;
  /** Lessons added in the last two weeks that you haven't started. */
  newCount: number;
  /** You've started at least one lesson (finished or part way). */
  started: boolean;
  counts: Record<CatalogKind, number>;
  /** Total audio/video length in seconds. */
  totalSec: number;
  canEdit: boolean;
}

function buildChannelView(
  c: LibraryChannel,
  ctx: {
    viewer: LibraryViewer | null;
    itemById: Map<string, CatalogItem>;
    canSee: (t: CatalogItem) => boolean;
    mine: Map<string, LibraryProgress>;
    people: Map<string, { name: string }>;
    now: number;
  },
): ChannelView {
  const locked = !IS_SUPABASE && isLockedForViewer(c, ctx.viewer);
  const seen = new Set<string>();
  const sections = locked
    ? []
    : c.sections.map((s) => ({
        id: s.id,
        title: s.title,
        items: s.itemIds
          .filter((id) => {
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .map((id) => ctx.itemById.get(id))
          .filter((i): i is CatalogItem => !!i && ctx.canSee(i)),
      }));
  const items = sections.flatMap((s) => s.items);
  const counts: Record<CatalogKind, number> = { audio: 0, video: 0, slides: 0, document: 0 };
  let totalSec = 0;
  let newCount = 0;
  let started = false;
  for (const i of items) {
    const p = ctx.mine.get(i.id);
    if (p && (p.completedAt || p.positionSec > 0)) started = true;
    counts[i.kind]++;
    totalSec += i.durationSec ?? 0;
    if (isNewItem(i, ctx.mine.get(i.id), ctx.now, ctx.viewer?.personId)) newCount++;
  }
  return {
    channel: c,
    locked,
    group: channelGroup(c, ctx.viewer),
    ownerName: ctx.people.get(c.createdBy)?.name ?? "A team leader",
    sections,
    items,
    lessonCount: locked ? channelItemIds(c).length : items.length,
    stats: channelStats(
      items.map((i) => i.id),
      ctx.mine,
    ),
    newCount,
    started,
    counts,
    totalSec,
    canEdit: canEditLibrary(c, ctx.viewer),
  };
}

const GROUP_ORDER = { team: 0, upline: 1, mine: 2 } as const;

/**
 * Channels the current user can open (plus locked "IBOs and leaders" ones),
 * the team's first, then "From <upline>", then their own downline channels;
 * oldest first within a group (the order leaders built them).
 */
export function useLibraryChannels(): ChannelView[] {
  const channels = useLibraryStore((s) => s.channels);
  const items = useLibraryStore((s) => s.items);
  const viewer = useLibraryViewer();
  const canSee = useCanSee();
  const mine = useMyLibraryProgress();
  const people = useLibraryPeople();
  const teasers = useLibraryExtras((s) => s.teasers);
  return useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const now = Date.now();
    const ctx = { viewer, itemById, canSee, mine, people, now };
    const views = channels
      .filter((c) => canSee(c) || (!IS_SUPABASE && isLockedForViewer(c, viewer)))
      .map((c) => buildChannelView(c, ctx));
    // Real accounts: locked channels come from library_channel_teasers().
    for (const t of IS_SUPABASE ? teasers : []) {
      if (views.some((v) => v.channel.id === t.id)) continue;
      views.push(teaserView(t, ctx));
    }
    return views.sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
        a.channel.createdAt.localeCompare(b.channel.createdAt),
    );
  }, [channels, items, viewer, canSee, mine, people, teasers]);
}

/** A locked "IBOs and leaders" channel the database only described. */
function teaserView(t: ChannelTeaser, ctx: Parameters<typeof buildChannelView>[1]): ChannelView {
  const channel: LibraryChannel = {
    id: t.id,
    workspaceId: "",
    title: t.title,
    description: t.description,
    icon: t.icon,
    color: t.color,
    createdBy: t.createdBy,
    visibility: "ibos",
    sections: [],
    createdAt: t.createdAt,
    updatedAt: t.createdAt,
  };
  return {
    ...buildChannelView(channel, ctx),
    locked: true,
    lessonCount: t.lessonCount,
    canEdit: false,
  };
}

/** One channel (undefined when missing or not visible). */
export function useLibraryChannel(id: string | undefined): ChannelView | undefined {
  const all = useLibraryChannels();
  return useMemo(() => all.find((c) => c.channel.id === id), [all, id]);
}

/** Non-reactive channel title for the route head (undefined when not visible). */
export function getLibraryChannelTitle(id: string): string | undefined {
  const c = useLibraryStore.getState().channels.find((x) => x.id === id);
  return c && (IS_SUPABASE || canSeeLibrary(c, getLibraryViewer())) ? c.title : undefined;
}

/** Non-reactive item title for the route head (undefined when not visible). */
export function getCatalogItemTitle(id: string): string | undefined {
  const i = useLibraryStore.getState().items.find((x) => x.id === id);
  return i && (IS_SUPABASE || canSeeLibrary(i, getLibraryViewer())) ? i.title : undefined;
}

/** Channels (visible to the viewer) that contain an item. */
export function useChannelsWithItem(itemId: string | undefined): ChannelView[] {
  const all = useLibraryChannels();
  return useMemo(
    () => (itemId ? all.filter((c) => c.items.some((i) => i.id === itemId)) : []),
    [all, itemId],
  );
}

// ---------------------------------------------------------------------------
// Continue
// ---------------------------------------------------------------------------

export interface ContinueView {
  item: CatalogItem;
  progress: LibraryProgress;
  /** 0..1 */
  fraction: number;
  /** Seconds left (null when unknown). */
  remainingSec: number | null;
  /** The first channel it is a lesson in, with its 1-based number. */
  channel: { id: string; title: string; number: number; total: number } | null;
}

/** The item the current user stopped in most recently (null when nothing is in progress). */
export function useContinueLearning(): ContinueView | null {
  const mine = useMyLibraryProgress();
  const catalog = useCatalog();
  const channels = useLibraryChannels();
  return useMemo(() => {
    const byId = new Map(catalog.map((i) => [i.id, i]));
    const p = continueCandidate([...mine.values()], (id) => byId.has(id));
    if (!p) return null;
    const item = byId.get(p.itemId)!;
    const ch = channels.find((c) => !c.locked && c.items.some((i) => i.id === item.id));
    return {
      item,
      progress: p,
      fraction: itemFraction(item, p),
      remainingSec: remainingSec(item, p),
      channel: ch
        ? {
            id: ch.channel.id,
            title: ch.channel.title,
            number: ch.items.findIndex((i) => i.id === item.id) + 1,
            total: ch.items.length,
          }
        : null,
    };
  }, [mine, catalog, channels]);
}

export interface LessonContext {
  channel: ChannelView | undefined;
  /** 1-based lesson number in the channel (null without a channel). */
  number: number | null;
  prevId: string | null;
  nextId: string | null;
}

/** Where an item sits in a channel (for "Lesson 6 of 12", previous / next). */
export function useLessonContext(
  itemId: string | undefined,
  channelId: string | undefined,
): LessonContext {
  const channel = useLibraryChannel(channelId);
  return useMemo(() => {
    if (!channel || !itemId) return { channel, number: null, prevId: null, nextId: null };
    const ids = channel.items.map((i) => i.id);
    const i = ids.indexOf(itemId);
    return {
      channel,
      number: i >= 0 ? i + 1 : null,
      prevId: prevInChannel(ids, itemId),
      nextId: nextInChannel(ids, itemId),
    };
  }, [channel, itemId]);
}
