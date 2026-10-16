/**
 * Library: Channels view.
 *  - Desktop: the channel list on the left, the open channel (or the library
 *    home: Continue + channel tiles) on the right; the player bar sits along
 *    the bottom of the app (src/modules/library/player).
 *  - Phone: /library is the library home, /library/<channel> the channel.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Library as LibraryIcon, Plus, Search, Upload } from "lucide-react";
import { EmptyState, PageHeader, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useContinueLearning,
  useLibraryAccess,
  useLibraryChannels,
  useMyLibraryProgress,
  type ChannelView,
} from "@/data";
import { ChannelDialog } from "./ChannelDialog";
import { ChannelScreen } from "./ChannelScreen";
import { ItemDialog } from "./ItemDialog";
import { useOpenItem } from "./links";
import {
  ChannelRow,
  ChannelTile,
  ContinueCard,
  GroupLabel,
  LibraryTabs,
  lessonTotals,
  uplineLabel,
} from "./parts";

/** Group channels for display: the team's, each upline's, your own. */
function groupChannels(
  views: ChannelView[],
): { key: string; label: string | null; views: ChannelView[] }[] {
  const out: { key: string; label: string | null; views: ChannelView[] }[] = [];
  const team = views.filter((v) => v.group === "team");
  if (team.length) out.push({ key: "team", label: "Your team's channels", views: team });
  const byOwner = new Map<string, ChannelView[]>();
  for (const v of views.filter((x) => x.group === "upline")) {
    const arr = byOwner.get(v.channel.createdBy) ?? [];
    arr.push(v);
    byOwner.set(v.channel.createdBy, arr);
  }
  for (const [owner, list] of byOwner)
    out.push({ key: `up-${owner}`, label: uplineLabel(list[0].ownerName), views: list });
  const mine = views.filter((v) => v.group === "mine");
  if (mine.length) out.push({ key: "mine", label: "For your downline", views: mine });
  return out;
}

/** /library and /library/$channelId. */
export function LibraryPage({
  channelId,
  edit,
  add,
}: {
  channelId?: string;
  edit?: boolean;
  add?: "upload" | "link";
}) {
  const desktop = useIsDesktop();
  if (!desktop)
    return channelId ? (
      <ChannelScreen channelId={channelId} edit={!!edit} add={add} />
    ) : (
      <LibraryHome />
    );
  return (
    <div className="flex min-h-0 flex-1">
      <ChannelListAside activeId={channelId} />
      <div className="min-w-0 flex-1 overflow-y-auto">
        {channelId ? (
          <ChannelScreen channelId={channelId} edit={!!edit} add={add} />
        ) : (
          <LibraryHome />
        )}
      </div>
    </div>
  );
}

function ChannelListAside({ activeId }: { activeId?: string }) {
  const views = useLibraryChannels();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const groups = useMemo(() => groupChannels(views), [views]);
  return (
    <aside
      className="flex w-[272px] shrink-0 flex-col border-r border-line bg-surface"
      aria-label="Channels"
    >
      <div className="px-4 pt-[18px] pb-2">
        <Link to="/library" className="text-[17px] font-extrabold hover:underline">
          Library
        </Link>
      </div>
      <form
        className="relative px-3 pb-1"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: "/library/talks", search: q.trim() ? { q: q.trim() } : {} });
        }}
      >
        <Search
          className="pointer-events-none absolute top-1/2 left-6 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search lessons"
          aria-label="Search lessons"
          className="h-9 bg-surface-2 pl-9"
        />
      </form>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Library channels">
        {groups.map((g) => (
          <div key={g.key}>
            {g.label && <GroupLabel>{g.label}</GroupLabel>}
            <div className="grid gap-0.5">
              {g.views.map((v) => (
                <ChannelRow key={v.channel.id} view={v} active={v.channel.id === activeId} />
              ))}
            </div>
          </div>
        ))}
        {!groups.length && (
          <p className="px-2 py-6 text-[12.5px] text-muted-foreground">No channels yet.</p>
        )}
      </nav>
    </aside>
  );
}

/** Header actions: New channel / Add a talk, for people who may create. */
export function LibraryActions({ talk }: { talk?: boolean }) {
  const { canCreate } = useLibraryAccess();
  const [channelOpen, setChannelOpen] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  if (!canCreate) return null;
  return (
    <>
      {talk ? (
        <Button onClick={() => setItemOpen(true)}>
          <Upload /> Add a talk
        </Button>
      ) : (
        <Button variant="soft" onClick={() => setChannelOpen(true)}>
          <Plus /> New channel
        </Button>
      )}
      <ChannelDialog open={channelOpen} onOpenChange={setChannelOpen} />
      <ItemDialog open={itemOpen} onOpenChange={setItemOpen} />
    </>
  );
}

function LibraryHome() {
  const desktop = useIsDesktop();
  const views = useLibraryChannels();
  const cont = useContinueLearning();
  const open = useOpenItem();
  const groups = useMemo(() => groupChannels(views), [views]);
  const navigate = useNavigate();
  const progress = useMyLibraryProgress();
  const { done, total } = lessonTotals(views, progress);

  return (
    <div className="mx-auto grid w-full max-w-5xl content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader
        title="Library"
        subtitle={
          views.length
            ? `${views.length} ${views.length === 1 ? "channel" : "channels"} · ${done} of ${total} lessons done`
            : "Talks, videos and documents from your team"
        }
        actions={
          <>
            {!desktop && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Search talks"
                onClick={() => void navigate({ to: "/library/talks" })}
              >
                <Search />
              </Button>
            )}
            <LibraryActions />
          </>
        }
      />
      <LibraryTabs current="channels" />
      {cont && (
        <ContinueCard
          view={cont}
          className={desktop ? "max-w-xl" : undefined}
          onPlay={() => open(cont.item, cont.channel?.id)}
        />
      )}
      {groups.map((g) => (
        <Section key={g.key} label={g.label}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3">
            {g.views.map((v) => (
              <ChannelTile key={v.channel.id} view={v} />
            ))}
          </div>
        </Section>
      ))}
      {!groups.length && (
        <EmptyState
          icon={<LibraryIcon />}
          title="No channels yet"
          body="Leaders build channels of talks, videos and documents in order. Browse everything in All talks."
          action={
            <Button asChild variant="soft">
              <Link to="/library/talks">Open All talks</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function Section({ label, children }: { label: string | null; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      {label && (
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
          {label}
        </h2>
      )}
      {children}
    </section>
  );
}
