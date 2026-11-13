import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/plus-jakarta-sans";
import "./styles.css";
import { router, queryClient } from "./router";
import { initTheme } from "./lib/theme";
import { initAppearance } from "./lib/appearance";
import { restoreTeamLook } from "./lib/teamLook";
import { IS_SUPABASE } from "./lib/config";

initTheme();
initAppearance();

function mount() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

// The team's look of the person this browser is signed in as, from the last visit's cache, before the first
// render: no flash of the brand's look. With real accounts it is applied right here; the demo keeps its
// pictures in IndexedDB, so it waits for that one read (a few milliseconds) first. Anything that goes
// wrong falls back to the brand's look.
let pending: Promise<void> | void;
try {
  pending = restoreTeamLook(
    IS_SUPABASE
      ? undefined
      : (look) => import("./data/teamLook/resolve").then((m) => m.resolveLook(look)),
  );
} catch {
  pending = undefined;
}
if (pending) void pending.then(mount, mount);
else mount();
