import { IS_LOCAL_DEMO } from "@/lib/config";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  CalendarDays,
  ChevronsUpDown,
  Contact,
  FileBarChart,
  House,
  Info,
  Library,
  LockOpen,
  LogOut,
  Megaphone,
  MessageCircle,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Settings,
  ShieldCheck,
  Sun,
  User,
  UserCircle,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo, PersonAvatar } from "@/components/brand";
import { LogSheet } from "@/components/log/LogSheet";
import { cn } from "@/lib/utils";
import { THEME_OPTIONS, useTheme, type ThemePreference } from "@/lib/theme";
import {
  logout,
  openLog,
  roleLabel,
  useActingFor,
  useCurrentUser,
  useEventsAttentionCount,
  useMe,
  useUnreadChatsCount,
  useRecordMilestoneHistory,
  useUnreadInboxCount,
} from "@/data";
import { badgeText, useNavAccess } from "./access";
import {
  CATEGORY_TAB,
  NAV_SECTIONS,
  SECTION_LINKS,
  STARTER_NAV,
  activeCategory,
  appPath,
  inAny,
  itemActive,
  underPath,
  type NavBadge,
  type NavItem,
  type NavLocation,
  type NavSection,
} from "./nav";
import { ResetDemoDialog } from "./ResetDemoDialog";
import { RouteGuard } from "./RouteGuard";
import { LibraryPlayer } from "@/modules/library/player/LibraryPlayer";

const THEME_ICON: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, auto: Monitor };

/**
 * Logged-in app frame.
 * - lg+ : fixed 212px navy sidebar (logo, grouped nav, user menu) + scrolling main.
 * - <lg : a top bar (logo for Home, Chats, the Inbox, your avatar for More),
 *   main (with the section links of the category you're in) and the bottom
 *   tabs: Growth · Customers · Log FAB · Team · Events. The new apprentice
 *   keeps the short Home · Customers · + · Events · Me tabs and no top bar.
 * Renders the global LogSheet and the reset-demo confirmation once, and keeps
 * the growth path's milestone history recorded (MilestoneHistoryRecorder).
 *
 * Pages render inside <main>, which is the scroll container (full height
 * minus the tab bar on phones) and a flex column: the apprentice notice (if
 * shown) sits on top and the page below it. Normal pages just flow and scroll;
 * a full-screen page (the mindmap) uses `flex min-h-0 flex-1 flex-col` to take
 * exactly the space that's left. Pages never set their own h-screen.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { starter } = useNavAccess();

  return (
    <div className="flex h-dvh flex-col bg-app lg:pl-[212px]">
      <Sidebar onReset={() => setResetOpen(true)} />
      {!starter && <TopBar onMore={() => setMoreOpen(true)} />}
      <main
        className={cn(
          "relative flex min-h-0 flex-1 flex-col overflow-y-auto lg:pt-0",
          starter && "pt-safe",
        )}
        data-scroll-restoration-id="app-main"
        id="main"
      >
        <ApprenticeNotice />
        {!starter && <SectionLinks />}
        <RouteGuard>{children}</RouteGuard>
      </main>
      {/* Library player: one media element for the app, keeps playing across pages. */}
      <LibraryPlayer />
      <TabBar onMore={() => setMoreOpen(true)} />
      <MoreSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
        onReset={() => {
          setMoreOpen(false);
          setResetOpen(true);
        }}
      />
      <LogSheet />
      <ResetDemoDialog open={resetOpen} onOpenChange={setResetOpen} />
      <MilestoneHistoryRecorder />
    </div>
  );
}

/**
 * Records growth milestone history (First sponsor and the headcount
 * milestones) for you and the team you coach while the data shows it, so a
 * later drop keeps the first-reached date and its unlocks (src/data/growth).
 * Its own component so data changes don't re-render the shell.
 */
function MilestoneHistoryRecorder() {
  useRecordMilestoneHistory();
  return null;
}

