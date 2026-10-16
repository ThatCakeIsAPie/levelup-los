/**
 * Event categories (docs/plans/mvp-plan-2026-10-13.md "Events"): each team
 * keeps its own list of kinds of event instead of a fixed set of types. A
 * category carries what used to come from the type: whether people can join
 * online, whether it uses tickets and travel, whether a miss reminds uplines,
 * and whether customers are welcome (Home's "Invite your customers").
 *
 * Real accounts: table `event_categories` (migration
 * 20261016002000_event_categories); events point at one with `category_id`.
 */

/** The curated icon keys (lucide icons; the UI maps them in src/modules/events/categoryMeta). */
export const CATEGORY_ICONS = [
  "moon",
  "briefcase",
  "lightbulb",
  "graduation",
  "users",
  "ticket",
  "calendar",
  "coffee",
  "mic",
  "presentation",
  "handshake",
  "star",
  "rocket",
  "book",
  "trophy",
  "heart",
] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Color tones (design tokens; the UI maps them to classes). */
export const CATEGORY_TONES = ["neutral", "green", "blue", "amber", "rose"] as const;
export type CategoryTone = (typeof CATEGORY_TONES)[number];

export interface EventCategory {
  id: string;
  name: string;
  icon: CategoryIcon;
  tone: CategoryTone;
  /** People can join online (otherwise in person only). */
  allowsVirtual: boolean;
  /** Uses tickets (buy-by dates, ticket reminders, the ticket funnel, the Attendees tab). */
  usesTickets: boolean;
  /** Uses travel plans, shared costs and qualifications (the full event page). */
  usesTravel: boolean;
  /** Missing one after coming last time reminds the person's uplines. */
  countsForMissed: boolean;
  /** Customers are welcome: Home suggests inviting yours. */
  welcomesCustomers: boolean;
  /** Display order (lowest first). */
  position: number;
  /** Set when archived: still shown on old events, not offered for new ones. */
  archivedAt?: string;
  createdBy?: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** The yes/no settings of a category (what the form and Team settings edit). */
export type CategoryFlags = Pick<
  EventCategory,
  "allowsVirtual" | "usesTickets" | "usesTravel" | "countsForMissed" | "welcomesCustomers"
>;

export interface EventCategoriesData {
  categories: EventCategory[];
}
