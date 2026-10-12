import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronsUpDown,
  House,
  Info,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Sun,
  UserCircle,
  X,
  CalendarDays,
  Users,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
  resetDemo,
  roleLabel,
  useCurrentUser,
  useEventsAttentionCount,
  useMe,
} from "@/data";
import { MORE_ITEMS, NAV_ITEMS } from "./nav";

const THEME_ICON: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, auto: Monitor };

/**
 * Logged-in app frame.
 * - lg+ : fixed 212px navy sidebar (logo, nav, user menu) + scrolling main.
 * - <lg : main + bottom tab bar (Home, People, Log FAB, Events, More).
 * Renders the global LogSheet and the reset-demo confirmation once.
 *
 * Pages render inside <main>, which is the scroll container (full height
 * minus the tab bar on phones). Pages should not set their own h-screen; use
 * `h-full` only for full-bleed canvases like the mindmap.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col bg-app lg:pl-[212px]">
      <Sidebar onReset={() => setResetOpen(true)} />
      <main
        className="relative min-h-0 flex-1 overflow-y-auto pt-safe lg:pt-0"
        data-scroll-restoration-id="app-main"
        id="main"
      >
        <ApprenticeNotice />
        {children}
      </main>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar
// ---------------------------------------------------------------------------

function Sidebar({ onReset }: { onReset: () => void }) {
  const eventsCount = useEventsAttentionCount();
  const base =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-sidebar-fg transition-colors hover:bg-sidebar-active hover:text-white";
  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-[212px] flex-col gap-1 bg-sidebar px-3 py-[18px] text-sidebar-fg lg:flex"
    >
      <Link to="/" className="mb-3.5 rounded-lg px-2 py-0.5 text-white">
        <Logo wordmark tagline />
      </Link>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          activeOptions={{ exact: !!item.exact }}
          className={base}
          activeProps={{
            className: "bg-sidebar-active !text-white font-semibold",
            "aria-current": "page",
          }}
        >
          <item.icon className="size-4 shrink-0" aria-hidden="true" />
          {item.label}
          {item.to === "/events" && eventsCount > 0 && (
            <span
              className="ml-auto rounded-full bg-amber px-[7px] text-[11px] font-bold leading-[18px] text-on-amber"
              aria-label={`${eventsCount} people said yes but have no ticket`}
            >
              {eventsCount}
            </span>
          )}
        </Link>
      ))}
      <div className="flex-1" />
      <UserMenu onReset={onReset} />
    </nav>
  );
}

function UserMenu({ onReset }: { onReset: () => void }) {
  const user = useCurrentUser();
  const me = useMe();
  const navigate = useNavigate();
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
            <span className="block text-[11px] text-sidebar-fg">{roleLabel[user.role]}</span>
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
        <DropdownMenuItem onSelect={onReset}>
          <RotateCcw /> Reset demo data
        </DropdownMenuItem>
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

function TabBar({ onMore }: { onMore: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const moreActive = MORE_ITEMS.some((i) => pathname.startsWith(i.to));
  const tab =
    "grid justify-items-center gap-[3px] py-1 text-[10.5px] font-semibold text-faint focus-visible:outline-2 focus-visible:outline-ring rounded-lg";
  const on = { className: "!text-primary", "aria-current": "page" as const };
  return (
    <nav
      aria-label="Main"
      className="relative z-30 grid shrink-0 grid-cols-5 items-center border-t border-line bg-surface px-1.5 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      <Link to="/" activeOptions={{ exact: true }} className={tab} activeProps={on}>
        <House className="size-5" aria-hidden="true" />
        Home
      </Link>
      <Link to="/people" className={tab} activeProps={on}>
        <Users className="size-5" aria-hidden="true" />
        People
      </Link>
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
      <Link to="/events" className={tab} activeProps={on}>
        <CalendarDays className="size-5" aria-hidden="true" />
        Events
      </Link>
      <button
        type="button"
        onClick={onMore}
        className={cn(tab, moreActive && "text-primary")}
        aria-haspopup="dialog"
      >
        <Menu className="size-5" aria-hidden="true" />
        More
      </button>
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
  const close = () => onOpenChange(false);
  const row =
    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-surface-2";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-card px-4 pb-safe pt-5"
      >
        <SheetHeader className="mb-2 flex-row items-center gap-3 space-y-0 px-1 text-left">
          <PersonAvatar name={user.name} stage={me?.bizClass ?? "ibo"} size="lg" />
          <div>
            <SheetTitle className="text-base font-extrabold">{user.name}</SheetTitle>
            <SheetDescription className="text-xs">{roleLabel[user.role]}</SheetDescription>
          </div>
        </SheetHeader>
        <div className="grid gap-0.5">
          {MORE_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={close}
              className={row}
              activeProps={{ className: "bg-primary-soft text-primary-ink" }}
            >
              <item.icon className="size-[18px] text-muted-foreground" aria-hidden="true" />
              {item.label}
            </Link>
          ))}
          <Link to="/people/$id" params={{ id: user.personId }} onClick={close} className={row}>
            <UserCircle className="size-[18px] text-muted-foreground" aria-hidden="true" />
            My profile
          </Link>
        </div>
        <div className="my-3 border-t border-line" />
        <div className="grid gap-2 px-1">
          <span className="text-xs font-semibold text-muted-foreground">Theme</span>
          <ThemeSwitcher />
        </div>
        <div className="my-3 border-t border-line" />
        <div className="grid gap-0.5 pb-2">
          <button type="button" className={row} onClick={onReset}>
            <RotateCcw className="size-[18px] text-muted-foreground" aria-hidden="true" />
            Reset demo data
          </button>
          <button
            type="button"
            className={row}
            onClick={() => {
              close();
              logout();
            }}
          >
            <LogOut className="size-[18px] text-muted-foreground" aria-hidden="true" />
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
// Reset confirmation + apprentice notice
// ---------------------------------------------------------------------------

function ResetDemoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset demo data?</AlertDialogTitle>
          <AlertDialogDescription>
            This clears everything saved in this browser (people, events, logs, settings and your
            theme) and reloads the original demo seed. You will be logged out.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={() => resetDemo()}
          >
            Reset demo data
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

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
    <div className="flex items-start gap-2 border-b border-line bg-info-soft px-4 py-2 text-[12px] text-info-ink lg:px-[26px]">
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
