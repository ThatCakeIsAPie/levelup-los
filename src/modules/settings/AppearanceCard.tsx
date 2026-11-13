import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ImagePlus } from "lucide-react";
import { SectionCard } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  defaultLook,
  endTeamLookPreview,
  getTeamLook,
  isDefaultLook,
  lookWorkspaceId,
  previewTeamLook,
  resolveLook,
  sameLook,
  saveTeamLook,
  useTeamLook,
  type BackgroundMode,
  type TeamLook,
} from "@/data";
import { brand } from "@/brand/brand";
import { cn } from "@/lib/utils";
import { normalizeHex } from "@/lib/color";
import { PictureError, preparePicture, type Encoded } from "@/lib/pictureFiles";
import { getBrandColors, previewColors } from "@/lib/teamLook";
import type { TeamColorRole } from "@/lib/teamColors";
import { useTheme } from "@/lib/theme";

type ColorKey = TeamColorRole;
const COLOR_ROWS: Array<{ key: ColorKey; label: string }> = [
  { key: "main", label: "Main" },
  { key: "highlight", label: "Highlight" },
  { key: "sidebar", label: "Sidebar" },
];

/** What the editor holds while the leader works: the look plus pictures picked but not saved yet. */
interface Draft {
  background: BackgroundMode;
  glass: boolean | null;
  logo: "default" | "custom";
  colors: TeamLook["colors"];
  bgFile: Encoded | null;
  logoFile: Encoded | null;
}

const fromLook = (look: TeamLook): Draft => ({
  background: look.background,
  glass: look.glass,
  logo: look.logoPath ? "custom" : "default",
  colors: { ...look.colors },
  bgFile: null,
  logoFile: null,
});

/** Stand-in paths for a picture picked but not saved (never stored: saving replaces them). */
const pendingPath = (kind: "bg" | "logo", ext: string) =>
  `${lookWorkspaceId()}/${kind}-${"0".repeat(32)}.${ext}`;

function draftToLook(d: Draft, saved: TeamLook): TeamLook {
  const picture = d.background === "picture";
  return {
    background: d.background,
    backgroundPath: picture ? (d.bgFile ? pendingPath("bg", "webp") : saved.backgroundPath) : null,
    glass: d.glass,
    logoPath:
      d.logo === "custom" ? (d.logoFile ? pendingPath("logo", "webp") : saved.logoPath) : null,
    colors: d.colors,
  };
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  idPrefix,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  idPrefix: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex w-fit rounded-lg border border-line bg-surface-2 p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            id={`${idPrefix}-${o.value}`}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1",
              on
                ? "bg-primary-soft text-primary-ink"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-line py-3.5 first:border-t-0 first:pt-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <div className="pt-1.5 text-[13px] font-semibold">{label}</div>
      <div className="grid min-w-0 gap-2">{children}</div>
    </div>
  );
}

/** A picture or logo picker: a button, a small preview and what was picked. */
function PicturePicker({
  id,
  kind,
  pending,
  savedUrl,
  onPick,
  buttonLabel,
}: {
  id: string;
  kind: "bg" | "logo";
  pending: Encoded | null;
  savedUrl: string | null;
  onPick: (e: Encoded) => void;
  buttonLabel: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!pending) return setPendingUrl(null);
    const u = URL.createObjectURL(pending.blob);
    setPendingUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pending]);
  const shown = pendingUrl ?? savedUrl;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {shown && (
        <img
          src={shown}
          alt=""
          className={cn(
            "shrink-0 rounded-md border border-line bg-surface-2 object-cover",
            kind === "bg" ? "h-10 w-16" : "size-10 object-contain",
          )}
        />
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <ImagePlus aria-hidden="true" />
        {busy ? "Preparing…" : buttonLabel}
      </Button>
      <input
        ref={input}
        id={id}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            onPick(await preparePicture(file, kind));
          } catch (err) {
            setError(err instanceof PictureError ? err.message : "That picture could not be used.");
          } finally {
            setBusy(false);
          }
        }}
      />
      {pending && (
        <span className="text-xs text-muted-foreground">
          {pending.width} × {pending.height}, {Math.max(1, Math.round(pending.blob.size / 1024))} KB
        </span>
      )}
      {error && (
        <span role="alert" className="basis-full text-xs font-medium text-bad">
          {error}
        </span>
      )}
    </div>
  );
}

