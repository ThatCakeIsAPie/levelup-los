import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
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
import { rosterIdOf, useTreeStore } from "@/components/mindmap/useTreeStore";
import { UploadButton } from "@/components/import/UploadButton";
import { useSpreadsheetUpload } from "@/components/import/useSpreadsheetUpload";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { autoMap } from "@/lib/parseSpreadsheet";
import { cn } from "@/lib/utils";
import { rosterToRows } from "@/lib/demoData";
import {
  effectiveBizClass,
  teamStructure,
  useCurrentUser,
  useMe,
  useMonthPvById,
  useVisibleTeam,
  type CrmPerson,
  type TeamStructure,
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

/**
 * "Include prospects" on the map, remembered per viewer on this device.
 * Off by default: the team is registered people, like Home.
 */
function useIncludeProspects(personId: string): [boolean, (on: boolean) => void] {
  const key = `levelup.mindmap.prospects.${personId}`;
  const read = () => {
    try {
      return localStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  };
  const [state, setState] = useState(() => ({ key, on: read() }));
  // Another person signing in on this device gets their own choice.
  const on = state.key === key ? state.on : read();
  const set = (next: boolean) => {
    setState({ key, on: next });
    try {
      if (next) localStorage.setItem(key, "1");
      else localStorage.removeItem(key);
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
  };
  return [on, set];
}

function MindmapPage() {
  const user = useCurrentUser();
  const me = useMe();
  const visibleTeam = useVisibleTeam();
  const [includeProspects, setIncludeProspects] = useIncludeProspects(user.personId);
  // Without prospects the map draws registered people only. A prospect with
  // someone under them stays, so nobody below them drops off the map.
  const team = useMemo(() => {
    if (includeProspects) return visibleTeam;
    const sponsors = new Set(visibleTeam.map((p) => p.sponsorId));
    return visibleTeam.filter(
      (p) => p.bizClass !== "prospect" || p.id === user.personId || sponsors.has(p.id),
    );
  }, [visibleTeam, includeProspects, user.personId]);
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
        people={visibleTeam}
        includeProspects={includeProspects}
        onIncludeProspects={setIncludeProspects}
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

function findNodeById(node: TreeNode, id: string): TreeNode | null {
  if (node.person.id === id) return node;
  for (const c of node.children) {
    const hit = findNodeById(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Frontline/total for a map node. Roster maps count like the growth path
 * (registered people, `teamStructure`); an uploaded sheet has no stages, so
 * it counts everyone in it.
 */
function structureOf(node: TreeNode, people: CrmPerson[], includeProspects: boolean) {
  const id = rosterIdOf(node.person);
  if (id) return teamStructure(people, id, { includeProspects });
  return {
    frontline: node.children.length,
    total: Math.max(0, (node.person.memberCount ?? 1) - 1),
  };
}

/** "4/27": 4 personally sponsored, 27 in the whole group, with the meaning in a tooltip. */
function StructureBadge({
  s,
  whose,
  mode,
}: {
  s: TeamStructure;
  /** "you" or a first name, for the explanation. */
  whose: string;
  mode: "registered" | "prospects" | "sheet";
}) {
  const ratio = `${s.frontline}/${s.total}`;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  const notMe = whose === "you" ? "not counting you" : `not counting ${whose}`;
  const explain =
    mode === "registered"
      ? `${s.frontline} personally sponsored · ${people(s.total)} registered in the whole group, ${notMe}. The same count as the 3/10 and 6/25 milestones.`
      : mode === "prospects"
        ? `${s.frontline} on the frontline · ${people(s.total)} in the whole group, prospects included, ${notMe}. Milestones count registered people only.`
        : `${s.frontline} on the frontline · ${people(s.total)} in the whole group, ${notMe}, from the spreadsheet.`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${ratio}: ${explain}`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-bold tabular-nums focus-visible:outline-2 focus-visible:outline-ring",
            mode === "prospects"
              ? "bg-stage-prospect-soft text-stage-prospect-ink"
              : "bg-primary-soft text-primary-ink",
          )}
        >
          {ratio}
          {mode === "prospects" && <span className="font-semibold">with prospects</span>}
        </button>
      </TooltipTrigger>
      <TooltipContent aria-hidden="true" className="max-w-64">
        {explain}
      </TooltipContent>
    </Tooltip>
  );
}

function Toolbar({
  root,
  rootCount,
  uploaded,
  isCandidate,
  onUseRoster,
  people,
  includeProspects,
  onIncludeProspects,
}: {
  root: TreeNode | undefined;
  rootCount: number;
  uploaded: boolean;
  isCandidate: boolean;
  onUseRoster: () => void;
  /** Everyone on the viewer's team (for the structure numbers). */
  people: CrmPerson[];
  includeProspects: boolean;
  onIncludeProspects: (on: boolean) => void;
}) {
  const user = useCurrentUser();
  const expandAll = useTreeStore((s) => s.expandAll);
  const collapseAll = useTreeStore((s) => s.collapseAll);
  const showAllCustomers = useTreeStore((s) => s.showAllCustomers);
  const setShowAllCustomers = useTreeStore((s) => s.setShowAllCustomers);
  const selectedId = useTreeStore((s) => s.selectedId);
  const select = useTreeStore((s) => s.select);
  const upload = useSpreadsheetUpload();
  const switchId = useId();
  const prospectsId = useId();

  // The structure follows the card you tapped; otherwise the whole map.
  const focus = (root && selectedId && findNodeById(root, selectedId)) || root;
  const focused = !!focus && focus !== root;
  const isMe = root?.person.name === user.name;
  const structure = useMemo(
    () => (focus ? structureOf(focus, people, includeProspects && !uploaded) : null),
    [focus, people, includeProspects, uploaded],
  );
  const whose =
    focus && !(focus === root && isMe) ? focus.person.name.split(/[ ,]+/)[0] || "them" : "you";

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-app px-4 py-2.5 lg:px-[26px] lg:py-3">
      {upload.input}
      <div className="min-w-0 flex-1">
        <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">Mindmap</h1>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {isCandidate ? (
            <span className="truncate">Just you for now</span>
          ) : focus && structure ? (
            <>
              <PersonAvatar name={focus.person.name} size="sm" className="hidden size-5 sm:grid" />
              <span className="truncate">
                {focused ? focus.person.name : isMe ? "Your team" : `${focus.person.name}'s team`}
                {!focused &&
                  uploaded &&
                  (rootCount > 1 ? ` · tree 1 of ${rootCount}` : " · from spreadsheet")}
              </span>
              <StructureBadge
                s={structure}
                whose={whose}
                mode={uploaded ? "sheet" : includeProspects ? "prospects" : "registered"}
              />
              {focused && (
                <button
                  type="button"
                  onClick={() => select(null)}
                  className="shrink-0 rounded font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {isMe ? "Back to you" : "Whole map"}
                </button>
              )}
            </>
          ) : uploaded ? (
            <span className="truncate">From spreadsheet</span>
          ) : null}
          {uploaded && !focused && (
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
          <div className="flex items-center gap-4 max-sm:order-last max-sm:w-full">
            {!uploaded && (
              <div className="flex items-center gap-2">
                <Switch
                  id={prospectsId}
                  checked={includeProspects}
                  onCheckedChange={onIncludeProspects}
                />
                <label htmlFor={prospectsId} className="cursor-pointer text-[12.5px] font-semibold">
                  Include prospects
                </label>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                id={switchId}
                checked={showAllCustomers}
                onCheckedChange={setShowAllCustomers}
              />
              <label htmlFor={switchId} className="cursor-pointer text-[12.5px] font-semibold">
                Show customers
              </label>
            </div>
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
