import { BookOpen } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { WinKind } from "@/data";
import { WinCardFrame } from "@/modules/chat/cards";
import { useCanShareWins } from "./canShareWins";

export interface WinDraft {
  on: boolean;
  title: string;
  detail: string;
}

/**
 * "Share as a win": one switch that posts the logged record to Daily wins as
 * a win card. The preview is editable (title and detail); names of prospects
 * are never put in it. Hidden for people without chat, and while Chats is off.
 */
export function ShareAsWin({
  id,
  value,
  onChange,
  winKind,
  learningTitle,
}: {
  id: string;
  value: WinDraft;
  onChange: (v: WinDraft) => void;
  winKind: WinKind;
  /** Learning posts a learning card instead of a win card. */
  learningTitle?: string;
}) {
  const canShare = useCanShareWins();
  if (!canShare) return null;
  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border border-line px-3 py-2.5"
      >
        <span>
          <span className="block text-[12.5px] font-bold">Share as a win</span>
          <span className="block text-[11px] text-muted-foreground">Posts to Daily wins</span>
        </span>
        <Switch id={id} checked={value.on} onCheckedChange={(on) => onChange({ ...value, on })} />
      </label>
      {value.on && (
        <div className="grid gap-1.5 rounded-xl border border-dashed border-line px-2.5 py-2">
          <small className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-faint">
            Preview · {learningTitle !== undefined ? "how it shows" : "you can edit it"}
          </small>
          {learningTitle !== undefined ? (
            <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] border border-line bg-surface-2 px-2.5 py-2">
              <span className="grid size-[34px] place-items-center rounded-full bg-info-soft text-info-ink">
                <BookOpen className="size-4" aria-hidden="true" />
              </span>
              <span className="truncate text-[12.5px] font-bold">
                Finished <i>{learningTitle || "…"}</i>
              </span>
            </div>
          ) : (
            <WinCardFrame winKind={winKind} title={value.title} className="py-2">
              <input
                aria-label="Win title"
                value={value.title}
                maxLength={60}
                onChange={(e) => onChange({ ...value, title: e.target.value })}
                className="w-full rounded bg-transparent text-[13px] font-extrabold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <input
                aria-label="Win detail"
                value={value.detail}
                maxLength={80}
                placeholder="Add a detail (optional)"
                onChange={(e) => onChange({ ...value, detail: e.target.value })}
                className="w-full rounded bg-transparent text-[11.5px] text-muted-foreground outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring"
              />
            </WinCardFrame>
          )}
          <p className="text-[11px] text-faint">Names of prospects stay out of the post.</p>
        </div>
      )}
    </div>
  );
}
