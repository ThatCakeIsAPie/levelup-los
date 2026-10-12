import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { MindmapCanvas } from "@/components/mindmap/MindmapCanvas";
import { UploadButton } from "@/components/import/UploadButton";
import { useTreeStore } from "@/components/mindmap/useTreeStore";
import { autoMap } from "@/lib/parseSpreadsheet";
import { rosterToRows } from "@/lib/demoData";
import { usePeopleStore } from "@/stores/peopleStore";
import { useSession } from "@/lib/db";
import type { TreeNode } from "@/components/mindmap/types";

function findByName(nodes: TreeNode[], name: string): TreeNode | null {
  for (const n of nodes) {
    if (n.person.name === name) return n;
    const hit = findByName(n.children, name);
    if (hit) return hit;
  }
  return null;
}
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/mindmap")({
  head: () => ({
    meta: [
      { title: "LOS Mindmap — Direct Sales Team Manager" },
      { name: "description", content: "Visualize your downline, expand branches, and manage your direct sales team from a single mindmap." },
      { property: "og:title", content: "LOS Mindmap — Direct Sales Team Manager" },
      { property: "og:description", content: "Visualize your downline and manage your team from a single mindmap." },
    ],
  }),
  component: MindmapPage,
});

function MindmapPage() {
  const roots = useTreeStore((s) => s.roots);
  const loadRows = useTreeStore((s) => s.loadRows);
  const expandAll = useTreeStore((s) => s.expandAll);
  const collapseAll = useTreeStore((s) => s.collapseAll);
  const showAllCustomers = useTreeStore((s) => s.showAllCustomers);
  const setShowAllCustomers = useTreeStore((s) => s.setShowAllCustomers);

  useEffect(() => {
    if (roots.length === 0) {
      const rows = rosterToRows(usePeopleStore.getState().people);
      if (rows.length) loadRows(rows, autoMap(Object.keys(rows[0])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const user = useSession();
  const root = user ? findByName(roots, user.name) ?? (user.role === "leader" ? roots[0] : undefined) : undefined;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold tracking-tight">LOS Mindmap</h1>
          {roots.length > 1 && (
            <span className="ml-2 text-xs text-muted-foreground">
              Showing root 1 of {roots.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={showAllCustomers} onCheckedChange={setShowAllCustomers} />
            Show customers
          </label>
          <button
            type="button"
            onClick={expandAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Collapse all
          </button>
          <UploadButton />
        </div>
      </header>
      <main className="relative flex-1 min-h-0">
        {root ? (
          <MindmapCanvas root={root} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Upload a spreadsheet to get started.
          </div>
        )}
      </main>
      <Toaster richColors position="bottom-right" />
    </div>
  );
}
