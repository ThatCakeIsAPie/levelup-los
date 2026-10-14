import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Clock, Link2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  CHANNEL_COLORS,
  CHANNEL_ICONS,
  VISIBILITY_LABEL,
  createChannel,
  updateChannel,
  useLibraryAccess,
  type ChannelColor,
  type LibraryChannel,
  type LibraryVisibility,
} from "@/data";
import { ChannelIcon, CHANNEL_COLOR_LABEL } from "./icons";
import { Errors, Field, FormSheet } from "./FormSheet";

/** "New channel" / "Edit channel": name, description, icon and color, who can see it. */
export function ChannelDialog({
  open,
  onOpenChange,
  channel,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Edit this channel (omit to create one). */
  channel?: LibraryChannel;
}) {
  const navigate = useNavigate();
  const { visibilities } = useLibraryAccess();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>("book-open");
  const [color, setColor] = useState<ChannelColor>("teal");
  const [visibility, setVisibility] = useState<LibraryVisibility>("team");
  const [errors, setErrors] = useState<string[]>([]);
  const [first, setFirst] = useState<"upload" | "link" | "later">("later");

  useEffect(() => {
    if (!open) return;
    setTitle(channel?.title ?? "");
    setDescription(channel?.description ?? "");
    setIcon(channel?.icon ?? "book-open");
    setColor(channel?.color ?? "teal");
    setVisibility(channel?.visibility ?? visibilities[0] ?? "downline");
    setErrors([]);
    setFirst("later");
  }, [open, channel, visibilities]);

  const options =
    channel && !visibilities.includes(channel.visibility)
      ? [channel.visibility, ...visibilities]
      : visibilities;

  const save = () => {
    const draft = { title, description, icon, color, visibility };
    const res = channel ? updateChannel(channel.id, draft) : createChannel(draft);
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    onOpenChange(false);
    if (!channel) {
      toast.success("Channel created", { description: "Now add lessons and put them in order." });
      void navigate({
        to: "/library/$channelId",
        params: { channelId: res.value.id },
        search: first === "later" ? { edit: true } : { edit: true, add: first },
      });
    }
  };

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={channel ? "Edit channel" : "New channel"}
      description={
        channel ? undefined : "Name it, pick an icon and who can see it. Then add lessons."
      }
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={save}>{channel ? "Save" : "Create channel"}</Button>
        </>
      }
    >
      <Field label="Name" htmlFor="ch-title">
        <Input
          id="ch-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sales crash course"
        />
      </Field>
      <Field label="Description" htmlFor="ch-desc">
        <Textarea
          id="ch-desc"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Everything to make your first five sales"
        />
      </Field>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[12.5px] font-semibold">Icon</legend>
        <div className="flex flex-wrap gap-1.5">
          {CHANNEL_ICONS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setIcon(name)}
              aria-pressed={icon === name}
              aria-label={name.replace(/-/g, " ")}
              className={cn(
                "rounded-[11px] p-0.5 ring-offset-2 ring-offset-card focus-visible:outline-2 focus-visible:outline-ring",
                icon === name ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
              )}
            >
              <ChannelIcon icon={name} color={color} size="sm" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-[12.5px] font-semibold">Color</legend>
        <div className="flex flex-wrap gap-2">
          {CHANNEL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-pressed={color === c}
              aria-label={CHANNEL_COLOR_LABEL[c]}
              className={cn(
                "rounded-full p-0.5 ring-offset-2 ring-offset-card focus-visible:outline-2 focus-visible:outline-ring",
                color === c && "ring-2 ring-primary",
              )}
            >
              <ChannelIcon icon={icon} color={c} size="sm" className="rounded-full" />
            </button>
          ))}
        </div>
      </fieldset>
      <Field
        label="Who can see it"
        hint={
          visibility === "downline"
            ? "You and everyone in your downline."
            : visibility === "ibos"
              ? "Others see it locked until they become an IBO."
              : undefined
        }
      >
        <Select value={visibility} onValueChange={(v) => setVisibility(v as LibraryVisibility)}>
          <SelectTrigger aria-label="Who can see it">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((v) => (
              <SelectItem key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {!channel && (
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-[12.5px] font-semibold">First lesson (optional)</legend>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["upload", Upload, "Upload", "Audio, video or PDF"],
                ["link", Link2, "Link", "YouTube, Vimeo, Slides"],
                ["later", Clock, "Later", "Pick from All talks"],
              ] as const
            ).map(([value, Icon, label, hint]) => (
              <button
                key={value}
                type="button"
                aria-pressed={first === value}
                onClick={() => setFirst(value)}
                className={cn(
                  "grid gap-0.5 rounded-xl border border-line p-2.5 text-left text-[11px] text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  first === value && "border-primary bg-primary-soft text-primary-ink",
                )}
              >
                <b className="flex items-center gap-1.5 text-[12.5px] text-foreground">
                  <Icon className="size-3.5" aria-hidden="true" />
                  {label}
                </b>
                {hint}
              </button>
            ))}
          </div>
          {first !== "later" && (
            <p className="text-[11.5px] text-muted-foreground">
              Next you add its details and confirm you have permission to share it.
            </p>
          )}
        </fieldset>
      )}
      <Errors errors={errors} />
    </FormSheet>
  );
}
