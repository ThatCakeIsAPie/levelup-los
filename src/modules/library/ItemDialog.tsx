import { useEffect, useMemo, useRef, useState } from "react";
import { Link2, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { IS_SUPABASE } from "@/lib/config";
import {
  CATALOG_FORMATS,
  CATALOG_KINDS,
  FORMAT_LABEL,
  KIND_LABEL,
  LINK_PROVIDER_LABEL,
  VISIBILITY_LABEL,
  addCatalogItem,
  addTopic,
  parseLink,
  saveLibraryFile,
  updateCatalogItem,
  useEvents,
  useLibraryAccess,
  useLibraryPeople,
  useLibraryTopics,
  useWorkspaceMembers,
  validateItemDraft,
  type CatalogFormat,
  type CatalogItem,
  type CatalogKind,
  type ItemDraft,
  type LibraryVisibility,
  type Speaker,
} from "@/data";
import { Errors, Field, FormSheet } from "./FormSheet";

const NONE = "__none";

/** Length of an audio/video file in seconds (null when the browser can't read it). */
function mediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("video") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? Math.round(el.duration) : null);
    el.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
    el.src = url;
  });
}

/** Page count of a PDF (best effort: counts page objects). */
async function pdfPages(file: File): Promise<number | null> {
  try {
    const text = await file.slice(0, Math.min(file.size, 20_000_000)).text();
    const n = (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
    return n || null;
  } catch {
    return null;
  }
}

const kindFromMime = (mime: string): CatalogKind | null =>
  mime.startsWith("audio/")
    ? "audio"
    : mime.startsWith("video/")
      ? "video"
      : mime === "application/pdf"
        ? "document"
        : null;

const titleFromFile = (name: string) =>
  name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());

/**
 * "Add a talk" / "Edit": upload (audio, video, PDF) or link (YouTube, Vimeo,
 * Google Slides), with speakers, format, topics, event, date, audience and the
 * required "I have permission to share this".
 */
