import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, FlaskConical } from "lucide-react";
import { Logo, PersonAvatar } from "@/components/brand";
import { DEMO_USERS, login, roleLabel, type BizClass, type Role } from "@/data";

/** Stage color for each demo role's avatar (the login page has no session, so no person lookup). */
const ROLE_STAGE: Record<Role, BizClass> = {
  leader: "ibo",
  ibo: "ibo",
  apprentice: "apprentice",
  candidate: "prospect",
};

/** One line on what each role can see. */
const ROLE_SEES: Record<Role, string> = {
  leader: "sees the whole team, rollups and money tools",
  ibo: "sees their own team and customers",
  apprentice: "first contract year, some tools are limited",
  candidate: "sees their own journey and events",
};

/**
 * Sandbox login: a navy brand panel and a "Choose a demo user" list. Renders
 * without the app shell (see SessionGate in __root.tsx). On phones the navy
 * panel becomes a short header band above the list.
 */
export function LoginScreen() {
  const navigate = useNavigate();

  return (
    <div className="grid min-h-full grid-rows-[auto_1fr] lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-1">
      <BrandPanel />

      <main className="flex items-start justify-center px-4 py-6 sm:py-10 lg:items-center lg:px-12">
        <div className="grid w-full max-w-[460px] gap-5">
          <div className="grid gap-1.5">
            <h2 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">
              Choose a demo user
            </h2>
            <p className="text-[13px] text-muted-foreground">
              Each person sees the app the way their role would. There are no passwords in this
              sandbox, so pick anyone to look around.
            </p>
          </div>

          <ul className="grid gap-2.5" aria-label="Demo users">
            {DEMO_USERS.map((u) => (
              <li key={u.personId}>
                <button
                  type="button"
                  onClick={() => {
                    login(u);
                    navigate({ to: "/", replace: true });
                  }}
                  className="group grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left transition-colors hover:border-primary hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <PersonAvatar name={u.name} stage={ROLE_STAGE[u.role]} size="lg" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{u.name}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{roleLabel[u.role]}</span>
                      {" · "}
                      {ROLE_SEES[u.role]}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-start gap-2.5 rounded-[10px] bg-info-soft px-3 py-2.5 text-[12.5px] text-info-ink">
            <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>
              This is a sandbox demo. Data lives only in this browser, nothing is sent anywhere, and
              you can reset it any time from the account menu.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Navy brand panel (desktop: full-height left column; phone: header band). */
function BrandPanel() {
  return (
    <aside className="relative isolate overflow-hidden bg-sidebar px-5 pb-6 pt-[calc(1.5rem+env(safe-area-inset-top))] text-white lg:flex lg:flex-col lg:px-12 lg:py-12">
      <LogoMotif />
      <div className="text-white">
        <Logo size="lg" wordmark tagline />
      </div>

      <div className="mt-5 grid max-w-[30rem] gap-2 lg:mt-auto lg:gap-3">
        <h1 className="text-[20px] font-extrabold leading-tight tracking-tight lg:text-[32px]">
          Your team, customers and events in one place.
        </h1>
        <p className="text-[13px] text-sidebar-fg lg:text-[15px]">
          LevelUp LOS helps the LevelUp team track people on the business path, look after
          customers, and get everyone to the next event.
        </p>
      </div>

      <p className="mt-10 hidden text-xs text-sidebar-fg lg:block">
        Sandbox demo · LTD · LevelUp team
      </p>
    </aside>
  );
}

/** The three rising logo bars, large and faint, anchored to the panel's corner. */
function LogoMotif() {
  return (
    <div
      className="pointer-events-none absolute -bottom-6 -right-4 -z-10 flex items-end gap-3 opacity-[0.14] lg:-bottom-10 lg:right-10 lg:gap-6 lg:opacity-[0.16]"
      aria-hidden="true"
    >
      <i className="block h-16 w-7 rounded-md bg-logo-1 lg:h-44 lg:w-16 lg:rounded-xl" />
      <i className="block h-24 w-7 rounded-md bg-logo-2 lg:h-72 lg:w-16 lg:rounded-xl" />
      <i className="block h-32 w-7 rounded-md bg-sky lg:h-[26rem] lg:w-16 lg:rounded-xl" />
    </div>
  );
}
