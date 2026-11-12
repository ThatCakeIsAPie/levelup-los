import type { ComponentType, ReactNode } from "react";
import { toast } from "sonner";
import { Copy, Mail, MessageSquare, MoreHorizontal, Pencil, Phone, Trash2 } from "lucide-react";
import { useNextEvent, type BizClass, type CrmPerson } from "@/data";
import { PersonAvatar } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { phoneHref } from "@/lib/phone";
import { firstName, fmtDate } from "./format";

type Icon = ComponentType<{ className?: string }>;

/** A primary/secondary action that isn't a contact link (Check in, Log sale...). */
export interface HeroAction {
  label: string;
  icon: Icon;
  onClick: () => void;
  primary?: boolean;
  /** Shorter label for the phone quick-action row. */
  short?: string;
}

/**
 * Profile hero: stage-colored avatar, name + chips, meta line, and actions
 * (buttons on the right on desktop, an icon row under the hero on phones).
 */
export function ProfileHero({
  person,
  stage,
  chips,
  meta,
  phoneSub,
  contact,
  actions,
  onEditDetails,
  onDelete,
  isDesktop,
}: {
  person: CrmPerson;
  stage: BizClass;
  chips: ReactNode;
  meta: { icon: Icon; content: ReactNode; key: string }[];
  /** One short line under the name on phones (e.g. "under Anita Patel"). */
  phoneSub?: ReactNode;
  /** Show Call / Text / Email. */
  contact: boolean;
  actions: HeroAction[];
  onEditDetails?: () => void;
  /** Adds "Delete person" to the ⋯ menu (it opens the confirmation). */
  onDelete?: () => void;
  isDesktop: boolean;
}) {
  const more = <MoreMenu person={person} onEditDetails={onEditDetails} onDelete={onDelete} />;

  if (!isDesktop) {
    return (
      <div className="grid gap-3">
        <div className="flex items-center gap-3">
          <PersonAvatar name={person.name} stage={stage} size="xl" className="size-14 text-lg" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-[19px] font-extrabold leading-tight">{person.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-faint">
              {chips}
              {phoneSub}
            </div>
          </div>
          {more}
        </div>
        {contact ? (
          <QuickRow person={person} contact={contact} actions={actions} />
        ) : (
          actions.map((a) => (
            <Button key={a.label} variant="soft" className="w-full" onClick={a.onClick}>
              <a.icon /> {a.label}
            </Button>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[18px]">
      <PersonAvatar name={person.name} stage={stage} size="xl" />
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-2xl font-extrabold leading-tight">
          <span className="break-words">{person.name}</span>
          {chips}
        </h1>
        {meta.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted-foreground">
            {meta.map(({ icon: I, content, key }) => (
              <span key={key} className="inline-flex min-w-0 items-center gap-1.5">
                <I className="size-4 shrink-0" aria-hidden="true" />
                {content}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {contact && <ContactButtons person={person} />}
        {actions.map((a) => (
          <Button
            key={a.label}
            variant={a.primary ? "default" : "outline"}
            size="sm"
            onClick={a.onClick}
          >
            <a.icon /> {a.label}
          </Button>
        ))}
        {more}
      </div>
    </div>
  );
}

function contactLinks(p: CrmPerson) {
  return [
    {
      label: "Call",
      icon: Phone,
      href: p.phone ? `tel:${phoneHref(p.phone)}` : undefined,
      missing: "No phone number on file",
    },
    {
      label: "Text",
      icon: MessageSquare,
      href: p.phone ? `sms:${phoneHref(p.phone)}` : undefined,
      missing: "No phone number on file",
    },
    {
      label: "Email",
      icon: Mail,
      href: p.email ? `mailto:${p.email}` : undefined,
      missing: "No email on file",
    },
  ];
}

function ContactButtons({ person }: { person: CrmPerson }) {
  return (
    <>
      {contactLinks(person).map((c) =>
        c.href ? (
          <Button key={c.label} asChild variant="outline" size="sm">
            <a href={c.href}>
              <c.icon /> {c.label}
            </a>
          </Button>
        ) : (
          <Tooltip key={c.label}>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                aria-disabled="true"
                className="cursor-not-allowed opacity-50 active:scale-100"
                onClick={(e) => e.preventDefault()}
              >
                <c.icon /> {c.label}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{c.missing}</TooltipContent>
          </Tooltip>
        ),
      )}
    </>
  );
}

const TILE =
  "grid size-[42px] place-items-center rounded-xl border border-line bg-card text-foreground [&_svg]:size-[18px]";

function QuickRow({
  person,
  contact,
  actions,
}: {
  person: CrmPerson;
  contact: boolean;
  actions: HeroAction[];
}) {
  const links = contact ? contactLinks(person) : [];
  const count = links.length + actions.length;
  const itemCls =
    "group grid justify-items-center gap-1 rounded-xl text-[11px] font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {links.map((c) =>
        c.href ? (
          <a key={c.label} href={c.href} className={itemCls}>
            <span className={TILE}>
              <c.icon />
            </span>
            {c.label}
          </a>
        ) : (
          <button
            key={c.label}
            type="button"
            aria-disabled="true"
            className={cn(itemCls, "cursor-not-allowed opacity-50")}
            onClick={() => toast(c.missing)}
          >
            <span className={TILE}>
              <c.icon />
            </span>
            {c.label}
          </button>
        ),
      )}
      {actions.map((a) => (
        <button key={a.label} type="button" onClick={a.onClick} className={itemCls}>
          <span
            className={cn(TILE, a.primary && "border-primary bg-primary text-primary-foreground")}
          >
            <a.icon />
          </span>
          {a.short ?? a.label}
        </button>
      ))}
    </div>
  );
}

function MoreMenu({
  person,
  onEditDetails,
  onDelete,
}: {
  person: CrmPerson;
  onEditDetails?: () => void;
  onDelete?: () => void;
}) {
  const next = useNextEvent();
  const script = next
    ? `Hi ${firstName(person.name)}, quick note about ${next.name} on ${fmtDate(next.date)}. I want to make sure you're in the loop. Got a minute to chat?`
    : `Hi ${firstName(person.name)}, just checking in. Got a minute to chat this week?`;
  const copy = () => {
    const done = () => toast.success("Follow-up message copied", { description: script });
    const fail = () => toast.error("Couldn't copy. Your browser blocked the clipboard.");
    try {
      navigator.clipboard.writeText(script).then(done, fail);
    } catch {
      fail();
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="size-8 shrink-0" aria-label="More actions">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={copy}>
          <Copy /> Copy follow-up message
        </DropdownMenuItem>
        {onEditDetails && (
          <DropdownMenuItem onSelect={onEditDetails}>
            <Pencil /> Edit details
          </DropdownMenuItem>
        )}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:bg-bad-soft focus:text-destructive [&_svg]:text-destructive"
            >
              <Trash2 /> Delete person
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
