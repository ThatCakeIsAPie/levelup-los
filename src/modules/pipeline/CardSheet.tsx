import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, ClockAlert, Flame, MoveRight, UserMinus } from "lucide-react";
import { PersonAvatar, ToneChip, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toastWithUndo } from "@/components/log/quickLog";
import { cn } from "@/lib/utils";
import {
  MILESTONE_LABEL,
  dropPipelineCard,
  updatePipelineCard,
  type BoardCard,
  type PipelineColumn,
} from "@/data";
import { MoveMenu } from "./moveCard";
import { ageLong } from "./format";

/** A card's details: where it is, move it, next step, hot, where you met, take it off the board. */
export function CardSheet({
  card,
  columns,
  open,
  onOpenChange,
  onMove,
}: {
  card: BoardCard | null;
  columns: PipelineColumn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (personId: string, name: string, to: string) => void;
}) {
  const desktop = useIsDesktop();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={desktop ? "right" : "bottom"}
        className={cn(
          "flex flex-col gap-0 p-0",
          desktop ? "w-full sm:max-w-md" : "max-h-[92dvh] rounded-t-card pb-safe",
        )}
      >
        {card && (
          <CardDetails
            key={card.personId}
            card={card}
            columns={columns}
            onMove={onMove}
            onClose={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CardDetails({
  card,
  columns,
  onMove,
  onClose,
}: {
  card: BoardCard;
  columns: PipelineColumn[];
  onMove: (personId: string, name: string, to: string) => void;
  onClose: () => void;
}) {
  const col = columns.find((c) => c.id === card.column);
  const [next, setNext] = useState(card.nextStep ?? "");
  const [date, setDate] = useState(card.nextStepDate ?? "");
  const [source, setSource] = useState(card.source ?? "");
  const dirty =
    next !== (card.nextStep ?? "") ||
    date !== (card.nextStepDate ?? "") ||
    source !== (card.source ?? "");

  const save = () => {
    updatePipelineCard(card.personId, {
      nextStep: next.trim() || null,
      nextStepDate: date || null,
      source: source.trim() || null,
    });
    onClose();
  };

  return (
    <>
      <SheetHeader className="border-b border-line px-5 pb-3 pt-4 text-left">
        <div className="flex items-center gap-3">
          <PersonAvatar name={card.name} stage="prospect" size="lg" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-base font-extrabold">{card.name}</SheetTitle>
            <SheetDescription className="text-[12.5px]">
              {card.ownerName ? `${card.ownerName}'s prospect · ` : ""}
              {col ? `${MILESTONE_LABEL[col.band]} band` : ""}
            </SheetDescription>
          </div>
        </div>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 pb-5 pt-4">
        <div className="grid gap-2 rounded-card bg-surface-2 px-3.5 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-2">
            <b>{col?.label ?? "Contact made"}</b>
            {card.hot && (
              <ToneChip tone="bad" icon={Flame}>
                Hot
              </ToneChip>
            )}
            {card.stale && (
              <ToneChip tone="warn" icon={ClockAlert}>
                No movement in {ageLong(card.days)}
              </ToneChip>
            )}
          </div>
          <span className="text-[12px] text-muted-foreground">
            {card.days === 0 ? "Moved here today" : `Here for ${ageLong(card.days)}`}
            {card.elsewhere &&
              ` · at ${card.elsewhere.ownerName}'s step "${card.elsewhere.label}" on their board`}
          </span>
          <MoveMenu
            columns={columns}
            current={card.column}
            align="start"
            onMove={(to) => {
              onMove(card.personId, card.name, to);
              onClose();
            }}
          >
            <Button variant="soft" size="sm" className="justify-self-start">
              <MoveRight /> Move to…
            </Button>
          </MoveMenu>
        </div>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_9.5rem] gap-2.5">
            <div className="grid gap-1.5">
              <Label htmlFor="card-next" className="text-[12px] text-muted-foreground">
                Next step
              </Label>
              <Input
                id="card-next"
                value={next}
                maxLength={40}
                placeholder="e.g. MG1, Call, Info 2"
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="card-date" className="text-[12px] text-muted-foreground">
                When
              </Label>
              <Input
                id="card-date"
                type="date"
                className="min-w-0"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="card-source" className="text-[12px] text-muted-foreground">
              Where you met
            </Label>
            <Input
              id="card-source"
              value={source}
              maxLength={30}
              placeholder="e.g. Gym, Referral"
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <span className="grid">
              <span className="text-[13px] font-semibold">Hot prospect</span>
              <span className="text-[11.5px] text-muted-foreground">Shows first in the column</span>
            </span>
            <Switch
              checked={card.hot}
              onCheckedChange={(v) => updatePipelineCard(card.personId, { hot: v })}
              aria-label="Hot prospect"
            />
          </label>
          <Button type="submit" disabled={!dirty}>
            Save
          </Button>
        </form>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button asChild variant="outline" size="sm">
            <Link to="/people/$id" params={{ id: card.personId }}>
              <ArrowUpRight /> Open profile
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const undo = dropPipelineCard(card.personId);
              if (undo)
                toastWithUndo(`${card.name} taken off the board`, undo, {
                  description: "They stay a prospect on your People list.",
                  undoneMessage: "Back on the board",
                });
              onClose();
            }}
          >
            <UserMinus /> Take off the board
          </Button>
        </div>
      </div>
    </>
  );
}
