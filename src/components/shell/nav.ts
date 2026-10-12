import {
  CalendarDays,
  Contact,
  FileBarChart,
  LayoutDashboard,
  Megaphone,
  Network,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavPath =
  "/" | "/people" | "/mindmap" | "/events" | "/customers" | "/wallet" | "/campaigns" | "/reports";

export interface NavItem {
  to: NavPath;
  label: string;
  icon: LucideIcon;
  /** Only active on an exact match (Home). */
  exact?: boolean;
}

/** Sidebar order (desktop). */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: LayoutDashboard, exact: true },
  { to: "/people", label: "People", icon: Users },
  { to: "/mindmap", label: "Mindmap", icon: Network },
  { to: "/events", label: "Events", icon: CalendarDays },
  { to: "/customers", label: "Customers", icon: Contact },
  { to: "/wallet", label: "Wallet", icon: Wallet },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/reports", label: "Reports", icon: FileBarChart },
];

/** Items reachable from the phone "More" sheet (the rest are tabs). */
export const MORE_ITEMS: NavItem[] = NAV_ITEMS.filter((i) =>
  ["/mindmap", "/customers", "/wallet", "/campaigns", "/reports"].includes(i.to),
);
