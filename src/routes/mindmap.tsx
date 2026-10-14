import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  FileSpreadsheet,
  MoreHorizontal,
  Network,
  Upload,
  UserSearch,
} from "lucide-react";
import { EmptyState, PersonAvatar } from "@/components/brand";
import { MindmapCanvas } from "@/components/mindmap/MindmapCanvas";
import { NodeCard } from "@/components/mindmap/NodeCard";
import { NODE_H, NODE_W } from "@/components/mindmap/layout";
import type { PositionedNode, TreeNode } from "@/components/mindmap/types";
import { useTreeStore } from "@/components/mindmap/useTreeStore";
import { UploadButton } from "@/components/import/UploadButton";
import { useSpreadsheetUpload } from "@/components/import/useSpreadsheetUpload";
import { LogButton } from "@/components/log/LogSheet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { autoMap } from "@/lib/parseSpreadsheet";
import { rosterToRows } from "@/lib/demoData";
import {
  effectiveBizClass,
  useCurrentUser,
  useMe,
  useMonthPvById,
  useVisibleTeam,
  type CrmPerson,
} from "@/data";

export const Route = createFileRoute("/mindmap")({
  head: () => ({
    meta: [
      { title: "Mindmap — LevelUp LOS" },
      {
        name: "description",
        content: "See your team as a tree, expand branches and add people from one map.",
      },
    ],
  }),
  component: MindmapPage,
});

function findByName(nodes: TreeNode[], name: string): TreeNode | null {
  for (const n of nodes) {
    if (n.person.name === name) return n;
    const hit = findByName(n.children, name);
    if (hit) return hit;
  }
  return null;
}

