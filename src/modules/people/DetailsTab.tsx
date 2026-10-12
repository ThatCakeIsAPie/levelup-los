import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { toast } from "sonner";
import { Pencil, Trash2, X } from "lucide-react";
import {
  bizClassLabel,
  effectiveBizClass,
  missingRequiredFields,
  removePerson,
  updatePerson,
  useDownline,
  usePerson,
  useVisibleTeam,
  type CrmPerson,
  type PipelineStage,
} from "@/data";
import { SectionCard, StageChip } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { fmtDate, fmtMoney } from "./format";

export interface DetailsPermissions {
  /** Edit anything at all (contact fields, notes, tags). */
  canEdit: boolean;
  /** Change stage and sponsor (not on your own profile). */
  canEditStage: boolean;
  /** Edit IBO#, LTD# and dates (not for candidates). */
  canEditIds: boolean;
  canDelete: boolean;
}

/** Read-only details by default; "Edit" switches to a form. Danger zone at the bottom. */
export function DetailsTab({
  person,
  perms,
  editing,
  setEditing,
  onDeleted,
}: {
  person: CrmPerson;
  perms: DetailsPermissions;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onDeleted: () => void;
}) {
  return (
    <div className="grid gap-4">
      {editing ? (
        <DetailsForm person={person} perms={perms} onDone={() => setEditing(false)} />
      ) : (
        <DetailsView person={person} canEdit={perms.canEdit} onEdit={() => setEditing(true)} />
      )}
      {perms.canDelete && !editing && <DangerZone person={person} onDeleted={onDeleted} />}
    </div>
  );
}

