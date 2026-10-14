import type { UnlockArea } from "@/data/unlocks";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Contact,
  FileBarChart,
  Kanban,
  LayoutDashboard,
  Library,
  ListChecks,
  Megaphone,
  MessageCircle,
  Network,
  Route,
  Settings,
  ShoppingBag,
  Sprout,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavPath =
  | "/"
  | "/chats"
  | "/inbox"
  | "/library"
  | "/learning"
  | "/business"
  | "/pipeline"
  | "/people"
  | "/mindmap"
  | "/events"
  | "/customers"
  | "/wallet"
  | "/campaigns"
  | "/reports"
  | "/settings";

/** Which live count a nav item shows as an amber badge. */
export type NavBadge = "chats" | "inbox" | "events";

/** The four sides of the business: the phone tabs and the sidebar sections. */
export type NavCategory = "growth" | "customers" | "team" | "events";

/** `/customers` tabs, as the route's `tab` search param (undefined: the pipeline). */
export type CustomersTabParam = "list" | "customers";

export interface NavItem {
  to: NavPath;
  label: string;
  /** Shorter label for the phone section links ("Pipeline" for "Recruiting pipeline"). */
  short?: string;
  icon: LucideIcon;
  /** Only active on an exact match (Home). */
  exact?: boolean;
  /** `/customers` items: which tab (they are tabs of one page). */
  customersTab?: CustomersTabParam | null;
  /** Your own profile (`/people/<you>`, your growth path) instead of `to`. */
  profile?: boolean;
  badge?: NavBadge;
  /** Shown only when this area is unlocked for the person (src/data/unlocks.ts). */
  area: UnlockArea;
}

export interface NavSection {
  /** Small uppercase section label; the first section has none. */
  label?: string;
  /** The phone tab this section is (the top section and More are not tabs). */
  category?: NavCategory;
  items: NavItem[];
}

/**
 * The navigation, by the sides of the business: Personal growth, Customers
 * (customer sales), My team (recruiting) and Events, then More. The desktop
 * sidebar shows every section; on phones the four categories are the tabs and
 * Home, Chats and the Inbox sit in the top bar. Items show only when their
 * area is unlocked; Chats, Library and Campaigns also follow the team's
 * feature switches.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: LayoutDashboard, exact: true, area: "home" },
      { to: "/chats", label: "Chats", icon: MessageCircle, badge: "chats", area: "chats" },
      { to: "/inbox", label: "Inbox", icon: Bell, badge: "inbox", area: "inbox" },
    ],
  },
  {
    label: "Personal growth",
    category: "growth",
    items: [
      { to: "/learning", label: "Learning", icon: BookOpen, area: "learning" },
      { to: "/library", label: "Library", icon: Library, area: "library" },
      { to: "/people", label: "My path", icon: Route, profile: true, area: "profile" },
    ],
  },
  {
    label: "Customers",
    category: "customers",
    items: [
      {
        to: "/customers",
        label: "Customer pipeline",
        short: "Pipeline",
        icon: Kanban,
        customersTab: null,
        area: "customers",
      },
      {
        to: "/customers",
        label: "Your list",
        icon: ListChecks,
        customersTab: "list",
        area: "customers",
      },
      {
        to: "/customers",
        label: "Customers",
        icon: Contact,
        customersTab: "customers",
        area: "customers",
      },
    ],
  },
  {
    label: "My team",
    category: "team",
    items: [
      {
        to: "/pipeline",
        label: "Recruiting pipeline",
        short: "Pipeline",
        icon: Kanban,
        area: "pipeline",
      },
      { to: "/mindmap", label: "Team map", icon: Network, area: "team" },
      { to: "/people", label: "People", icon: Users, area: "people" },
    ],
  },
  {
    label: "Events",
    category: "events",
    items: [
      { to: "/events", label: "Events", icon: CalendarDays, badge: "events", area: "events" },
      { to: "/wallet", label: "Wallet", icon: Wallet, area: "wallet" },
    ],
  },
  {
    label: "More",
    items: [
      { to: "/reports", label: "Reports", icon: FileBarChart, area: "reports" },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone, area: "campaigns" },
      { to: "/settings", label: "Settings", icon: Settings, area: "settings" },
    ],
  },
];

/** The phone tab for each category. */
export const CATEGORY_TAB: Record<NavCategory, { label: string; icon: LucideIcon }> = {
  growth: { label: "Growth", icon: Sprout },
  customers: { label: "Customers", icon: ShoppingBag },
  team: { label: "Team", icon: Users },
  events: { label: "Events", icon: CalendarDays },
};

/**
 * Categories whose pages get the phone section links (Learning · Library ·
 * My path). Customers is one page with its own tabs, so it needs none.
 */
export const SECTION_LINKS: readonly NavCategory[] = ["growth", "team", "events"];

/**
 * The new apprentice's sidebar (until First sponsor): five things, no
 * grouping (docs/design/mvp-mockup.html "A brand-new apprentice"). Chats, the
 * Inbox and the Library join when the team switches them on.
 */
export const STARTER_NAV: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, exact: true, area: "home" },
  { to: "/chats", label: "Chats", icon: MessageCircle, badge: "chats", area: "chats" },
  { to: "/inbox", label: "Inbox", icon: Bell, badge: "inbox", area: "inbox" },
  { to: "/customers", label: "Customers", icon: Contact, area: "customers" },
  { to: "/events", label: "Events", icon: CalendarDays, badge: "events", area: "events" },
  { to: "/learning", label: "Learning", icon: BookOpen, area: "learning" },
  { to: "/library", label: "Library", icon: Library, area: "library" },
  { to: "/wallet", label: "Wallet", icon: Wallet, area: "wallet" },
];

/** The app path without the deployment's base path (GitHub Pages serves under /levelup-los/). */
export function appPath(pathname: string, base: string = import.meta.env.BASE_URL): string {
  const b = base.replace(/\/+$/, "");
  return b && pathname.startsWith(`${b}/`) ? pathname.slice(b.length) : pathname;
}

/** True when `pathname` is `base` or below it ("/people" matches "/people/12"). */
export function underPath(pathname: string, base: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === base || p.startsWith(`${base}/`);
}

export const inAny = (pathname: string, bases: string[]) =>
  bases.some((b) => underPath(pathname, b));

/** Where the app is: the path, the `/customers` tab, and whose profile is yours. */
export interface NavLocation {
  /** The app path (without the deploy base). */
  pathname: string;
  /** The `tab` search param. */
  tab?: string;
  /** Your person id (your profile is "My path", other profiles are People). */
  me: string;
}

/** Pure: is this item the page you're on? */
export function itemActive(item: NavItem, loc: NavLocation): boolean {
  const mine = underPath(loc.pathname, `/people/${loc.me}`);
  if (item.profile) return mine;
  if (item.to === "/people") return underPath(loc.pathname, "/people") && !mine;
  if (item.exact) return loc.pathname === item.to;
  if (item.customersTab !== undefined) {
    const tab = loc.tab === "list" || loc.tab === "customers" ? loc.tab : null;
    return underPath(loc.pathname, item.to) && tab === item.customersTab;
  }
  return underPath(loc.pathname, item.to);
}

/** Pure: the category you're in (none on Home, Chats, the Inbox or More's pages). */
export function activeCategory(
  loc: NavLocation,
  sections: NavSection[] = NAV_SECTIONS,
): NavCategory | null {
  for (const s of sections)
    if (s.category && s.items.some((i) => itemActive(i, loc))) return s.category;
  return null;
}
