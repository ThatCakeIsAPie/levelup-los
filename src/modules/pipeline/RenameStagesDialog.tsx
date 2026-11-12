import { useState } from "react";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_STAGE_NAME,
  saveStageNames,
  stageNameErrors,
  stageSourceHint,
  useStageNameEditor,
  type StageNameDraft,
  type StagePipeline,
} from "@/data";

/**
 * Rename stages: the four major stages of a pipeline, called whatever you
 * like for you and your downline. Leave a field empty to use the name you
 * inherit (your nearest upline's, else the built-in one). Their meaning,
 * order and behaviour don't change. People below you see your names unless
 * they set their own.
 */
export function RenameStagesDialog({
  open,
  onOpenChange,
  pipeline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: StagePipeline;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {pipeline === "customer" ? "Rename customer stages" : "Rename stages"}
          </DialogTitle>
          <DialogDescription>
            Call the four stages what you like; they keep their order and what they do. Leave a
            field empty to keep the name shown in it. People below you see your names unless they
            set their own.
          </DialogDescription>
        </DialogHeader>
        {open && <RenameForm pipeline={pipeline} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({ pipeline, onDone }: { pipeline: StagePipeline; onDone: () => void }) {
  const { rows, reserved } = useStageNameEditor(pipeline);
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.own])) as StageNameDraft;
  const [draft, setDraft] = useState<StageNameDraft>(saved);
  const errors = stageNameErrors(
    pipeline,
    draft,
    Object.fromEntries(rows.map((r) => [r.key, r.inherited])),
    reserved,
  );
  const changed = rows.some((r) => (draft[r.key] ?? "").trim() !== r.own);
  const anySet = rows.some((r) => (draft[r.key] ?? "").trim() !== "");
  const failed = Object.keys(errors).length > 0;

  const save = () => {
    if (failed || !changed) return;
    const r = saveStageNames(pipeline, draft);
    if (!r.ok) return;
    toast.success("Stage names saved");
    onDone();
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <ol className="grid gap-3.5">
        {rows.map((row, i) => {
          const value = draft[row.key] ?? "";
          const error = errors[row.key];
          const hint = stageSourceHint(row.inherited);
          return (
            <li key={row.key} className="grid gap-1.5">
              <Label htmlFor={`rs-${row.key}`} className="text-[13px]">
                Stage {i + 1}
              </Label>
              <div className="flex items-center gap-1.5">
                <Input
                  id={`rs-${row.key}`}
                  value={value}
                  maxLength={MAX_STAGE_NAME}
                  placeholder={row.inherited.name}
                  aria-invalid={!!error}
                  aria-describedby={`rs-${row.key}-hint`}
                  onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-9 shrink-0 text-muted-foreground"
                  aria-label={`Reset stage ${i + 1}`}
                  disabled={!value}
                  onClick={() => setDraft((d) => ({ ...d, [row.key]: "" }))}
                >
                  <RotateCcw />
                </Button>
              </div>
              <p
                id={`rs-${row.key}-hint`}
                className={error ? "text-[11.5px] text-bad" : "text-[11.5px] text-muted-foreground"}
                role={error ? "alert" : undefined}
              >
                {error ??
                  (row.inherited.source === "default"
                    ? hint
                    : `${hint} · default is ${row.inherited.defaultName}`)}
              </p>
            </li>
          );
        })}
      </ol>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          className="justify-self-start"
          disabled={!anySet}
          onClick={() => setDraft({})}
        >
          Reset all
        </Button>
        <span className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={failed || !changed}>
            Save
          </Button>
        </span>
      </DialogFooter>
    </form>
  );
}