function DetailsView({
  person,
  canEdit,
  onEdit,
}: {
  person: CrmPerson;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const sponsor = usePerson(person.sponsorId ?? undefined);
  const owner = usePerson(person.ownerId ?? undefined);
  const isCustomer = person.bizClass === "customer";
  const missing = new Set(missingRequiredFields(person));
  const required = (k: string) =>
    missing.has(k) ? <span className="font-semibold text-warn-ink">Missing</span> : undefined;

  const rows: [string, React.ReactNode][] = isCustomer
    ? [
        ["Name", person.name],
        [
          "Owner",
          owner ? <PersonLink p={owner} /> : (required("owner") ?? "Someone outside your team"),
        ],
        [
          "Monthly volume",
          person.monthlyVolume ? `${fmtMoney(person.monthlyVolume)} a month` : undefined,
        ],
        ["Customer since", fmtDate(person.joinedDate, { year: true })],
        ["Phone", person.phone],
        ["Email", person.email],
        ["Location", person.location],
      ]
    : [
        ["Name", person.name],
        ["Stage", <StageChip key="s" stage={effectiveBizClass(person)} />],
        [
          "Sponsor",
          sponsor ? <PersonLink p={sponsor} /> : person.sponsorId ? "Your upline" : undefined,
        ],
        // IDs and start date only matter once someone starts a business.
        ...(person.bizClass !== "prospect" ||
        person.iboNumber ||
        person.ltdNumber ||
        person.businessStartDate
          ? ([
              ["IBO#", person.iboNumber || required("iboNumber")],
              ["LTD#", person.ltdNumber || required("ltdNumber")],
              [
                "Business start date",
                fmtDate(person.businessStartDate, { year: true }) || required("businessStartDate"),
              ],
            ] as [string, React.ReactNode][])
          : []),
        ["Joined", fmtDate(person.joinedDate, { year: true })],
        ["Phone", person.phone],
        ["Email", person.email],
        ["Location", person.location],
      ];

  return (
    <SectionCard
      title="Details"
      action={
        canEdit ? (
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil /> Edit
          </Button>
        ) : undefined
      }
    >
      <dl className="grid gap-x-6 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-baseline gap-3 border-t border-line py-2.5 text-[13px] sm:[&:nth-child(-n+2)]:border-t-0 [&:first-child]:border-t-0"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-words font-medium">
              {value || <span className="font-normal text-faint">Not set</span>}
            </dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-1.5 border-t border-line pt-3 text-[13px]">
        <span className="text-muted-foreground">Tags</span>
        {person.tags?.length ? (
          <TagList tags={person.tags} />
        ) : (
          <span className="text-faint">No tags</span>
        )}
      </div>
      <div className="grid gap-1.5 border-t border-line pt-3 text-[13px]">
        <span className="text-muted-foreground">Notes</span>
        {person.notes ? (
          <p className="whitespace-pre-wrap break-words">{person.notes}</p>
        ) : (
          <span className="text-faint">No notes</span>
        )}
      </div>
      {!isCustomer && (person.stageHistory?.length ?? 0) > 0 && (
        <div className="grid gap-1.5 border-t border-line pt-3 text-[13px]">
          <span className="text-muted-foreground">Stage history</span>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {person.stageHistory!.map((h, i) => (
              <li key={i}>
                <span className="font-semibold">{bizClassLabel[h.stage]}</span>{" "}
                <span className="text-muted-foreground">
                  {format(new Date(h.at), "MMM d, yyyy")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {person.lastUpdatedAt && (
        <p className="text-xs text-faint">
          Last updated {format(new Date(person.lastUpdatedAt), "MMM d, yyyy 'at' h:mm a")}
        </p>
      )}
    </SectionCard>
  );
}

function PersonLink({ p }: { p: CrmPerson }) {
  return (
    <Link
      to="/people/$id"
      params={{ id: p.id }}
      className="rounded-sm font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
    >
      {p.name}
    </Link>
  );
}

export function TagList({ tags, onRemove }: { tags: string[]; onRemove?: (t: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <li
          key={t}
          className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground"
        >
          {t}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Remove tag ${t}`}
              className="-mr-1 grid size-4 place-items-center rounded-full hover:bg-line focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

const STAGES: PipelineStage[] = ["prospect", "apprentice", "ibo"];

function DetailsForm({
  person,
  perms,
  onDone,
}: {
  person: CrmPerson;
  perms: DetailsPermissions;
  onDone: () => void;
}) {
  const isCustomer = person.bizClass === "customer";
  const team = useVisibleTeam();
  const downline = useDownline(person.id);
  const sponsorOptions = useMemo(() => {
    const blocked = new Set([person.id, ...downline.map((p) => p.id)]);
    return team.filter((p) => !blocked.has(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [team, downline, person.id]);
  const sponsorKnown = !person.sponsorId || sponsorOptions.some((p) => p.id === person.sponsorId);

  const [f, setF] = useState({
    name: person.name,
    stage: (isCustomer ? "prospect" : person.bizClass) as PipelineStage,
    sponsorId: person.sponsorId ?? "none",
    location: person.location ?? "",
    iboNumber: person.iboNumber ?? "",
    ltdNumber: person.ltdNumber ?? "",
    joinedDate: person.joinedDate ?? "",
    businessStartDate: person.businessStartDate ?? "",
    email: person.email ?? "",
    phone: person.phone ?? "",
    monthlyVolume: person.monthlyVolume?.toString() ?? "",
    notes: person.notes ?? "",
  });
  const [tags, setTags] = useState<string[]>(person.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const set =
    (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setF((s) => ({ ...s, [k]: e.target.value }));

  const needsIds = !isCustomer && (f.stage === "ibo" || f.stage === "apprentice");

  const addTag = () => {
    const t = tagDraft.trim();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagDraft("");
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return;
    const opt = (s: string) => s.trim() || undefined;
    const patch: Partial<CrmPerson> = {
      name: f.name.trim(),
      location: opt(f.location),
      email: opt(f.email),
      phone: opt(f.phone),
      notes: opt(f.notes),
      tags: tags.length ? tags : undefined,
    };
    if (perms.canEditIds) {
      patch.joinedDate = opt(f.joinedDate);
      if (!isCustomer) {
        patch.iboNumber = opt(f.iboNumber);
        patch.ltdNumber = opt(f.ltdNumber);
        patch.businessStartDate = opt(f.businessStartDate);
      } else {
        const vol = Number(f.monthlyVolume);
        patch.monthlyVolume = f.monthlyVolume.trim() && Number.isFinite(vol) ? vol : undefined;
      }
    }
    if (perms.canEditStage && !isCustomer) {
      if (f.stage !== person.bizClass || f.stage !== person.pipelineStage) {
        patch.bizClass = f.stage;
        patch.pipelineStage = f.stage;
      }
      patch.sponsorId = f.sponsorId === "none" ? null : f.sponsorId;
    }
    updatePerson(person.id, patch);
    toast.success("Details saved");
    onDone();
  };

  return (
    <SectionCard title="Edit details">
      <form onSubmit={save} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" id="d-name">
            <Input id="d-name" value={f.name} onChange={set("name")} required />
          </Field>
          {!isCustomer && (
            <Field
              label="Stage"
              id="d-stage"
              hint={!perms.canEditStage ? "Your sponsor updates your stage" : undefined}
            >
              <Select
                value={f.stage}
                onValueChange={(v) => setF((s) => ({ ...s, stage: v as PipelineStage }))}
                disabled={!perms.canEditStage}
              >
                <SelectTrigger id="d-stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {bizClassLabel[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          {!isCustomer && (
            <Field label="Sponsor" id="d-sponsor">
              <Select
                value={f.sponsorId}
                onValueChange={(v) => setF((s) => ({ ...s, sponsorId: v }))}
                disabled={!perms.canEditStage}
              >
                <SelectTrigger id="d-sponsor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No sponsor</SelectItem>
                  {!sponsorKnown && person.sponsorId && (
                    <SelectItem value={person.sponsorId}>Your upline</SelectItem>
                  )}
                  {sponsorOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Phone" id="d-phone">
            <Input id="d-phone" type="tel" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email" id="d-email">
            <Input id="d-email" type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Location" id="d-loc">
            <Input
              id="d-loc"
              value={f.location}
              onChange={set("location")}
              placeholder="City, State"
            />
          </Field>
          {!isCustomer && (
            <>
              <Field
                label={`IBO#${needsIds ? " (required)" : ""}`}
                id="d-ibo"
                warn={
                  needsIds && !f.iboNumber.trim() ? "Required for apprentices and IBOs" : undefined
                }
              >
                <Input
                  id="d-ibo"
                  value={f.iboNumber}
                  onChange={set("iboNumber")}
                  disabled={!perms.canEditIds}
                />
              </Field>
              <Field
                label={`LTD#${needsIds ? " (required)" : ""}`}
                id="d-ltd"
                warn={
                  needsIds && !f.ltdNumber.trim() ? "Required for apprentices and IBOs" : undefined
                }
              >
                <Input
                  id="d-ltd"
                  value={f.ltdNumber}
                  onChange={set("ltdNumber")}
                  disabled={!perms.canEditIds}
                />
              </Field>
              <Field
                label={`Business start date${f.stage === "apprentice" ? " (required)" : ""}`}
                id="d-start"
                warn={
                  f.stage === "apprentice" && !f.businessStartDate
                    ? "Apprentices become IBOs one year after this date"
                    : undefined
                }
              >
                <Input
                  id="d-start"
                  type="date"
                  value={f.businessStartDate}
                  onChange={set("businessStartDate")}
                  disabled={!perms.canEditIds}
                />
              </Field>
            </>
          )}
          {isCustomer && (
            <Field label="Monthly volume ($)" id="d-vol">
              <Input
                id="d-vol"
                type="number"
                min={0}
                inputMode="decimal"
                value={f.monthlyVolume}
                onChange={set("monthlyVolume")}
                disabled={!perms.canEditIds}
              />
            </Field>
          )}
          <Field label={isCustomer ? "Customer since" : "Joined date"} id="d-joined">
            <Input
              id="d-joined"
              type="date"
              value={f.joinedDate}
              onChange={set("joinedDate")}
              disabled={!perms.canEditIds}
            />
          </Field>
        </div>

        <Field label="Tags" id="d-tag">
          <div className="grid gap-2">
            {tags.length > 0 && (
              <TagList tags={tags} onRemove={(t) => setTags(tags.filter((x) => x !== t))} />
            )}
            <div className="flex gap-2">
              <Input
                id="d-tag"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="Add a tag, e.g. Bilingual"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag} disabled={!tagDraft.trim()}>
                Add
              </Button>
            </div>
          </div>
        </Field>

        <Field label="Notes" id="d-notes">
          <Textarea id="d-notes" rows={4} value={f.notes} onChange={set("notes")} />
        </Field>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={!f.name.trim()}>
            Save
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}

function Field({
  label,
  id,
  hint,
  warn,
  children,
}: {
  label: string;
  id: string;
  hint?: string;
  warn?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id} className="text-xs font-semibold text-muted-foreground">
        {label}
      </Label>
      {children}
      {(warn || hint) && (
        <p className={cn("text-[11.5px]", warn ? "text-warn-ink" : "text-faint")}>{warn ?? hint}</p>
      )}
    </div>
  );
}

function DangerZone({ person, onDeleted }: { person: CrmPerson; onDeleted: () => void }) {
  const downline = useDownline(person.id, { directOnly: true });
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-destructive/30 bg-bad-soft/40 px-4 py-4 sm:px-[18px]">
      <div className="min-w-0">
        <h2 className="text-sm font-bold">Delete {person.name}</h2>
        <p className="text-[12.5px] text-muted-foreground">
          Removes their profile from your team list for good.
        </p>
      </div>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-bad-soft hover:text-destructive"
          >
            <Trash2 /> Delete person
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {person.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone.
              {downline.length > 0 &&
                ` ${downline.length} ${downline.length === 1 ? "person they sponsor" : "people they sponsor"} will be left without a sponsor until you reassign them.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                removePerson(person.id);
                toast.success(`Deleted ${person.name}`);
                onDeleted();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