export function ItemDialog({
  open,
  onOpenChange,
  item,
  channelId,
  sectionId,
  initialSource = "upload",
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit this item (omit to add one). */
  item?: CatalogItem;
  /** Also add the new item to this channel (and section). */
  channelId?: string;
  sectionId?: string;
  /** New talks: start on Upload or Link. */
  initialSource?: "upload" | "link";
  onSaved?: (item: CatalogItem) => void;
}) {
  const { visibilities, canManageTopics, viewer } = useLibraryAccess();
  const topics = useLibraryTopics();
  const events = useEvents();
  const members = useWorkspaceMembers();
  const people = useLibraryPeople();
  const pastEvents = useMemo(() => [...events].reverse(), [events]);

  const [source, setSource] = useState<"upload" | "link">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<CatalogKind>("audio");
  const [minutes, setMinutes] = useState("");
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [pages, setPages] = useState("");
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [guest, setGuest] = useState("");
  const [format, setFormat] = useState<CatalogFormat>("talk");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [eventId, setEventId] = useState<string>(NONE);
  const [recordedOn, setRecordedOn] = useState("");
  const [visibility, setVisibility] = useState<LibraryVisibility>("team");
  const [permission, setPermission] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSource(item?.source ?? initialSource);
    setFile(null);
    setLinkUrl(item?.linkUrl ?? "");
    setTitle(item?.title ?? "");
    setDescription(item?.description ?? "");
    setKind(item?.kind ?? "audio");
    setDurationSec(item?.durationSec ?? null);
    setMinutes(item?.durationSec ? String(Math.round(item.durationSec / 60)) : "");
    setPages(item?.pageCount ? String(item.pageCount) : "");
    setSpeakers(item?.speakers ?? (viewer ? [{ personId: viewer.personId, name: null }] : []));
    setGuest("");
    setFormat(item?.format ?? "talk");
    setTopicIds(item?.topicIds ?? []);
    setNewTopic("");
    setEventId(item?.eventId ?? NONE);
    setRecordedOn(item?.recordedOn ?? "");
    setVisibility(item?.visibility ?? visibilities[0] ?? "downline");
    setPermission(!!item);
    setErrors([]);
    setSaving(false);
  }, [open, item, visibilities, viewer, initialSource]);

  const parsed = source === "link" && linkUrl.trim() ? parseLink(linkUrl) : null;
  const mediaKind = kind === "audio" || kind === "video";
  const uploadKinds: CatalogKind[] = file
    ? kindFromMime(file.type) === "document"
      ? ["document", "slides"]
      : [kindFromMime(file.type) ?? "document"]
    : CATALOG_KINDS;
  const audienceOptions =
    item && !visibilities.includes(item.visibility)
      ? [item.visibility, ...visibilities]
      : visibilities;

  const pickFile = async (f: File | null) => {
    if (!f) return;
    const k = kindFromMime(f.type);
    if (!k) {
      setErrors(["Choose an audio file, a video or a PDF."]);
      return;
    }
    setErrors([]);
    setFile(f);
    setKind(k);
    if (!title.trim()) setTitle(titleFromFile(f.name));
    if (k === "audio" || k === "video") {
      const d = await mediaDuration(f);
      setDurationSec(d);
      setMinutes(d ? String(Math.max(1, Math.round(d / 60))) : "");
    } else {
      const n = await pdfPages(f);
      if (n) setPages(String(n));
    }
  };

  const onLink = (v: string) => {
    setLinkUrl(v);
    const p = parseLink(v);
    if (p && p.provider !== "other") setKind(p.kind);
  };

  const toggleTopic = (id: string) =>
    setTopicIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const addSpeakerPerson = (personId: string) => {
    if (speakers.some((s) => s.personId === personId)) return;
    setSpeakers([...speakers, { personId, name: null }]);
  };
  const addGuest = () => {
    const name = guest.trim();
    if (!name) return;
    setSpeakers([...speakers, { personId: null, name }]);
    setGuest("");
  };

  const save = async () => {
    const mins = Number(minutes);
    const draft: ItemDraft = {
      title,
      description,
      kind,
      source,
      linkUrl: source === "link" ? linkUrl : null,
      durationSec: mediaKind
        ? source === "upload" && durationSec
          ? durationSec
          : mins > 0
            ? Math.round(mins * 60)
            : (item?.durationSec ?? null)
        : null,
      pageCount: !mediaKind && Number(pages) > 0 ? Math.round(Number(pages)) : null,
      speakers,
      format,
      topicIds,
      eventId: eventId === NONE ? null : eventId,
      recordedOn: recordedOn || null,
      permissionConfirmed: permission,
      visibility,
      // Placeholders so validation can run before the upload.
      storagePath: item?.storagePath ?? (file ? "pending" : null),
      sizeBytes: file?.size ?? item?.sizeBytes ?? null,
      mime: file?.type ?? item?.mime ?? null,
      fileName: file?.name ?? item?.fileName ?? null,
    };
    if (item) {
      const res = updateCatalogItem(item.id, draft);
      if (!res.ok) return setErrors(res.errors);
      toast.success("Saved");
      onSaved?.(res.value);
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const newId = crypto.randomUUID();
    try {
      if (source === "upload" && file) {
        // Check everything else before storing a big file.
        const dry = validateItemDraft(draft, viewer);
        if (dry.length) {
          setErrors(dry);
          return;
        }
        draft.storagePath = await saveLibraryFile(file, newId);
      }
      const res = addCatalogItem(draft, { id: newId, channelId, sectionId });
      if (!res.ok) return setErrors(res.errors);
      toast.success(channelId ? "Added to the channel" : "Added to All talks");
      onSaved?.(res.value);
      onOpenChange(false);
    } catch {
      setErrors(["The file couldn't be saved on this device. Try a smaller file."]);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={item ? "Edit talk" : "Add a talk"}
      description={item ? undefined : "Upload it once; it can then go in any channel."}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : item ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      {!item && (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Upload or link">
          {(
            [
              ["upload", Upload, "Upload", "Audio, video or PDF"],
              ["link", Link2, "Link", "YouTube or Vimeo (unlisted), Google Slides"],
            ] as const
          ).map(([value, Icon, label, hint]) => (
            <button
              key={value}
              type="button"
              aria-pressed={source === value}
              onClick={() => setSource(value)}
              className={cn(
                "grid gap-0.5 rounded-xl border border-line p-3 text-left text-[11.5px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
                source === value && "border-primary bg-primary-soft text-primary-ink",
              )}
            >
              <b className="flex items-center gap-1.5 text-[13px] text-foreground">
                <Icon className="size-4" aria-hidden="true" />
                {label}
              </b>
              {hint}
            </button>
          ))}
        </div>
      )}

      {!item && source === "upload" && (
        <Field
          label="File"
          hint={
            IS_SUPABASE
              ? "Up to 200 MB. Long videos: use an unlisted YouTube or Vimeo link."
              : "Up to 200 MB. In this demo files stay on this device."
          }
        >
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*,application/pdf"
            className="sr-only"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
            aria-label="Choose a file"
          />
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            onClick={() => fileInput.current?.click()}
          >
            <Upload /> {file ? file.name : "Choose a file"}
          </Button>
        </Field>
      )}

      {source === "link" && (
        <Field
          label="Link"
          htmlFor="it-link"
          hint={
            parsed
              ? `${LINK_PROVIDER_LABEL[parsed.provider]}${parsed.embedUrl ? " · plays in the app" : " · opens in a new tab"}`
              : undefined
          }
        >
          <Input
            id="it-link"
            inputMode="url"
            value={linkUrl}
            onChange={(e) => onLink(e.target.value)}
            placeholder="https://youtu.be/…"
          />
        </Field>
      )}

      <Field label="Title" htmlFor="it-title">
        <Input
          id="it-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Inviting without pressure"
        />
      </Field>
      <Field label="Description" htmlFor="it-desc">
        <Textarea
          id="it-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          <Select
            value={kind}
            onValueChange={(v) => setKind(v as CatalogKind)}
            disabled={!!item && item.source === "upload"}
          >
            <SelectTrigger aria-label="Type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(source === "upload" && !item ? uploadKinds : CATALOG_KINDS).map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {mediaKind ? (
          <Field label="Length (minutes)" htmlFor="it-min">
            <Input
              id="it-min"
              type="number"
              min={1}
              inputMode="numeric"
              value={minutes}
              disabled={source === "upload" && !!durationSec}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
        ) : (
          <Field label={kind === "slides" ? "Slides" : "Pages"} htmlFor="it-pages">
            <Input
              id="it-pages"
              type="number"
              min={1}
              inputMode="numeric"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
            />
          </Field>
        )}
      </div>

      <Field label="Speakers">
        {speakers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {speakers.map((s, i) => (
              <span
                key={`${s.personId ?? s.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12px] font-semibold"
              >
                {s.personId ? (people.get(s.personId)?.name ?? "Team member") : `${s.name} (guest)`}
                <button
                  type="button"
                  onClick={() => setSpeakers(speakers.filter((_, j) => j !== i))}
                  aria-label={`Remove ${s.personId ? (people.get(s.personId)?.name ?? "speaker") : s.name}`}
                  className="grid size-5 place-items-center rounded-full hover:bg-track"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Select value="" onValueChange={addSpeakerPerson}>
            <SelectTrigger aria-label="Add a team speaker">
              <SelectValue placeholder="Add someone from the team" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-1.5">
            <Input
              value={guest}
              onChange={(e) => setGuest(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addGuest();
                }
              }}
              placeholder="Or a guest's name"
              aria-label="Guest speaker name"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addGuest}
              aria-label="Add guest speaker"
            >
              <Plus />
            </Button>
          </div>
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Format">
          <Select value={format} onValueChange={(v) => setFormat(v as CatalogFormat)}>
            <SelectTrigger aria-label="Format">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATALOG_FORMATS.map((f) => (
                <SelectItem key={f} value={f}>
                  {FORMAT_LABEL[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Recorded on" htmlFor="it-date">
          <Input
            id="it-date"
            type="date"
            value={recordedOn}
            onChange={(e) => setRecordedOn(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Recorded at">
        <Select
          value={eventId}
          onValueChange={(v) => {
            setEventId(v);
            const ev = events.find((e) => e.id === v);
            if (ev && !recordedOn) setRecordedOn(ev.date);
          }}
        >
          <SelectTrigger aria-label="Recorded at event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No event</SelectItem>
            {pastEvents.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[12.5px] font-semibold">Topics</legend>
        <div className="flex flex-wrap gap-1.5">
          {topics.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={topicIds.includes(t.id)}
              onClick={() => toggleTopic(t.id)}
              className={cn(
                "rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
                topicIds.includes(t.id) && "border-foreground bg-foreground text-background",
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
        {canManageTopics && (
          <div className="flex gap-1.5">
            <Input
              value={newTopic}
              onChange={(e) => setNewTopic(e.target.value)}
              placeholder="New topic"
              aria-label="New topic name"
              className="h-8 max-w-[220px] text-[12.5px]"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                const t = addTopic(newTopic);
                if (t) {
                  setTopicIds((cur) => (cur.includes(t.id) ? cur : [...cur, t.id]));
                  setNewTopic("");
                }
              }}
            >
              <Plus /> Add topic
            </Button>
          </div>
        )}
      </fieldset>

      <Field label="Who can see it">
        <Select value={visibility} onValueChange={(v) => setVisibility(v as LibraryVisibility)}>
          <SelectTrigger aria-label="Who can see it">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {audienceOptions.map((v) => (
              <SelectItem key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <label className="flex items-start gap-3 rounded-xl border border-line p-3">
        <Checkbox
          checked={permission}
          onCheckedChange={(c) => setPermission(c === true)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-[13px] font-semibold">I have permission to share this</span>
          <span className="block text-[11.5px] text-muted-foreground">
            The speakers agreed and it isn't someone else's paid material.
          </span>
        </span>
      </label>
      <Errors errors={errors} />
    </FormSheet>
  );
}
