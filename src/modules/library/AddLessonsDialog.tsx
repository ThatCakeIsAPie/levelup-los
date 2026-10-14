import { useEffect, useMemo, useState } from "react";
import { Check, Search, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  addItemsToChannel,
  filterCatalog,
  itemFitsChannel,
  lengthLabel,
  speakerLine,
  useCatalog,
  useEvents,
  useLibraryPeople,
  useLibraryTopics,
  type ChannelView,
} from "@/data";
import { KindIcon } from "./icons";
import { FormSheet } from "./FormSheet";

/** Pick talks from All talks to add to a channel (or upload a new one into it). */
export function AddLessonsDialog({
  open,
  onOpenChange,
  view,
  onUploadNew,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  view: ChannelView;
  onUploadNew: (sectionId: string) => void;
}) {
  const catalog = useCatalog();
  const people = useLibraryPeople();
  const topics = useLibraryTopics();
  const events = useEvents();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const sections = view.channel.sections;
  const [sectionId, setSectionId] = useState(sections[sections.length - 1]?.id ?? "");

  useEffect(() => {
    if (!open) return;
    setQ("");
    setPicked([]);
    setSectionId(sections[sections.length - 1]?.id ?? "");
  }, [open, sections]);

  const inChannel = useMemo(
    () => new Set(view.channel.sections.flatMap((s) => s.itemIds)),
    [view.channel.sections],
  );
  const results = useMemo(() => {
    const topicName = new Map(topics.map((t) => [t.id, t.name]));
    const eventName = new Map(events.map((e) => [e.id, e.name]));
    return filterCatalog(
      // A channel only offers what its audience may open.
      catalog.filter((i) => itemFitsChannel(view.channel.visibility, i.visibility)),
      { q, sort: "newest" },
      {
        person: (id) => people.get(id)?.name,
        topic: (id) => topicName.get(id),
        event: (id) => eventName.get(id),
      },
    );
  }, [catalog, q, people, topics, events, view.channel.visibility]);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Add lessons"
      description={`Pick talks from All talks for "${view.channel.title}".`}
      footer={
        <>
          <Button variant="outline" onClick={() => onUploadNew(sectionId)} className="mr-auto">
            <Upload /> Upload new
          </Button>
          <Button
            disabled={!picked.length}
            onClick={() => {
              addItemsToChannel(view.channel.id, picked, sectionId || undefined);
              onOpenChange(false);
            }}
          >
            Add {picked.length || ""} {picked.length === 1 ? "lesson" : "lessons"}
          </Button>
        </>
      }
    >
      {sections.length > 1 && (
        <Select value={sectionId} onValueChange={setSectionId}>
          <SelectTrigger aria-label="Add to section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s, i) => (
              <SelectItem key={s.id} value={s.id}>
                Add to: {s.title ?? `Section ${i + 1}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
          aria-hidden="true"
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles, speakers, topics"
          aria-label="Search talks"
          className="pl-9"
        />
      </div>
      <ul className="grid gap-0.5">
        {results.map((i) => {
          const already = inChannel.has(i.id);
          const on = picked.includes(i.id);
          return (
            <li key={i.id}>
              <button
                type="button"
                disabled={already}
                aria-pressed={on}
                onClick={() => toggle(i.id)}
                className={cn(
                  "grid w-full grid-cols-[34px_minmax(0,1fr)_22px] items-center gap-3 rounded-[10px] px-2 py-2 text-left text-[13px] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50",
                  on && "bg-primary-soft hover:bg-primary-soft",
                )}
              >
                <KindIcon kind={i.kind} />
                <span className="min-w-0">
                  <b className="block truncate">{i.title}</b>
                  <small className="block truncate text-[11.5px] text-muted-foreground">
                    {already
                      ? "Already in this channel"
                      : `${speakerLine(i.speakers, people)} · ${lengthLabel(i)}`}
                  </small>
                </span>
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-md border border-line",
                    (on || already) && "border-primary bg-primary text-primary-foreground",
                  )}
                  aria-hidden="true"
                >
                  {(on || already) && <Check className="size-3.5" />}
                </span>
              </button>
            </li>
          );
        })}
        {!results.length && (
          <li className="px-2 py-6 text-center text-[13px] text-muted-foreground">
            No talks match.
          </li>
        )}
      </ul>
    </FormSheet>
  );
}
