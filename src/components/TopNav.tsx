import { Link, useNavigate } from "@tanstack/react-router";
import {
  Wallet,
  Megaphone,
  FileBarChart,
  LayoutDashboard,
  Contact,
  Network,
  Users,
  CalendarDays,
  LogOut,
  RotateCcw,
  UserCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { roleLabel, useSessionStore } from "@/stores/sessionStore";
import { resetDemo } from "@/lib/db";

export function TopNav() {
  const user = useSessionStore((s) => s.user);
  const logout = useSessionStore((s) => s.logout);
  const navigate = useNavigate();
  const linkBase =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground";
  const activeCls = "bg-accent text-foreground";
  return (
    <>
      <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-3">
        <span className="mr-3 text-xs font-semibold tracking-tight">LevelUp LOS</span>
        {user && (
          <>
            <Link
              to="/"
              activeOptions={{ exact: true }}
              className={linkBase}
              activeProps={{ className: `${linkBase} ${activeCls}` }}
            >
              <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
            </Link>
            <Link
              to="/customers"
              className={linkBase}
              activeProps={{ className: `${linkBase} ${activeCls}` }}
            >
              <Contact className="h-3.5 w-3.5" /> Customers
            </Link>
            <Link
              to="/mindmap"
              className={linkBase}
              activeProps={{ className: `${linkBase} ${activeCls}` }}
            >
              <Network className="h-3.5 w-3.5" /> Mindmap
            </Link>
            <Link
              to="/people"
              className={linkBase}
              activeProps={{ className: `${linkBase} ${activeCls}` }}
            >
              <Users className="h-3.5 w-3.5" /> People
            </Link>
            <Link
              to="/events"
              className={linkBase}
              activeProps={{ className: `${linkBase} ${activeCls}` }}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Events
            </Link>
            {(
              [
                ["/wallet", Wallet, "Wallet"],
                ["/campaigns", Megaphone, "Campaigns"],
                ["/reports", FileBarChart, "Reports"],
              ] as const
            ).map(([to, I, l]) => (
              <Link
                key={to}
                to={to}
                className={linkBase}
                activeProps={{ className: `${linkBase} ${activeCls}` }}
              >
                <I className="h-3.5 w-3.5" /> {l}
              </Link>
            ))}
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={linkBase} aria-label="User menu">
                    <UserCircle className="h-4 w-4" />
                    {user.name}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                      {roleLabel[user.role]}
                    </span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel className="text-xs">
                    Logged in as {user.name}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => navigate({ to: "/people/$id", params: { id: user.personId } })}
                  >
                    <UserCircle className="mr-2 h-3.5 w-3.5" /> My profile
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      if (confirm("Reset all demo data to the original seed?")) resetDemo();
                    }}
                  >
                    <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset demo data
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      logout();
                      navigate({ to: "/login", replace: true });
                    }}
                  >
                    <LogOut className="mr-2 h-3.5 w-3.5" /> Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
      </nav>
      {user?.role === "apprentice" && (
        <div className="shrink-0 border-b border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          Apprentice account — first contract year. Limits: you can't create shared costs or send
          invoices, and team rollups are read-only.
        </div>
      )}
    </>
  );
}