function MindmapPage() {
  const user = useCurrentUser();
  const me = useMe();
  const team = useVisibleTeam();
  const pvById = useMonthPvById();
  const roots = useTreeStore((s) => s.roots);
  const source = useTreeStore((s) => s.source);
  const sourceKey = useTreeStore((s) => s.sourceKey);
  const loadRows = useTreeStore((s) => s.loadRows);
  const isCandidate = user.role === "candidate";

  // The map is built from the people this user may see (their own downline).
  // Rebuild when that roster changes, unless this user uploaded a spreadsheet.
  const rosterKey = useMemo(
    () =>
      `${user.personId}#` +
      team.map((p) => `${p.id}>${p.sponsorId ?? ""}:${p.name}:${pvById.get(p.id) ?? 0}`).join("|"),
    [team, user.personId, pvById],
  );
  const loadRoster = useCallback(
    (keepExpanded: boolean) => {
      const rows = rosterToRows(team, (id) => pvById.get(id) ?? 0);
      if (!rows.length) return;
      loadRows(rows, autoMap(Object.keys(rows[0])), {
        source: "roster",
        key: rosterKey,
        keepExpanded,
      });
    },
    [team, pvById, rosterKey, loadRows],
  );
  useEffect(() => {
    if (source === "upload" && sourceKey === user.personId) return;
    if (source === "roster" && sourceKey === rosterKey) return;
    loadRoster(source === "roster" && !!sourceKey?.startsWith(`${user.personId}#`));
  }, [source, sourceKey, rosterKey, user.personId, loadRoster]);

  const root = useMemo(() => {
    const mine = findByName(roots, user.name);
    if (mine) return mine;
    return source === "upload" && user.role === "leader" ? roots[0] : undefined;
  }, [roots, source, user.name, user.role]);

  const uploaded = source === "upload";
  const ready = source !== null;

  return (
    // <main> is a flex column: take whatever is left below the apprentice notice.
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        root={root}
        rootCount={roots.length}
        uploaded={uploaded}
        isCandidate={isCandidate}
        onUseRoster={() => loadRoster(false)}
      />
      <div className="relative min-h-0 flex-1">
        {isCandidate ? (
          <SoloView root={root} me={me} />
        ) : root ? (
          <MindmapCanvas root={root} canAdd />
        ) : ready ? (
          <div className="grid h-full place-items-center overflow-y-auto px-4 py-8">
            <EmptyState
              className="bg-surface"
              icon={uploaded ? <FileSpreadsheet /> : <UserSearch />}
              title={
                uploaded ? "You're not in this spreadsheet" : "We couldn't find you on the map"
              }
              body={
                uploaded
                  ? `The map is drawn from your point of view, and ${user.name} isn't in the uploaded file.`
                  : "Your team will show here once you're on the roster."
              }
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="soft" size="sm" onClick={() => loadRoster(false)}>
                    <Network /> Back to my team
                  </Button>
                  <UploadButton label="Upload another file" />
                </div>
              }
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Toolbar({
  root,
  rootCount,
  uploaded,
  isCandidate,
  onUseRoster,
}: {
  root: TreeNode | undefined;
  rootCount: number;
  uploaded: boolean;
  isCandidate: boolean;
  onUseRoster: () => void;
}) {
  const user = useCurrentUser();
  const expandAll = useTreeStore((s) => s.expandAll);
  const collapseAll = useTreeStore((s) => s.collapseAll);
  const showAllCustomers = useTreeStore((s) => s.showAllCustomers);
  const setShowAllCustomers = useTreeStore((s) => s.setShowAllCustomers);
  const upload = useSpreadsheetUpload();
  const switchId = useId();

  const members = root?.person.memberCount ?? 1;
  const isMe = root?.person.name === user.name;
  const people = `${members} ${members === 1 ? "person" : "people"}`;

  return (
    <header className="flex shrink-0 items-center gap-x-3 gap-y-2 border-b border-line bg-app px-4 py-2.5 lg:px-[26px] lg:py-3">
      {upload.input}
      <div className="min-w-0 flex-1">
        <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">Mindmap</h1>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {isCandidate ? (
            <span className="truncate">Just you for now</span>
          ) : root ? (
            <>
              <PersonAvatar name={root.person.name} size="sm" className="hidden size-5 sm:grid" />
              <span className="truncate">
                {isMe ? "Your team" : `${root.person.name}'s team`} ·{" "}
                <span className="tabular-nums">{people}</span>
                {uploaded && (rootCount > 1 ? ` · tree 1 of ${rootCount}` : " · from spreadsheet")}
              </span>
            </>
          ) : uploaded ? (
            <span className="truncate">From spreadsheet</span>
          ) : null}
          {uploaded && (
            <button
              type="button"
              onClick={onUseRoster}
              className="shrink-0 rounded font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              Use roster
            </button>
          )}
        </div>
      </div>

      {!isCandidate && (
        <>
          <div className="flex items-center gap-2">
            <Switch
              id={switchId}
              checked={showAllCustomers}
              onCheckedChange={setShowAllCustomers}
            />
            <label htmlFor={switchId} className="cursor-pointer text-[12.5px] font-semibold">
              <span className="sm:hidden">Customers</span>
              <span className="hidden sm:inline">Show customers</span>
            </label>
          </div>

          <div className="hidden items-center gap-2 xl:flex">
            <Button variant="outline" size="sm" onClick={expandAll}>
              <ChevronsUpDown aria-hidden="true" /> Expand all
            </Button>
            <Button variant="outline" size="sm" onClick={collapseAll}>
              <ChevronsDownUp aria-hidden="true" /> Collapse all
            </Button>
            <Button variant="outline" size="sm" onClick={upload.open}>
              <Upload aria-hidden="true" /> Upload spreadsheet
            </Button>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0 xl:hidden"
                aria-label="More map actions"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={expandAll}>
                <ChevronsUpDown /> Expand all
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={collapseAll}>
                <ChevronsDownUp /> Collapse all
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={upload.open}>
                <Upload /> Upload spreadsheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
      <LogButton className="hidden lg:inline-flex" />
    </header>
  );
}

/** Candidates only see themselves: one card and a short explanation. */
function SoloView({ root, me }: { root: TreeNode | undefined; me: CrmPerson | undefined }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const node: PositionedNode | null = useMemo(() => {
    const person = root?.person ?? {
      id: user.personId,
      uid: user.personId,
      name: user.name,
      sponsorId: null,
      ppv: 0,
      gpv: 0,
      memberCount: 1,
      raw: {},
    };
    return {
      id: person.id,
      person,
      x: 0,
      y: 0,
      depth: 0,
      hasChildren: false,
      expanded: false,
      parentId: null,
      childMode: "none",
    };
  }, [root, user.personId, user.name]);
  const noop = useCallback(() => {}, []);
  const onAction = useCallback(
    (_n: PositionedNode, action: string) =>
      void navigate({
        to: "/people/$id",
        params: { id: user.personId },
        hash: action === "edit" ? "edit" : undefined,
      }),
    [navigate, user.personId],
  );

  return (
    <div
      className="grid h-full place-items-center overflow-y-auto bg-app px-4 py-8"
      style={{
        backgroundImage: "radial-gradient(circle, var(--line) 1.2px, transparent 1.3px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="grid max-w-sm justify-items-center gap-5 text-center">
        <div className="relative" style={{ width: NODE_W, height: NODE_H }}>
          <NodeCard
            node={node}
            stage={me ? effectiveBizClass(me) : "prospect"}
            isViewer
            selected={false}
            customers={[]}
            customerCount={0}
            customersVisible={false}
            canToggleCustomers={false}
            canAdd={false}
            onToggle={noop}
            onSelect={noop}
            onHover={noop}
            onAction={onAction}
            onToggleCustomers={noop}
            onOpenCustomers={noop}
          />
        </div>
        <div className="grid gap-1 rounded-card border border-line bg-surface px-4 py-3">
          <h2 className="text-[14px] font-bold">Your map starts with you</h2>
          <p className="text-[13px] text-muted-foreground">
            While you're a candidate, the map shows just your own card. Once you start your business
            as an apprentice, the people you sponsor will appear here under you.
          </p>
        </div>
      </div>
    </div>
  );
}
