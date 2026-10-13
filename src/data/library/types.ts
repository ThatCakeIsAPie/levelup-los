/**
 * Library data contract: the "All talks" catalog, team-managed topics,
 * channels (ordered, sectioned selections of catalog items) and each person's
 * progress. Field for field the shape proposed for the Postgres tables (see
 * docs in src/data/library/index.ts); camelCase here, snake_case there. Ids
 * are text, timestamps ISO strings, dates "YYYY-MM-DD", person ids are CRM
 * person ids. Nullable columns are `| null` (never omitted).
 */

/** What the file is. Decides the icon, the player and the learning kind. */
export type CatalogKind = "audio" | "video" | "slides" | "document";

/** How it was recorded. */
export type CatalogFormat = "talk" | "panel" | "q_and_a" | "workshop" | "interview";

/**
 * Who may see an item or channel (besides its creator):
 *  - team: everyone in the team (candidates included);
 *  - ibos: IBOs and leaders (shown locked to others when it's a channel);
 *  - downline: the creator's own business downline ("From Anita (your upline)").
 */
export type LibraryVisibility = "team" | "ibos" | "downline";

/** Where the file lives. */
export type CatalogSource = "upload" | "link";

/** Hosts a link can point to (each has its own in-app embed). */
export type LinkProvider = "youtube" | "vimeo" | "google_slides" | "other";

/** A speaker: a team person (`personId`) or an outside guest (`name`). Exactly one is set. */
export interface Speaker {
  personId: string | null;
  name: string | null;
}

/** `library_items` (+ `library_item_speakers`, `library_item_topics`). */
export interface CatalogItem {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  kind: CatalogKind;
  source: CatalogSource;
  /** Uploads: where the file is (`useLibraryFileUrl` turns it into a URL). */
  storagePath: string | null;
  mime: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  /** Links: the URL as pasted, and the host it was recognised as. */
  linkUrl: string | null;
  linkProvider: LinkProvider | null;
  /** Audio and video length in seconds (null when unknown). */
  durationSec: number | null;
  /** Documents: pages; slides: slides (null when unknown). */
  pageCount: number | null;
  speakers: Speaker[];
  format: CatalogFormat;
  /** Ids from the team's topic list. */
  topicIds: string[];
  /** The event it was recorded at, if any. */
  eventId: string | null;
  /** When it was recorded ("YYYY-MM-DD"), if known. */
  recordedOn: string | null;
  createdBy: string;
  /** The uploader ticked "I have permission to share this". Always true for saved items. */
  permissionConfirmed: boolean;
  visibility: LibraryVisibility;
  createdAt: string;
  updatedAt: string;
}

/** `library_topics`: the team-managed topic list (leaders and moderators manage it). */
export interface LibraryTopic {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
}

/** Channel colors (the tiles and icons in docs/design/library-mockup.html). */
export type ChannelColor = "navy" | "teal" | "amber" | "green" | "sky" | "mist";

/** One section of a channel ("Basics", "Inviting"…); `title` null = untitled. */
export interface ChannelSection {
  id: string;
  title: string | null;
  /** Catalog item ids, in lesson order. */
  itemIds: string[];
}

/** `library_channels` (+ `library_channel_sections`, `library_channel_items`). */
export interface LibraryChannel {
  id: string;
  workspaceId: string;
  title: string;
  description: string | null;
  /** lucide icon name (kebab-case), one of CHANNEL_ICONS. */
  icon: string;
  color: ChannelColor;
  createdBy: string;
  visibility: LibraryVisibility;
  /** In order. A channel always has at least one section. */
  sections: ChannelSection[];
  createdAt: string;
  updatedAt: string;
}

/** `library_progress`: one row per person per item. */
export interface LibraryProgress {
  personId: string;
  itemId: string;
  /** Audio/video: where they stopped (seconds). 0 for documents, slides and links. */
  positionSec: number;
  /** When it was finished (ISO), or null. */
  completedAt: string | null;
  /** When finishing it was logged to their learning (ISO). Set once, never cleared. */
  loggedAt: string | null;
  updatedAt: string;
}

/** Every library table, as the browser store keeps it. */
export interface LibraryData {
  items: CatalogItem[];
  topics: LibraryTopic[];
  channels: LibraryChannel[];
  progress: LibraryProgress[];
}