/** Live counts for the amber nav badges. */
function useBadgeCounts(): Record<NavBadge, number> {
  const { unlocks } = useNavAccess();
  const chats = useUnreadChatsCount();
  const inbox = useUnreadInboxCount();
  const events = useEventsAttentionCount();
  return {
    chats: unlocks.can.chats ? chats : 0,
    inbox,
    // Ticket and attendance follow-ups are event planning (3/10 and up).
    events: unlocks.can.eventPlanning ? events : 0,
  };
}

const BADGE_LABEL: Record<NavBadge, (n: number) => string> = {
  chats: (n) => `${n} ${n === 1 ? "chat" : "chats"} with unread messages`,
  inbox: (n) => `${n} unread ${n === 1 ? "notification" : "notifications"}`,
  events: (n) => `${n} ${n === 1 ? "person needs" : "people need"} attention for upcoming events`,
};

/** Where the app is, for the nav's active states (see itemActive in ./nav). */
function useNavLocation(): NavLocation {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tab = useRouterState({
    select: (s) => {
      const t = (s.location.search as { tab?: unknown }).tab;
      return typeof t === "string" ? t : undefined;
    },
  });
  const me = useCurrentUser().personId;
  return { pathname: appPath(pathname), tab, me };
}

/**
 * A nav item's link. The active state comes from itemActive (your profile is
 * My path, not People; the Customers items are tabs of one page), so the
 * router's own matching is narrowed to the exact page.
 */
