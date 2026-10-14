import { useState } from "react";
import { toastWithUndo } from "@/components/log/quickLog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addMissedNote, removeMissedNote } from "@/data";

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * "Already handled" note on a missed-event follow-up (uplines only). Saving it
 * clears the follow-up for every upline; the note shows on the person's
 * profile and the event for anyone who can see them.
 */
export function MissedNoteDialog({
  open,
  onOpenChange,
  personId,
  personName,
  eventId,
  eventName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personId: string;
  personName: string;
  eventId: string;
  eventName: string;
  onSaved?: () => void;
}) {
  const [text, setText] = useState("");
  const first = firstName(personName);
  const save = () => {
    if (!text.trim()) return;
    const note = addMissedNote(personId, eventId, text);
    setText("");
    onOpenChange(false);
    onSaved?.();
    toastWithUndo(`Noted: ${first}'s follow-up is handled`, () => removeMissedNote(note.id), {
      description: "Their other uplines can read your note.",
      undoneMessage: "Note removed",
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] rounded-card sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <DialogHeader className="text-left">
            <DialogTitle>Already handled?</DialogTitle>
            <DialogDescription>
              {first} missed {eventName}. Leave a note so the rest of {first}'s uplines know it's
              taken care of.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="missed-note">What happened</Label>
            <Textarea
              id="missed-note"
              autoFocus
              maxLength={1000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Talked at the gym, she was sick"
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!text.trim()}>
              Save note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
