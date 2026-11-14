import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DATA_SOURCE } from "@/lib/config";
import { useCurrentUser, useFeatureSwitches } from "@/data";
import {
  createAgentPairing,
  fetchAgentAccess,
  fetchConnections,
  revokeAgentConnection,
  type AgentConnection,
  type Pairing,
} from "@/data/agents/api";
import { agentCardVisible, type AgentAccessInfo } from "@/data/agents/rules";
import { AddAgentDialog } from "./AddAgentDialog";
import { AgentConnectionRow } from "./AgentConnectionRow";

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * May this person use the feature (`my_agent_access()`)? Null until known, and after a failed call:
 * the card stays hidden. Asked again when the team's switch changes under the person.
 */
function useAgentAccess(): AgentAccessInfo | null {
  const user = useCurrentUser();
  const switchOn = useFeatureSwitches().agents;
  const [access, setAccess] = useState<AgentAccessInfo | null>(null);
  useEffect(() => {
    if (DATA_SOURCE !== "supabase") return;
    let live = true;
    fetchAgentAccess().then(
      (a) => live && setAccess(a),
      (e) => {
        console.warn("[agents]", e);
        if (live) setAccess(null);
      },
    );
    return () => {
      live = false;
    };
  }, [user.personId, user.admin, switchOn]);
  return access;
}

/**
 * Settings > AI agents: the person's own agents (connect one, see its activity, disconnect it).
 * Shown only with the hosted data source and only when the database allows this person
 * (`agentCardVisible`); otherwise nothing at all.
 */
export function AgentsCard() {
  const access = useAgentAccess();
  if (!agentCardVisible(DATA_SOURCE, access)) return null;
  return <AgentsCardBody />;
}

function AgentsCardBody() {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [disconnecting, setDisconnecting] = useState<AgentConnection | null>(null);
  const [revoking, setRevoking] = useState(false);
  const adding = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  /** The Disconnect button that opened the confirm dialog: where focus goes back to on Cancel. */
  const opener = useRef<HTMLElement | null>(null);

  const reload = useCallback(() => {
    fetchConnections().then(setConnections, (e) => console.warn("[agents]", e));
  }, []);
  useEffect(reload, [reload]);

  async function add() {
    if (adding.current) return;
    adding.current = true;
    try {
      setPairing(await createAgentPairing("write"));
    } catch (e) {
      toast.error(message(e));
    } finally {
      adding.current = false;
    }
  }

  async function disconnect() {
    if (!disconnecting || revoking) return;
    setRevoking(true);
    try {
      await revokeAgentConnection(disconnecting.id);
      const id = disconnecting.id;
      setConnections((rows) => rows.filter((r) => r.id !== id));
      setDisconnecting(null);
    } catch (e) {
      toast.error(message(e));
      setDisconnecting(null);
    } finally {
      setRevoking(false);
    }
  }

  return (
    <SectionCard title="AI agents">
      <div>
        <Button ref={addButton} onClick={add}>
          <Plus aria-hidden="true" /> Add agent
        </Button>
      </div>
      {connections.length > 0 && (
        <ul className="grid" aria-label="Connected agents">
          {connections.map((c) => (
            <AgentConnectionRow
              key={c.id}
              connection={c}
              onDisconnect={(button) => {
                opener.current = button;
                setDisconnecting(c);
              }}
            />
          ))}
        </ul>
      )}
      <AddAgentDialog
        pairing={pairing}
        onClose={() => setPairing(null)}
        onConnected={reload}
        returnFocus={addButton}
      />
      <AlertDialog open={!!disconnecting} onOpenChange={(o) => !o && setDisconnecting(null)}>
        <AlertDialogContent
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            // Radix gives focus back to an AlertDialogTrigger, and this dialog has none.
            e.preventDefault();
            const back = opener.current?.isConnected ? opener.current : addButton.current;
            back?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Disconnect {disconnecting?.label}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={(e) => {
                e.preventDefault();
                void disconnect();
              }}
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