function NavItemLink({
  item,
  me,
  active,
  className,
  onClick,
  children,
}: {
  item: NavItem;
  me: string;
  active: boolean;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const common = {
    className,
    onClick,
    activeOptions: { exact: true },
    "aria-current": active ? ("page" as const) : undefined,
  };
  if (item.profile)
    return (
      <Link to="/people/$id" params={{ id: me }} {...common}>
        {children}
      </Link>
    );
  if (item.customersTab !== undefined)
    return (
      <Link to="/customers" search={{ tab: item.customersTab ?? undefined }} {...common}>
        {children}
      </Link>
    );
  return (
    <Link to={item.to} {...common}>
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar
// ---------------------------------------------------------------------------

/** "IBO", "IBO · Maria's deputy · Admin": the line under the person's name. */
function useRoleLine(): string {
  const user = useCurrentUser();
  const actingFor = useActingFor();
  const parts = [roleLabel[user.role]];
  if (actingFor.length)
    parts.push(`${actingFor.map((p) => p.name.split(" ")[0]).join(" & ")}'s deputy`);
  if (user.admin) parts.push("Admin");
  return parts.join(" · ");
}

function Sidebar({ onReset }: { onReset: () => void }) {
  const counts = useBadgeCounts();
  const { unlocks, starter } = useNavAccess();
  const loc = useNavLocation();
  const shown = (i: NavItem) => unlocks.can[i.area];
  const sections: NavSection[] = starter ? [{ items: STARTER_NAV }] : NAV_SECTIONS;
  const base =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-active hover:text-white focus-visible:outline-2 focus-visible:outline-ring";
  const label =
    "block px-2.5 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[.09em] text-sidebar-fg/80";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-[212px] flex-col bg-sidebar px-3 py-[18px] text-sidebar-fg lg:flex"
    >
      <Link to="/" className="mb-3.5 rounded-lg px-2 py-0.5 text-white">
        <Logo wordmark tagline />
      </Link>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
        {sections.map((section, si) => {
          const items = section.items.filter(shown);
          if (!items.length) return null;
          return (
            <div key={si} className="grid gap-1" role="group" aria-label={section.label}>
              {section.label && <span className={label}>{section.label}</span>}
              {items.map((item) => {
                const n = item.badge ? counts[item.badge] : 0;
                const active = itemActive(item, loc);
                return (
                  <NavItemLink
                    key={item.label}
                    item={item}
                    me={loc.me}
                    active={active}
                    className={cn(base, active && "bg-sidebar-active font-semibold !text-white")}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden="true" />
                    {item.label}
                    {item.badge && n > 0 && (
                      <span
                        className="ml-auto rounded-full bg-amber px-[7px] text-[11px] font-bold leading-[18px] text-on-amber"
                        aria-label={BADGE_LABEL[item.badge](n)}
                      >
                        {badgeText(n)}
                      </span>
                    )}
                  </NavItemLink>
                );
              })}
            </div>
          );
        })}
      </div>
      {unlocks.next && (
        <p className="mx-0.5 my-1.5 flex items-start gap-2 rounded-[10px] bg-sidebar-active px-2.5 py-2 text-[11.5px] leading-snug text-sidebar-fg">
          <LockOpen className="mt-px size-[15px] shrink-0 text-sky" aria-hidden="true" />
          <span>{unlocks.next.text}</span>
        </p>
      )}
      <UserMenu onReset={onReset} />
    </nav>
  );
}

function UserMenu({ onReset }: { onReset: () => void }) {
  const user = useCurrentUser();
  const me = useMe();
  const navigate = useNavigate();
  const roleLine = useRoleLine();
  const { preference, setPreference } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="mt-2 flex w-full items-center gap-2.5 rounded-lg border-t border-sidebar-line px-2 pb-1 pt-3 text-left text-[12.5px] text-white hover:bg-sidebar-active focus-visible:outline-2 focus-visible:outline-ring"
          aria-label="Account menu"
        >
          <PersonAvatar
            name={user.name}
            stage={me?.bizClass ?? "ibo"}
            className="ring-1 ring-white/25"
          />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate font-semibold">{user.name}</span>
            <span className="block truncate text-[11px] text-sidebar-fg">{roleLine}</span>
          </span>
          <ChevronsUpDown className="size-3.5 text-sidebar-fg" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Signed in as {user.name}
        </DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={() => navigate({ to: "/people/$id", params: { id: user.personId } })}
        >
          <UserCircle /> My profile
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(v) => setPreference(v as ThemePreference)}
        >
          {THEME_OPTIONS.map((o) => {
            const Icon = THEME_ICON[o.value];
            return (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                <Icon className="mr-2 size-4" /> {o.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {IS_LOCAL_DEMO && (
          <DropdownMenuItem onSelect={onReset}>
            <RotateCcw /> Reset demo data
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Phone tab bar + More sheet
// ---------------------------------------------------------------------------

/** Tab icon with an optional amber count bubble on its top-right corner. */
function TabIcon({ icon: Icon, count = 0 }: { icon: LucideIcon; count?: number }) {
  return (
    <span className="relative inline-block">
      <Icon className="size-5" aria-hidden="true" />
      {count > 0 && (
        <span
          className="absolute -top-1 -right-[9px] grid h-4 min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-extrabold leading-none text-on-amber"
          aria-hidden="true"
        >
          {badgeText(count)}
        </span>
      )}
    </span>
  );
}

/** Paths that light up the new apprentice's "Me" tab. */
const ME_PATHS = ["/wallet", "/settings", "/learning", "/library", "/inbox", "/chats"];

const TAB =
  "grid justify-items-center gap-[3px] whitespace-nowrap rounded-lg py-1 text-[10.5px] font-semibold text-faint focus-visible:outline-2 focus-visible:outline-ring";
const TAB_ON = { className: "!text-primary", "aria-current": "page" as const };

/** The round Log button in the middle of the tab bar. */
function LogFab() {
  return (
    <div className="grid justify-items-center">
      <button
        type="button"
        onClick={() => openLog()}
        aria-label="Log learning, a check-in, a contact or a sale"
        className="-mt-7 grid size-[50px] place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_6px_16px_rgba(6,119,129,.35)] transition-transform active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus className="size-6" aria-hidden="true" />
      </button>
    </div>
  );
}

const TAB_BAR =
  "relative z-30 grid shrink-0 items-center border-t border-line bg-surface px-1.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden";

function TabBar({ onMore }: { onMore: () => void }) {
  const { starter } = useNavAccess();
  return starter ? <StarterTabBar onMore={onMore} /> : <CategoryTabBar />;
}

/**
 * Phone tabs: the four sides of the business with the Log button in the
 * middle. A tab opens the first page of its category you have unlocked and
 * lights up anywhere in that category. The Log button stays centered: a
 * missing tab (a candidate has no customers) leaves an empty slot.
 */
function CategoryTabBar() {
  const counts = useBadgeCounts();
  const { unlocks } = useNavAccess();
  const loc = useNavLocation();
  const current = activeCategory(loc);
  const tabs = NAV_SECTIONS.flatMap((s) => {
    const first = s.category ? s.items.find((i) => unlocks.can[i.area]) : undefined;
    return s.category && first ? [{ category: s.category, first }] : [];
  });
  const cells: ReactNode[] = tabs.map(({ category, first }) => {
    const { label, icon } = CATEGORY_TAB[category];
    const on = current === category;
    const count = category === "events" ? counts.events : 0;
    return (
      <NavItemLink
        key={category}
        item={first}
        me={loc.me}
        active={on}
        className={cn(TAB, on && "!text-primary")}
      >
        <TabIcon icon={icon} count={count} />
        {label}
        {count > 0 && <span className="sr-only">, {BADGE_LABEL.events(count)}</span>}
      </NavItemLink>
    );
  });
  const left = cells.slice(0, 2);
  const right = cells.slice(2, 4);
  const gap = (key: string) => <span key={key} aria-hidden="true" />;
  while (left.length < 2) left.unshift(gap(`gap-l${left.length}`));
  while (right.length < 2) right.push(gap(`gap-r${right.length}`));
  return (
    <nav aria-label="Main" className={cn(TAB_BAR, "grid-cols-5")}>
      {left}
      <LogFab />
      {right}
    </nav>
  );
}

/** The new apprentice's tabs: Home · Customers · + · Events · Me. */
function StarterTabBar({ onMore }: { onMore: () => void }) {
  const pathname = appPath(useRouterState({ select: (s) => s.location.pathname }));
  const counts = useBadgeCounts();
  const user = useCurrentUser();
  const meActive = inAny(pathname, ME_PATHS) || underPath(pathname, `/people/${user.personId}`);
  return (
    <nav aria-label="Main" className={cn(TAB_BAR, "grid-cols-5")}>
      <Link to="/" activeOptions={{ exact: true }} className={TAB} activeProps={TAB_ON}>
        <TabIcon icon={House} />
        Home
      </Link>
      <Link to="/customers" className={TAB} activeProps={TAB_ON}>
        <TabIcon icon={Contact} />
        Customers
      </Link>
      <LogFab />
      <Link to="/events" className={TAB} activeProps={TAB_ON}>
        <TabIcon icon={CalendarDays} count={counts.events} />
        Events
        {counts.events > 0 && (
          <span className="sr-only">, {BADGE_LABEL.events(counts.events)}</span>
        )}
      </Link>
      <button
        type="button"
        onClick={onMore}
        className={cn(TAB, meActive && "text-primary")}
        aria-haspopup="dialog"
      >
        <TabIcon icon={User} />
        Me
      </button>
    </nav>
  );
}

/** Phone top bar: the logo (Home), Chats, the Inbox and your avatar (the More sheet). */
function TopBar({ onMore }: { onMore: () => void }) {
  const user = useCurrentUser();
  const me = useMe();
  const counts = useBadgeCounts();
  const { unlocks, canChat } = useNavAccess();
  const icon =
    "grid size-10 place-items-center rounded-full text-muted-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring";
  const iconOn = { className: "!text-primary bg-primary-soft", "aria-current": "page" as const };
  return (
    <header className="relative z-20 flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3 pt-safe lg:hidden">
      <Link to="/" aria-label="Home" className="mr-auto rounded-lg py-2 pr-2 text-foreground">
        <Logo wordmark />
      </Link>
      {canChat && (
        <Link to="/chats" className={icon} activeProps={iconOn} aria-label="Chats">
          <TabIcon icon={MessageCircle} count={counts.chats} />
          {counts.chats > 0 && <span className="sr-only">, {BADGE_LABEL.chats(counts.chats)}</span>}
        </Link>
      )}
      {unlocks.can.inbox && (
        <Link to="/inbox" className={icon} activeProps={iconOn} aria-label="Inbox">
          <TabIcon icon={Bell} count={counts.inbox} />
          {counts.inbox > 0 && <span className="sr-only">, {BADGE_LABEL.inbox(counts.inbox)}</span>}
        </Link>
      )}
      <button
        type="button"
        onClick={onMore}
        aria-haspopup="dialog"
        aria-label="More: your profile, reports and settings"
        className="ml-1 rounded-full focus-visible:outline-2 focus-visible:outline-ring"
      >
        <PersonAvatar name={user.name} stage={me?.bizClass ?? "ibo"} />
      </button>
    </header>
  );
}

/**
 * Phone links between the pages of the category you're in (Learning ·
 * Library · My path; Pipeline · Team map · People; Events · Wallet), above
 * the page. Customers has its own tabs; a category with one page shows none.
 */
function SectionLinks() {
  const { unlocks } = useNavAccess();
  const loc = useNavLocation();
  const category = activeCategory(loc);
  const section = NAV_SECTIONS.find((s) => s.category === category);
  if (!category || !section || !SECTION_LINKS.includes(category)) return null;
  const items = section.items.filter((i) => unlocks.can[i.area]);
  if (items.length < 2) return null;
  return (
    <nav
      aria-label={section.label}
      className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pt-3 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const active = itemActive(item, loc);
        return (
          <NavItemLink
            key={item.label}
            item={item}
            me={loc.me}
            active={active}
            className={cn(
              "whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-semibold focus-visible:outline-2 focus-visible:outline-ring",
              active
                ? "border-primary bg-primary-soft text-primary-ink"
                : "border-line bg-surface text-muted-foreground",
            )}
          >
            {item.short ?? item.label}
          </NavItemLink>
        );
      })}
    </nav>
  );
}

function MoreSheet({
  open,
  onOpenChange,
  onReset,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onReset: () => void;
}) {
  const user = useCurrentUser();
  const me = useMe();
  const roleLine = useRoleLine();
  const { unlocks, canManageTeam, canChat, starter } = useNavAccess();
  const counts = useBadgeCounts();
  // Everyone else has Chats and the Inbox in the top bar, and Learning and the
  // Library under the Growth tab; the new apprentice finds them here.
  const inboxHere = unlocks.can.inbox && starter;
  const close = () => onOpenChange(false);
  const row =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-2";
  const rowOn = { className: "bg-primary-soft text-primary-ink" };
  const icon = "size-[18px] text-muted-foreground";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-card px-4 pt-5 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="mb-2 flex-row items-center gap-3 space-y-0 px-1 text-left">
          <PersonAvatar name={user.name} stage={me?.bizClass ?? "ibo"} size="lg" />
          <div>
            <SheetTitle className="text-base font-extrabold">{user.name}</SheetTitle>
            <SheetDescription className="text-xs">{roleLine}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="grid gap-0.5">
          {starter && canChat && (
            <Link to="/chats" onClick={close} className={row} activeProps={rowOn}>
              <MessageCircle className={icon} aria-hidden="true" />
              Chats
              {counts.chats > 0 && (
                <span
                  className="ml-auto rounded-full bg-amber px-[7px] text-[11px] font-bold leading-[18px] text-on-amber"
                  aria-label={BADGE_LABEL.chats(counts.chats)}
                >
                  {badgeText(counts.chats)}
                </span>
              )}
            </Link>
          )}
          {inboxHere && (
            <Link to="/inbox" onClick={close} className={row} activeProps={rowOn}>
              <Bell className={icon} aria-hidden="true" />
              Inbox
              {counts.inbox > 0 && (
                <span
                  className="ml-auto rounded-full bg-amber px-[7px] text-[11px] font-bold leading-[18px] text-on-amber"
                  aria-label={BADGE_LABEL.inbox(counts.inbox)}
                >
                  {badgeText(counts.inbox)}
                </span>
              )}
            </Link>
          )}
          {starter && (
            <Link to="/learning" onClick={close} className={row} activeProps={rowOn}>
              <BookOpen className={icon} aria-hidden="true" />
              Learning
            </Link>
          )}
          {starter && unlocks.can.library && (
            <Link to="/library" onClick={close} className={row} activeProps={rowOn}>
              <Library className={icon} aria-hidden="true" />
              Library
            </Link>
          )}
          {starter && (
            <Link to="/wallet" onClick={close} className={row} activeProps={rowOn}>
              <Wallet className={icon} aria-hidden="true" />
              Wallet
            </Link>
          )}
          {unlocks.can.reports && (
            <Link to="/reports" onClick={close} className={row} activeProps={rowOn}>
              <FileBarChart className={icon} aria-hidden="true" />
              Reports
            </Link>
          )}
          {!starter && unlocks.can.campaigns && (
            <Link to="/campaigns" onClick={close} className={row} activeProps={rowOn}>
              <Megaphone className={icon} aria-hidden="true" />
              Campaigns
            </Link>
          )}
          <Link
            to="/settings"
            activeOptions={{ exact: true }}
            onClick={close}
            className={row}
            activeProps={rowOn}
          >
            <Settings className={icon} aria-hidden="true" />
            Settings
          </Link>
          {canManageTeam && (
            <Link to="/settings/team" onClick={close} className={row} activeProps={rowOn}>
              <ShieldCheck className={icon} aria-hidden="true" />
              Team settings
            </Link>
          )}
          <Link to="/people/$id" params={{ id: user.personId }} onClick={close} className={row}>
            <UserCircle className={icon} aria-hidden="true" />
            My profile
          </Link>
        </div>
        {unlocks.next && (
          <p className="mx-1 mt-3 flex items-start gap-2 rounded-[10px] bg-primary-soft px-3 py-2.5 text-[12.5px] text-primary-ink">
            <LockOpen className="mt-px size-4 shrink-0" aria-hidden="true" />
            <span>{unlocks.next.text}</span>
          </p>
        )}
        <div className="my-3 border-t border-line" />
        <div className="grid gap-2 px-1">
          <span className="text-xs font-semibold text-muted-foreground">Theme</span>
          <ThemeSwitcher />
        </div>
        <div className="my-3 border-t border-line" />
        <div className="grid gap-0.5 pb-2">
          {IS_LOCAL_DEMO && (
            <button type="button" className={row} onClick={onReset}>
              <RotateCcw className={icon} aria-hidden="true" />
              Reset demo data
            </button>
          )}
          <button
            type="button"
            className={row}
            onClick={() => {
              close();
              logout();
            }}
          >
            <LogOut className={icon} aria-hidden="true" />
            Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Light / Dark / Auto segmented control bound to the saved theme preference. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        "inline-flex w-fit gap-0.5 rounded-[10px] border border-line bg-surface-2 p-[3px]",
        className,
      )}
    >
      {THEME_OPTIONS.map((o) => {
        const Icon = THEME_ICON[o.value];
        const on = preference === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => setPreference(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground",
              on && "bg-surface text-foreground shadow-sm",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Apprentice notice
// ---------------------------------------------------------------------------

const NOTICE_KEY = "levelup.apprenticeNoticeDismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Subtle, dismissible note for apprentices about first-year limits. */
function ApprenticeNotice() {
  const user = useCurrentUser();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (user.role !== "apprentice" || dismissed) return null;
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-line bg-info-soft px-4 py-2 text-[12px] text-info-ink lg:px-[26px]">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <p className="flex-1">
        Apprentice account (first contract year): you can't create shared costs or send invoices,
        and team rollups are read-only.
      </p>
      <button
        type="button"
        aria-label="Dismiss"
        className="rounded p-0.5 hover:bg-info-ink/10"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(NOTICE_KEY, "1");
          } catch {
            // ignore
          }
        }}
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}
