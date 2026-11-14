import { useEffect, useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CONNECTOR_URL,
  createAgentPairing,
  fetchConnectionSince,
  type AgentConnection,
  type Pairing,
} from "@/data/agents/api";
import { pairingText } from "@/data/agents/text";
import { watchFor } from "@/data/agents/watch";

/**
 * The window that gives the person the text for their agent. It exists only while `pairing` is
 * set: closing it drops the text (the code is simply left to expire). Opened by the card after
 * `create_agent_pairing('write')` succeeded.
 */
export function AddAgentDialog({
  pairing,
  onClose,
  onConnected,
  returnFocus,
}: {
  pairing: Pairing | null;
  onClose: () => void;
  onConnected: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Dialog open={!!pairing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        {pairing && <AddAgentBody first={pairing} onClose={onClose} onConnected={onConnected} />}
      </DialogContent>
    </Dialog>
  );
}

function AddAgentBody({
  first,
  onClose,
  onConnected,
}: {
  first: Pairing;
  onClose: () => void;
  onConnected: () => void;
}) {
  const [pairing, setPairing] = useState(first);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [connected, setConnected] = useState<AgentConnection | null>(null);
  const requests = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The database's own time of the first code: a connection made after it is a new one, whatever
  // this browser's clock says.
  const since = first.createdAt;

  // Look for the agent that connects, every 3 seconds, until it does, the window closes (this
  // component unmounts) or 10 minutes have passed.
  useEffect(() => {
    if (connected) return;
    return watchFor({
      check: () => fetchConnectionSince(since),
      onFound: (c) => {
        setConnected(c);
        onConnected();
      },
    });
  }, [connected, since, onConnected]);

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  async function setReadOnly(on: boolean) {
    const n = ++requests.current;
    setBusy(true);
    try {
      const next = await createAgentPairing(on ? "read" : "write");
      if (n === requests.current) setPairing(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === requests.current) setBusy(false);
    }
  }

  const text = pairingText({
    connector: CONNECTOR_URL,
    code: pairing.code,
    access: pairing.access,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Your browser blocked the clipboard.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Add agent</DialogTitle>
      </DialogHeader>
      {connected ? (
        <>
          <div className="flex min-w-0 items-center gap-2 rounded-[10px] bg-good-soft px-3 py-2.5 text-good">
            <Check className="size-4 shrink-0" aria-hidden="true" />
            <span
              className="min-w-0 flex-1 truncate text-[13px] font-semibold"
              title={connected.label}
            >
              {connected.label}
            </span>
            <span className="shrink-0 text-[13px] font-semibold" role="status">
              Connected
            </span>
          </div>
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Done
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Switch
                id="agent-read-only"
                checked={pairing.access === "read"}
                disabled={busy}
                onCheckedChange={(on) => void setReadOnly(on)}
              />
              <Label htmlFor="agent-read-only" className="text-[13px] font-semibold">
                Read only
              </Label>
            </div>
            <Button type="button" onClick={() => void copy()}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <pre
            data-agent-text=""
            className="min-w-0 select-all whitespace-pre-wrap break-words rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground"
          >
            {text}
          </pre>
        </>
      )}
    </>
  );
}
