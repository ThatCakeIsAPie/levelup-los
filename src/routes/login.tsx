import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { DEMO_USERS, roleLabel, useSessionStore } from "@/stores/sessionStore";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Log in — LevelUp LOS" },
      {
        name: "description",
        content:
          "Pick a demo user to explore LevelUp LOS as a leader, IBO, apprentice or candidate.",
      },
      { property: "og:title", content: "Log in — LevelUp LOS" },
      { property: "og:description", content: "Pick a demo user to explore LevelUp LOS." },
    ],
  }),
  component: LoginPage,
});

const roleBlurb = {
  leader: "Sees the whole downline, team rollups and money tools.",
  ibo: "Sees only their own team, customers and activity.",
  apprentice: "First contract year — some tools are limited.",
  candidate: "Sees their own journey and events.",
} as const;

function LoginPage() {
  const login = useSessionStore((s) => s.login);
  const navigate = useNavigate();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Log in as</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Sandbox mode — pick a demo user. No password needed.
        </p>
        <div className="mt-4 space-y-2">
          {DEMO_USERS.map((u) => (
            <button
              key={u.personId}
              type="button"
              onClick={() => {
                login(u);
                navigate({ to: "/", replace: true });
              }}
              className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2.5 text-left hover:bg-accent"
            >
              <div>
                <div className="text-sm font-medium">{u.name}</div>
                <div className="text-xs text-muted-foreground">{roleBlurb[u.role]}</div>
              </div>
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {roleLabel[u.role]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
