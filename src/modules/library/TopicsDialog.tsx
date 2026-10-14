import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addTopic, removeTopic, renameTopic, useLibraryTopics } from "@/data";
import { FormSheet } from "./FormSheet";

/** Leaders and moderators keep the team's topic list (add, rename, remove). */
export function TopicsDialog({
  open,
  onOpenChange,
  counts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  counts: Map<string, number>;
}) {
  const topics = useLibraryTopics();
  const [name, setName] = useState("");
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Topics"
      description="The topics everyone picks from when adding a talk."
      footer={<Button onClick={() => onOpenChange(false)}>Done</Button>}
    >
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (addTopic(name)) setName("");
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New topic"
          aria-label="New topic name"
        />
        <Button type="submit" variant="soft" disabled={!name.trim()}>
          <Plus /> Add
        </Button>
      </form>
      <ul className="grid gap-1.5">
        {topics.map((t) => (
          <li key={t.id} className="flex items-center gap-2">
            <Input
              defaultValue={t.name}
              aria-label={`Rename ${t.name}`}
              onBlur={(e) => {
                const v = e.target.value;
                if (v.trim() === t.name) return;
                if (!renameTopic(t.id, v)) {
                  e.target.value = t.name;
                  toast.error("That name is empty or already used");
                }
              }}
            />
            <span className="w-16 shrink-0 text-right text-[12px] text-muted-foreground">
              {counts.get(t.id) ?? 0} {counts.get(t.id) === 1 ? "talk" : "talks"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${t.name}`}
              onClick={() => {
                removeTopic(t.id);
                toast(`Removed "${t.name}"`, { description: "Talks keep everything else." });
              }}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
    </FormSheet>
  );
}
