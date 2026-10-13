import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, FlaskConical } from "lucide-react";
import { PersonAvatar } from "@/components/brand";
import { DEMO_USERS, login, roleLabel } from "@/data";
import { IS_LOCAL_DEMO } from "@/lib/config";
import { AuthHeading, AuthLayout } from "./AuthLayout";
import { ROLE_SEES, ROLE_STAGE } from "./demoRoles";
import { SignInForm } from "./SignInForm";

/**
 * Login: a navy brand panel and, in the browser-storage demo, a "Choose a
 * demo user" list; with real accounts, the email sign-in form. Renders
 * without the app shell (see SessionGate in __root.tsx).
 */
export function LoginScreen() {
  return <AuthLayout>{IS_LOCAL_DEMO ? <DemoPicker /> : <SignInForm />}</AuthLayout>;
}

function DemoPicker() {
  const navigate = useNavigate();

  return (
    <>
      <AuthHeading title="Choose a demo user">
        <p>
          Each person sees the app the way their role would. There are no passwords in this sandbox,
          so pick anyone to look around.
        </p>
      </AuthHeading>

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
          This is a sandbox demo. Data lives only in this browser, nothing is sent anywhere, and you
          can reset it any time from the account menu.
        </p>
      </div>
    </>
  );
}
