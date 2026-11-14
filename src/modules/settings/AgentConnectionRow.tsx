import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, TriangleAlert } from "lucide-react";
import { Sensitive, ToneChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchActivity, type AgentConnection } from "@/data/agents/api";
import {
  ACCESS_LABEL,
  dateTime,
  entryProspectName,
  isRefusal,
  relativeTime,
  shortDate,
  toolLabel,
  type AuditEntry,
} from "@/data/agents/rules";

/**
 * One connected agent: its label (the agent chose it, so it is untrusted and only ever rendered as
 * text), access, when it connected and was last used, Disconnect; and, expanded, its recent activity.
 */
export function AgentConnectionRow({
  connection: c,
  onDisconnect,
}: {
  connection: AgentConnection;
  onDisconnect: (button: HTMLElement) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = `agent-activity-${c.id}`;
  return (
    <li className="border-t border-line py-2.5 first:border-t-0 first:pt-0.5">
      <div className="flex items-start gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panel : undefined}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
            aria-hidden="true"
          />
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-[13px] font-semibold" title={c.label}>
                {c.label}
              </span>
              <ToneChip tone={c.access === "write" ? "info" : "neutral"}>
                {ACCESS_LABEL[c.access]}
              </ToneChip>
            </span>
            <span className="text-xs text-muted-foreground">
              Connected {shortDate(c.createdAt)} ·{" "}
              {c.lastUsedAt ? `Last used ${relativeTime(c.lastUsedAt)}` : "Never used"}
            </span>
          </span>
        </button>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={(e) => onDisconnect(e.currentTarget)}
        >
          Disconnect
        </Button>
      </div>
      {open && <AgentActivity id={panel} connectionId={c.id} />}
    </li>
  );
}

/** The 20 newest calls of one agent, loaded when the row is expanded. */
function AgentActivity({ id, connectionId }: { id: string; connectionId: string }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    fetchActivity(connectionId).then(
      (rows) => live && setEntries(rows),
      (e) => {
        if (!live) return;
        toast.error(e instanceof Error ? e.message : String(e));
        setEntries([]);
      },
    );
    return () => {
      live = false;
    };
  }, [connectionId]);
  if (!entries?.length) return <div id={id} aria-busy={!entries} />;
  return (
    <ul id={id} aria-label="Activity" className="mt-2 ml-[22px] grid gap-2">
      {entries.map((e) => {
        const name = entryProspectName(e);
        const refused = isRefusal(e.result);
        return (
          <li key={e.id} className="grid min-w-0 gap-0.5 rounded-lg bg-surface-2 px-2.5 py-2">
            <div className="flex min-w-0 items-baseline justify-between gap-2">
              <p className="min-w-0 truncate text-[12.5px] font-semibold">
                {toolLabel(e.tool)}
                {name && (
                  <>
                    {" · "}
                    <Sensitive kind="name" className="font-normal">
                      {name}
                    </Sensitive>
                  </>
                )}
              </p>
              <time dateTime={e.at} className="shrink-0 text-[11.5px] text-muted-foreground">
                {dateTime(e.at)}
              </time>
            </div>
            <p
              className={cn(
                "flex items-start gap-1 break-words text-xs",
                refused ? "font-semibold text-bad" : "text-muted-foreground",
              )}
              title={e.result}
            >
              {refused && <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />}
              <span className="min-w-0 line-clamp-2">{e.result}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
