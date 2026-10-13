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
  Megaphone,
  MessageCircle,
  Network,
  Settings,
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

export interface NavItem {
  to: NavPath;
  label: string;
  icon: LucideIcon;
  /** Only active on an exact match (Home). */
  exact?: boolean;
  badge?: NavBadge;
  /** Shown only when this area is unlocked for the person (src/data/unlocks.ts). */
  area: UnlockArea;
}

export interface NavSection {
  /** Small uppercase section label; the first section has none. */
  label?: string;
  /** Where the label links to (the "My business" hub). */
  labelTo?: NavPath;
  items: NavItem[];
}

/**
 * Desktop sidebar, grouped like the phone tabs (see docs/design/chats-mockup.html).
 * Items show only when their area is unlocked; Chats, Library and Campaigns
 * also follow the team's feature switches.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: LayoutDashboard, exact: true, area: "home" },
      { to: "/chats", label: "Chats", icon: MessageCircle, badge: "chats", area: "chats" },
      { to: "/inbox", label: "Inbox", icon: Bell, badge: "inbox", area: "inbox" },
      { to: "/learning", label: "Learning", icon: BookOpen, area: "learning" },
      { to: "/library", label: "Library", icon: Library, area: "library" },
    ],
  },
  {
    label: "My business",
    labelTo: "/business",
    items: [
      { to: "/mindmap", label: "Team", icon: Network, area: "team" },
      { to: "/pipeline", label: "Pipeline", icon: Kanban, area: "pipeline" },
      { to: "/people", label: "People", icon: Users, area: "people" },
      { to: "/customers", label: "Customers", icon: Contact, area: "customers" },
      { to: "/events", label: "Events", icon: CalendarDays, badge: "events", area: "events" },
      { to: "/wallet", label: "Wallet", icon: Wallet, area: "wallet" },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone, area: "campaigns" },
    ],
  },
  {
    label: "More",
    items: [
      { to: "/reports", label: "Reports", icon: FileBarChart, area: "reports" },
      { to: "/settings", label: "Settings", icon: Settings, area: "settings" },
    ],
  },
];

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

/** Routes that light up the phone "My business" tab. */
export const BUSINESS_PATHS: NavPath[] = [
  "/business",
  "/pipeline",
  "/mindmap",
  "/people",
  "/customers",
  "/events",
  "/wallet",
  "/campaigns",
];

/** Routes reached from the phone "More" sheet (lights up the More tab). */
export const MORE_PATHS: NavPath[] = ["/reports", "/settings", "/learning", "/library"];

/** True when `pathname` is `base` or below it ("/people" matches "/people/12"). */
export function underPath(pathname: string, base: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === base || p.startsWith(`${base}/`);
}

export const inAny = (pathname: string, bases: string[]) =>
  bases.some((b) => underPath(pathname, b));
