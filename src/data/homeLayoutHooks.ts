/** Home card layout: the signed-in person's, and saving it (rules in ./homeLayout). */
import { useMemo } from "react";
import { sameLayout, type HomeLayout } from "./homeLayout";
import { useHomeLayoutStore } from "./homeLayoutStore";
import { getViewer, useViewer } from "./session";

/** The signed-in person's saved layout (undefined = the default). */
export function useHomeLayout(): HomeLayout | undefined {
  const me = useViewer()?.personId;
  const layouts = useHomeLayoutStore((s) => s.layouts);
  return useMemo(() => (me ? layouts[me] : undefined), [layouts, me]);
}

/** Save the signed-in person's layout (nothing when it didn't change). */
export function setHomeLayout(layout: HomeLayout): void {
  const me = getViewer()?.personId;
  if (!me) return;
  const { layouts } = useHomeLayoutStore.getState();
  if (layouts[me] && sameLayout(layouts[me], layout)) return;
  useHomeLayoutStore.setState({
    layouts: { ...layouts, [me]: { order: [...layout.order], side: [...layout.side] } },
  });
}

/** Back to the default layout (removes the saved one). */
export function resetHomeLayout(): void {
  const me = getViewer()?.personId;
  if (!me) return;
  const { layouts } = useHomeLayoutStore.getState();
  if (!layouts[me]) return;
  const next = { ...layouts };
  delete next[me];
  useHomeLayoutStore.setState({ layouts: next });
}
