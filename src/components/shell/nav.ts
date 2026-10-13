import {
  Bell,
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
  /** Hidden for people who can't chat (candidates and prospects). */
  chatOnly?: boolean;
  /** Hidden for candidates (they have no customers or campaigns yet). */
  hideForCandidate?: boolean;
}

export interface NavSection {
  /** Small uppercase section label; the first section has none. */
  label?: string;
  /** Where the label links to (the "My business" hub). */
  labelTo?: NavPath;
  items: NavItem[];
}

/** Desktop sidebar, grouped like the phone tabs (see docs/design/chats-mockup.html). */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { to: "/", label: "Home", icon: LayoutDashboard, exact: true },
      { to: "/chats", label: "Chats", icon: MessageCircle, badge: "chats", chatOnly: true },
      { to: "/inbox", label: "Inbox", icon: Bell, badge: "inbox" },
      { to: "/library", label: "Library", icon: Library },
    ],
  },
  {
    label: "My business",
    labelTo: "/business",
    items: [
      { to: "/mindmap", label: "Team", icon: Network },
      { to: "/pipeline", label: "Pipeline", icon: Kanban, hideForCandidate: true },
      { to: "/people", label: "People", icon: Users },
      { to: "/customers", label: "Customers", icon: Contact, hideForCandidate: true },
      { to: "/events", label: "Events", icon: CalendarDays, badge: "events" },
      { to: "/wallet", label: "Wallet", icon: Wallet },
      { to: "/campaigns", label: "Campaigns", icon: Megaphone, hideForCandidate: true },
    ],
  },
  {
    label: "More",
    items: [
      { to: "/reports", label: "Reports", icon: FileBarChart },
      { to: "/settings", label: "Settings", icon: Settings },
    ],
  },
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
export const MORE_PATHS: NavPath[] = ["/reports", "/settings"];

/** True when `pathname` is `base` or below it ("/people" matches "/people/12"). */
export function underPath(pathname: string, base: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return p === base || p.startsWith(`${base}/`);
}

export const inAny = (pathname: string, bases: string[]) =>
  bases.some((b) => underPath(pathname, b));
