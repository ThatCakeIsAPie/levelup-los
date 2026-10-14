/**
 * Library feature public API (re-exported from "@/data").
 *
 * - The catalog ("All talks"): every talk, panel, workshop, slide deck or
 *   document is added once (upload or YouTube/Vimeo/Google Slides link) with
 *   speakers, format, topics, event and audience.
 * - Channels: hand-picked, ordered selections of catalog items in sections.
 * - Progress per person per item; finishing an item (≥ 90% played, or "Mark as
 *   done") logs it to learning once (rules.learningFor picks the kind).
 *
 * Tables live in ./store (localStorage `levelup.library` in the demo; in
 * memory with real accounts), files in ./files (IndexedDB
 * `levelup-library-media` in the demo).
 */
export * from "./types";
export {
  KIND_LABEL,
  FORMAT_LABEL,
  VISIBILITY_LABEL,
  LINK_PROVIDER_LABEL,
  SORT_LABEL,
  CATALOG_KINDS,
  CATALOG_FORMATS,
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  COMPLETE_FRACTION,
  NEW_DAYS,
  MAX_UPLOAD_BYTES,
  canSeeLibrary,
  canEditLibrary,
  itemFitsChannel,
  isPlayable,
  isInProgress,
  isNewItem,
  itemFraction,
  remainingSec,
  resumePosition,
  learningFor,
  parseLink,
  speakerKey,
  filterCatalog,
  topicCounts,
  itemDate,
  formatClock,
  formatMinutes,
  lengthLabel,
  validateItemDraft,
  type LibraryViewer,
  type ChannelStats,
  type CatalogFilters,
  type CatalogSort,
  type ItemDraft,
  type ParsedLink,
} from "./rules";
export {
  useLibraryViewer,
  useLibraryAccess,
  useLibraryPeople,
  speakerName,
  speakerLine,
  useCatalog,
  useCatalogItem,
  useLibraryTopics,
  useMyLibraryProgress,
  useItemProgress,
  useLibraryChannels,
  useLibraryChannel,
  useChannelsWithItem,
  useContinueLearning,
  useLessonContext,
  getLibraryChannelTitle,
  getCatalogItemTitle,
  type LibraryAccess,
  type ChannelView,
  type ContinueView,
  type LessonContext,
} from "./hooks";
export {
  addCatalogItem,
  updateCatalogItem,
  removeCatalogItem,
  addTopic,
  renameTopic,
  removeTopic,
  createChannel,
  updateChannel,
  removeChannel,
  addItemsToChannel,
  removeItemFromChannel,
  moveChannelItem,
  placeChannelItem,
  addChannelSection,
  renameChannelSection,
  removeChannelSection,
  moveChannelSection,
  saveLibraryPosition,
  markLibraryItemDone,
  markLibraryItemNotDone,
  type SaveResult,
  type ChannelDraft,
  type ProgressResult,
} from "./mutations";
export { saveLibraryFile, useLibraryFileUrl, loadLibraryFile, demoVideoPoster } from "./files";
export { CHANNEL_IDS as LIBRARY_CHANNEL_IDS } from "./seed";
