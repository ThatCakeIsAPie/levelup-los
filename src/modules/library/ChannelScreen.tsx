import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  GripVertical,
  FileText,
  Headphones,
  Lock,
  Pencil,
  Play,
  PlayCircle,
  Plus,
  Presentation,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { EmptyState, PageHeader, useIsDesktop } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useCurrentUser,
  addChannelSection,
  formatMinutes,
  moveChannelItem,
  placeChannelItem,
  moveChannelSection,
  removeChannel,
  removeChannelSection,
  removeItemFromChannel,
  renameChannelSection,
  useLibraryChannel,
  useMyLibraryProgress,
  type ChannelView,
} from "@/data";
import { AddLessonsDialog } from "./AddLessonsDialog";
import { ChannelDialog } from "./ChannelDialog";
import { ChannelIcon } from "./icons";
import { ItemDialog } from "./ItemDialog";
import { useOpenItem } from "./links";
import { LessonRow, audienceText } from "./parts";

/** One channel: hero with progress and Continue, lessons by section, and the editor for its owner. */
export function ChannelScreen({
  channelId,
  edit,
  add,
}: {
  channelId: string;
  edit: boolean;
  add?: "upload" | "link";
}) {
  const view = useLibraryChannel(channelId);
  const desktop = useIsDesktop();
  if (!view) {
    return (
      <div className="grid content-start gap-4 px-4 py-5 lg:px-[26px] lg:py-[22px]">
        {!desktop && (
          <PageHeader
            title="Library"
            back={{ to: "/library", label: "Library" }}
            logButton={false}
          />
        )}
        <EmptyState
          title="Channel not found"
          body="It may have been removed, or it's only shared with another team."
          action={
            <Button asChild variant="soft">
              <Link to="/library">Back to the library</Link>
            </Button>
          }
        />
      </div>
    );
  }
  return <Channel view={view} edit={edit && view.canEdit} add={view.canEdit ? add : undefined} />;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function Channel({
  view,
  edit,
  add,
}: {
  view: ChannelView;
  edit: boolean;
  add?: "upload" | "link";
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const progress = useMyLibraryProgress();
  const open = useOpenItem();
  const user = useCurrentUser();
  const c = view.channel;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [uploadSection, setUploadSection] = useState<string | null>(null);
  const [uploadSource, setUploadSource] = useState<"upload" | "link">("upload");
  // Coming from the New channel sheet's first-lesson step: open "Add a talk" once.
  useEffect(() => {
    if (!add) return;
    setUploadSource(add);
    setUploadSection(view.channel.sections[view.channel.sections.length - 1]?.id ?? "");
    void navigate({
      to: "/library/$channelId",
      params: { channelId: view.channel.id },
      search: { edit: true },
      replace: true,
    });
  }, [add, navigate, view.channel.id, view.channel.sections]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newSection, setNewSection] = useState("");
  // Drag and drop (desktop): the dragged lesson and where it would land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ sectionId: string; beforeId: string | null } | null>(null);
  const drop = () => {
    if (dragId && dropAt) {
      const sec = c.sections.find((x) => x.id === dropAt.sectionId);
      if (sec) {
        const ids = sec.itemIds.filter((id) => id !== dragId);
        const at = dropAt.beforeId ? ids.indexOf(dropAt.beforeId) : -1;
        placeChannelItem(c.id, dragId, sec.id, at < 0 ? ids.length : at);
      }
    }
    setDragId(null);
    setDropAt(null);
  };

  const setEdit = (on: boolean) =>
    void navigate({
      to: "/library/$channelId",
      params: { channelId: c.id },
      search: on ? { edit: true } : {},
      replace: true,
    });

  const { stats } = view;
  const nextItem = stats.nextId ? view.items.find((i) => i.id === stats.nextId) : undefined;
  const started = stats.done > 0 || (nextItem && (progress.get(nextItem.id)?.positionSec ?? 0) > 0);
  const allDone = stats.total > 0 && stats.done === stats.total;
  const pct = Math.round(stats.fraction * 100);
  const meta = [
    view.counts.audio ? { icon: Headphones, text: `${view.counts.audio} audio` } : null,
    view.counts.video ? { icon: PlayCircle, text: `${view.counts.video} video` } : null,
    view.counts.slides
      ? { icon: Presentation, text: plural(view.counts.slides, "slide deck") }
      : null,
    view.counts.document
      ? { icon: FileText, text: plural(view.counts.document, "document") }
      : null,
  ].filter(Boolean) as { icon: typeof Headphones; text: string }[];

  const continueBtn = !view.locked && view.items.length > 0 && (
    <Button onClick={() => open(nextItem ?? view.items[0], c.id)} className="w-full sm:w-auto">
      {allDone ? <RotateCcw /> : <Play />}
      {allDone ? "Start again" : started ? `Continue: Lesson ${stats.nextNumber}` : "Start"}
    </Button>
  );

  let number = 0;
  return (
    <div className="grid content-start">
      {!desktop && (
        <Link
          to="/library"
          className="mx-4 mt-4 inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Library
        </Link>
      )}
      <header className="grid gap-4 border-b border-line px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-5 lg:px-[26px] lg:py-[22px]">
        <ChannelIcon
          icon={c.icon}
          color={c.color}
          size={desktop ? "xl" : "md"}
          className="max-sm:size-14 max-sm:rounded-2xl max-sm:[&_svg]:size-7"
        />
        <div className="min-w-0">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
            Channel · by {view.ownerName}
            {c.visibility !== "team" &&
              ` · ${audienceText(c.visibility, c.createdBy, view.ownerName, user.personId)}`}
          </span>
          <h1 className="text-[19px] font-extrabold leading-tight lg:text-[22px]">{c.title}</h1>
          {c.description && (
            <p className="mt-1 text-[13px] text-muted-foreground">{c.description}</p>
          )}
          {meta.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px] text-muted-foreground">
              {meta.map((m) => (
                <span key={m.text} className="inline-flex items-center gap-1.5">
                  <m.icon className="size-3.5" aria-hidden="true" />
                  {m.text}
                </span>
              ))}
              {view.totalSec > 0 && <span>about {formatMinutes(view.totalSec)} in total</span>}
            </div>
          )}
        </div>
        {!view.locked && (
          <div className="grid gap-1.5 sm:justify-items-end sm:text-right">
            {view.items.length > 0 && (
              <div className="flex items-baseline gap-2 sm:grid sm:gap-0">
                <span className="text-[28px] font-extrabold tabular-nums leading-none">{pct}%</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {stats.done} of {stats.total} done
                </span>
              </div>
            )}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {continueBtn}
              {view.canEdit && !edit && (
                <Button variant="outline" onClick={() => setEdit(true)}>
                  <Pencil /> Edit
                </Button>
              )}
            </div>
          </div>
        )}
      </header>

      {view.locked ? (
        <div className="px-4 py-6 lg:px-[26px]">
          <EmptyState
            icon={<Lock />}
            title="For IBOs and leaders"
            body={`${plural(view.lessonCount, "lesson")} for when you lead a team. It opens for you when you become an IBO.`}
          />
        </div>
      ) : (
        <div className="grid gap-0.5 px-2 pt-2 pb-8 lg:px-[18px]">
          {edit && (
            <div className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2">
              <b className="mr-auto text-[13px]">
                Editing lessons
                <span className="ml-2 hidden font-normal text-muted-foreground lg:inline">
                  Drag lessons to reorder them
                </span>
              </b>
              <Button size="sm" variant="soft" onClick={() => setAddOpen(true)}>
                <Plus /> Add lessons
              </Button>
              <Button size="sm" variant="outline" onClick={() => setDetailsOpen(true)}>
                <Pencil /> Details
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-bad"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 /> Delete
              </Button>
              <Button size="sm" onClick={() => setEdit(false)}>
                Done
              </Button>
            </div>
          )}
          {view.sections.map((s, si) => {
            const sectionNode = (
              <div key={s.id} className="grid gap-0.5">
                {edit ? (
                  <SectionEditor
                    channelId={c.id}
                    sectionId={s.id}
                    title={s.title}
                    index={si}
                    count={view.sections.length}
                  />
                ) : (
                  s.title && (
                    <h2 className="px-2.5 pt-3 pb-1 text-[10.5px] font-extrabold uppercase tracking-[.08em] text-faint">
                      {s.title}
                    </h2>
                  )
                )}
                {s.items.map((it, idx) => {
                  number++;
                  const nextId = s.items[idx + 1]?.id ?? null;
                  const row = (
                    <LessonRow
                      key={it.id}
                      item={it}
                      number={number}
                      progress={progress.get(it.id)}
                      current={!edit && it.id === stats.nextId && !!started}
                      onOpen={() => open(it, c.id)}
                      trailing={
                        edit ? (
                          <span className="flex items-center gap-0.5">
                            <GripVertical
                              className="mr-1 hidden size-4 cursor-grab text-faint lg:block"
                              aria-hidden="true"
                            />
                            <IconBtn
                              label={`Move ${it.title} up`}
                              onClick={() => moveChannelItem(c.id, it.id, -1)}
                            >
                              <ArrowUp />
                            </IconBtn>
                            <IconBtn
                              label={`Move ${it.title} down`}
                              onClick={() => moveChannelItem(c.id, it.id, 1)}
                            >
                              <ArrowDown />
                            </IconBtn>
                            <IconBtn
                              label={`Remove ${it.title} from this channel`}
                              onClick={() => removeItemFromChannel(c.id, it.id)}
                            >
                              <X />
                            </IconBtn>
                          </span>
                        ) : undefined
                      }
                    />
                  );
                  if (!edit) return row;
                  return (
                    <div
                      key={it.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", it.id);
                        setDragId(it.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropAt(null);
                      }}
                      onDragOver={(e) => {
                        if (!dragId) return;
                        e.preventDefault();
                        const r = e.currentTarget.getBoundingClientRect();
                        const before = e.clientY < r.top + r.height / 2;
                        setDropAt({ sectionId: s.id, beforeId: before ? it.id : nextId });
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        drop();
                      }}
                      className={cn(
                        "relative rounded-[10px]",
                        dragId === it.id && "opacity-40",
                        dropAt?.sectionId === s.id &&
                          dropAt.beforeId === it.id &&
                          "before:absolute before:inset-x-2 before:-top-px before:h-0.5 before:rounded-full before:bg-primary",
                        dropAt?.sectionId === s.id &&
                          dropAt.beforeId === null &&
                          !nextId &&
                          "after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
                      )}
                    >
                      {row}
                    </div>
                  );
                })}
                {edit && !s.items.length && (
                  <p
                    onDragOver={(e) => {
                      if (!dragId) return;
                      e.preventDefault();
                      setDropAt({ sectionId: s.id, beforeId: null });
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      drop();
                    }}
                    className={cn(
                      "rounded-[10px] px-2.5 py-2 text-[12px] text-muted-foreground",
                      dropAt?.sectionId === s.id && "bg-primary-soft",
                    )}
                  >
                    No lessons in this section yet.
                  </p>
                )}
              </div>
            );
            return sectionNode;
          })}
          {edit && (
            <form
              className="mt-2 flex gap-2 px-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (addChannelSection(c.id, newSection)) setNewSection("");
              }}
            >
              <Input
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                placeholder="New section, e.g. Inviting"
                aria-label="New section name"
                className="h-9 max-w-xs"
              />
              <Button type="submit" size="sm" variant="outline" disabled={!newSection.trim()}>
                <Plus /> Add section
              </Button>
            </form>
          )}
          {!view.items.length && !edit && (
            <div className="px-2 py-4">
              <EmptyState
                title="No lessons yet"
                body={
                  view.canEdit
                    ? "Add talks from All talks or upload new ones."
                    : "Lessons will show up here."
                }
                action={
                  view.canEdit ? (
                    <Button variant="soft" onClick={() => setEdit(true)}>
                      <Plus /> Add lessons
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
      )}

      {view.canEdit && (
        <>
          <ChannelDialog open={detailsOpen} onOpenChange={setDetailsOpen} channel={c} />
          <AddLessonsDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            view={view}
            onUploadNew={(sectionId) => {
              setAddOpen(false);
              setUploadSource("upload");
              setUploadSection(sectionId);
            }}
          />
          <ItemDialog
            open={uploadSection !== null}
            onOpenChange={(o) => !o && setUploadSection(null)}
            channelId={c.id}
            sectionId={uploadSection || undefined}
            initialSource={uploadSource}
          />
          <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{c.title}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  The channel goes away for everyone. Its lessons stay in All talks, and everyone
                  keeps their progress.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    removeChannel(c.id);
                    void navigate({ to: "/library" });
                  }}
                >
                  Delete channel
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

function SectionEditor({
  channelId,
  sectionId,
  title,
  index,
  count,
}: {
  channelId: string;
  sectionId: string;
  title: string | null;
  index: number;
  count: number;
}) {
  const [value, setValue] = useState(title ?? "");
  return (
    <div className={cn("flex items-center gap-1 px-2.5 pt-3 pb-1")}>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== (title ?? "") && renameChannelSection(channelId, sectionId, value)}
        placeholder={count > 1 ? `Section ${index + 1}` : "Section name (optional)"}
        aria-label="Section name"
        className="h-8 max-w-xs text-[12px] font-bold uppercase tracking-[.06em]"
      />
      {count > 1 && (
        <>
          <IconBtn
            label="Move section up"
            onClick={() => moveChannelSection(channelId, sectionId, -1)}
          >
            <ArrowUp />
          </IconBtn>
          <IconBtn
            label="Move section down"
            onClick={() => moveChannelSection(channelId, sectionId, 1)}
          >
            <ArrowDown />
          </IconBtn>
          <IconBtn
            label="Remove section (its lessons move to the one above)"
            onClick={() => removeChannelSection(channelId, sectionId)}
          >
            <Trash2 />
          </IconBtn>
        </>
      )}
    </div>
  );
}