function ColorRow({
  id,
  label,
  chosen,
  fallback,
  used,
  note,
  onChange,
}: {
  id: string;
  label: string;
  chosen: string | null;
  fallback: string;
  used: string | null;
  note: string | null;
  onChange: (hex: string | null) => void;
}) {
  const value = chosen ?? fallback;
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = normalizeHex(text) !== null;
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:items-center sm:gap-3">
      <div className="text-[13px] font-medium">{label}</div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`appearance-color-${id}`}
          type="color"
          aria-label={`${label} color`}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-input bg-surface p-1"
        />
        <Input
          id={`appearance-hex-${id}`}
          aria-label={`${label} hex`}
          aria-invalid={!valid}
          value={text}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex) onChange(hex);
          }}
          onBlur={() => setText(value)}
          className="w-28 font-mono text-[13px] uppercase"
        />
        {chosen !== null ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Default
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">Default</span>
        )}
        {note && used && (
          <span
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid={`appearance-note-${id}`}
          >
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded border border-line"
              style={{ backgroundColor: used }}
            />
            {note} <span className="font-mono uppercase">{used}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Settings > Team > Appearance (the workspace leader only): background picture,
 * glass, logo and three colors for the whole team. Changes show on this screen
 * at once (a preview: `previewTeamLook`), Save stores them for the team, Cancel
 * puts the saved look back. The colors are guarded (src/lib/teamColors.ts): the
 * ones actually used are shown next to the ones chosen.
 */
export function AppearanceCard() {
  const saved = useTeamLook();
  const { resolved: theme } = useTheme();
  const [draft, setDraft] = useState<Draft>(() => fromLook(saved));
  const [saving, setSaving] = useState(false);
  const [urls, setUrls] = useState<{ bg: string | null; logo: string | null }>({
    bg: null,
    logo: null,
  });
  const savedKey = JSON.stringify(saved);

  // The saved pictures, as URLs (the demo reads them from the browser's storage).
  useEffect(() => {
    let live = true;
    void resolveLook(saved).then((r) => live && setUrls({ bg: r.backgroundUrl, logo: r.logoUrl }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const look = draftToLook(draft, saved);
  const dirty =
    !sameLook(look, saved) ||
    (draft.background === "picture" && draft.bgFile !== null) ||
    (draft.logo === "custom" && draft.logoFile !== null);
  const incomplete =
    (draft.background === "picture" && !draft.bgFile && !saved.backgroundPath) ||
    (draft.logo === "custom" && !draft.logoFile && !saved.logoPath);

  // Follow the saved look while nothing is being edited (a refresh brought a change).
  useEffect(() => {
    if (!dirty) setDraft(fromLook(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  // The live preview: what is chosen now, on this screen only.
  const pendingBg = draft.background === "picture" ? draft.bgFile : null;
  const pendingLogo = draft.logo === "custom" ? draft.logoFile : null;
  const [blobs, setBlobs] = useState<{ bg: string | null; logo: string | null }>({
    bg: null,
    logo: null,
  });
  useEffect(() => {
    const bg = pendingBg ? URL.createObjectURL(pendingBg.blob) : null;
    const logo = pendingLogo ? URL.createObjectURL(pendingLogo.blob) : null;
    setBlobs({ bg, logo });
    return () => {
      if (bg) URL.revokeObjectURL(bg);
      if (logo) URL.revokeObjectURL(logo);
    };
  }, [pendingBg, pendingLogo]);
  const blobsReady =
    (pendingBg === null || blobs.bg !== null) && (pendingLogo === null || blobs.logo !== null);
  useEffect(() => {
    if (!dirty) {
      void endTeamLookPreview();
      return;
    }
    if (!blobsReady) return;
    previewTeamLook({
      look,
      backgroundUrl: blobs.bg ?? urls.bg,
      logoUrl: draft.logo === "custom" ? (blobs.logo ?? urls.logo) : null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, JSON.stringify(look), blobs, urls, blobsReady]);
  // Leaving the page puts the saved look back.
  useEffect(() => () => void endTeamLookPreview(), []);

  const brandColors = useMemo(() => getBrandColors(), []);
  const derived = useMemo(() => previewColors(draft.colors), [draft.colors]);
  const hasBackdrop =
    draft.background === "picture" || (draft.background === "default" && !!brand.backgroundImage);
  const glassOn = hasBackdrop && (draft.glass ?? brand.glass);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await saveTeamLook(look, {
        background: pendingBg,
        logo: pendingLogo,
      });
      setDraft(fromLook(getTeamLook()));
      toast.success("Appearance saved for the team");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the appearance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Appearance">
      <div className="grid">
        <Row label="Background">
          <Segmented
            idPrefix="appearance-bg"
            label="Background"
            value={draft.background}
            onChange={(background) => set({ background })}
            options={[
              { value: "default", label: "Default" },
              { value: "none", label: "None" },
              { value: "picture", label: "Picture" },
            ]}
          />
          {draft.background === "picture" && (
            <PicturePicker
              id="appearance-bg-file"
              kind="bg"
              pending={draft.bgFile}
              savedUrl={saved.backgroundPath ? urls.bg : null}
              buttonLabel={
                draft.bgFile || saved.backgroundPath ? "Replace picture" : "Choose picture"
              }
              onPick={(bgFile) => set({ bgFile })}
            />
          )}
        </Row>

        <Row label="Glass">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              id="appearance-glass"
              aria-label="Glass"
              checked={glassOn}
              disabled={!hasBackdrop}
              onCheckedChange={(on) => set({ glass: on })}
            />
            {!hasBackdrop && <span className="text-xs text-muted-foreground">Needs a picture</span>}
          </div>
        </Row>

        <Row label="Logo">
          <Segmented
            idPrefix="appearance-logo"
            label="Logo"
            value={draft.logo}
            onChange={(logo) => set({ logo })}
            options={[
              { value: "default", label: "Default" },
              { value: "custom", label: "Custom" },
            ]}
          />
          {draft.logo === "custom" && (
            <PicturePicker
              id="appearance-logo-file"
              kind="logo"
              pending={draft.logoFile}
              savedUrl={saved.logoPath ? urls.logo : null}
              buttonLabel={draft.logoFile || saved.logoPath ? "Replace logo" : "Choose logo"}
              onPick={(logoFile) => set({ logoFile })}
            />
          )}
        </Row>

        <Row label="Colors">
          <div className="grid gap-3">
            {COLOR_ROWS.map(({ key, label }) => {
              const role = derived.roles[key];
              const adjusted = role?.adjusted[theme] ?? false;
              const note = !role
                ? null
                : role.turned !== 0
                  ? "Shifted to stay apart from status colors, used"
                  : adjusted
                    ? "Adjusted for readability, used"
                    : null;
              return (
                <ColorRow
                  key={key}
                  id={key}
                  label={label}
                  chosen={draft.colors[key]}
                  fallback={brandColors[key]}
                  used={role?.used[theme] ?? null}
                  note={note}
                  onChange={(hex) => set({ colors: { ...draft.colors, [key]: hex } })}
                />
              );
            })}
          </div>
        </Row>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3.5">
        <Button id="appearance-save" disabled={!dirty || incomplete || saving} onClick={save}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          id="appearance-cancel"
          variant="ghost"
          disabled={!dirty || saving}
          onClick={() => setDraft(fromLook(saved))}
        >
          Cancel
        </Button>
        <Button
          id="appearance-reset"
          variant="outline"
          className="sm:ml-auto"
          disabled={saving || (isDefaultLook(look) && !draft.bgFile && !draft.logoFile)}
          onClick={() => setDraft(fromLook(defaultLook()))}
        >
          Reset to default
        </Button>
      </div>
    </SectionCard>
  );
}
