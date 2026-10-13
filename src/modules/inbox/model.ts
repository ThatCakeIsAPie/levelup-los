import { useMemo } from "react";
import {
  AtSign,
  CalendarDays,
  CornerUpLeft,
  Flag,
  Megaphone,
  MessageCircle,
  SmilePlus,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import {
  canOpenPerson,
  messagePreview,
  useChatAccess,
  useChatPeople,
  useConversations,
  useEvents,
  useMessageIndex,
  useNotifications,
  useReports,
  useVisibleDrafts,
  type AnnouncementDraft,
  type Notification,
} from "@/data";

export type InboxTarget =
  | { kind: "chat"; conversationId: string; messageId?: string }
  | { kind: "person"; id: string }
  | { kind: "team" };

export interface InboxRow {
  key: string;
  /** Notification ids in this row (event answers are grouped per post). */
  ids: string[];
  type: Notification["type"];
  unread: boolean;
  createdAt: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile. */
  tone: string;
  title: string;
  sub: string;
  /** Waiting on you: a pending draft (reviewers) or an open report (leaders). */
  needsYou: boolean;
  /** A pending draft you can approve inline. */
  draft?: AnnouncementDraft;
  /** An open report to review. */
  openReport?: boolean;
  target: InboxTarget | null;
}

const TONE = {
  ann: "bg-event text-event-fg",
  flag: "bg-bad-soft text-bad",
  at: "bg-info-soft text-info-ink",
  win: "bg-warn-soft text-amber-strong",
  event: "bg-info-soft text-info-ink",
  contact: "bg-primary-soft text-primary-ink",
  neutral: "bg-surface-2 text-muted-foreground",
};

const first = (n?: string) => n?.split(" ")[0] ?? "Someone";
const quote = (s: string) => (s ? `“${s.length > 90 ? `${s.slice(0, 88)}…` : s}”` : "");

/** The current user's inbox as display rows, newest first. */
export function useInboxRows(): InboxRow[] {
  const list = useNotifications();
  const people = useChatPeople();
  const convs = useConversations();
  const messages = useMessageIndex();
  const drafts = useVisibleDrafts();
  const reports = useReports();
  const events = useEvents();
  const access = useChatAccess();

  return useMemo(() => {
    const title = new Map(convs.map((c) => [c.id, c.title]));
    const name = (id: string | null) => (id ? people.get(id)?.name : undefined);
    const chatName = (id: string | null) => (id ? (title.get(id) ?? "a chat") : "a chat");
    const preview = (id: string | null) => {
      const m = id ? messages.get(id) : undefined;
      return m ? messagePreview(m) : "";
    };

    // Group event answers by post.
    const groups = new Map<string, Notification[]>();
    const singles: Notification[] = [];
    for (const n of list) {
      if (n.type === "event_post" && n.messageId) {
        const g = groups.get(n.messageId) ?? [];
        g.push(n);
        groups.set(n.messageId, g);
      } else singles.push(n);
    }

    const rows: InboxRow[] = [];
    const chat = (n: Notification): InboxTarget | null =>
      n.conversationId
        ? { kind: "chat", conversationId: n.conversationId, messageId: n.messageId ?? undefined }
        : null;

    for (const n of singles) {
      const base = {
        key: n.id,
        ids: [n.id],
        type: n.type,
        unread: !n.readAt,
        createdAt: n.createdAt,
        needsYou: false,
        target: chat(n),
      };
      const actor = name(n.actorId);
      switch (n.type) {
        case "announcement_draft": {
          const d = drafts.find((x) => x.id === n.refId);
          const pending = d?.status === "pending" && access.canReview;
          rows.push({
            ...base,
            icon: Megaphone,
            tone: TONE.ann,
            title: `${actor ?? "Someone"} drafted an announcement`,
            sub:
              d?.status === "approved"
                ? `Approved · ${quote(d.body)}`
                : d?.status === "rejected"
                  ? `Rejected · ${quote(d.body)}`
                  : quote(d?.body ?? ""),
            needsYou: pending,
            draft: pending ? d : undefined,
          });
          break;
        }
        case "announcement_posted":
          rows.push({
            ...base,
            icon: Megaphone,
            tone: TONE.ann,
            title: n.refId
              ? "Your announcement was approved and posted"
              : `New announcement from ${first(actor)}`,
            sub: quote(preview(n.messageId)),
          });
          break;
        case "report": {
          const r = reports.find((x) => x.id === n.refId);
          const open = !!r && !r.resolvedAt;
          rows.push({
            ...base,
            icon: Flag,
            tone: TONE.flag,
            title: `A message in ${r?.conversationTitle || chatName(n.conversationId)} was reported`,
            sub: `${open ? "" : "Resolved · "}Reported for ${(r?.reason ?? "a reason").toLowerCase()} · only leaders see this`,
            needsYou: open && access.isLeader,
            openReport: open && access.isLeader,
            target: { kind: "team" },
          });
          break;
        }
        case "mention":
          rows.push({
            ...base,
            icon: AtSign,
            tone: TONE.at,
            title: `${first(actor)} mentioned you in ${chatName(n.conversationId)}`,
            sub: quote(preview(n.messageId)),
          });
          break;
        case "reply":
          rows.push({
            ...base,
            icon: CornerUpLeft,
            tone: TONE.at,
            title: `${first(actor)} replied to you in ${chatName(n.conversationId)}`,
            sub: quote(preview(n.messageId)),
          });
          break;
        case "win": {
          const m = n.messageId ? messages.get(n.messageId) : undefined;
          const card = m?.card?.type === "win" ? m.card : undefined;
          rows.push({
            ...base,
            icon: Trophy,
            tone: TONE.win,
            title: `${first(actor)} shared a win`,
            sub: [card?.title, card?.detail, chatName(n.conversationId)]
              .filter(Boolean)
              .join(" · "),
          });
          break;
        }
        case "checkin_logged":
          rows.push({
            ...base,
            icon: MessageCircle,
            tone: TONE.contact,
            title: `Check-in with ${first(actor)} logged`,
            sub: "From your conversation · counts for both of you",
            target:
              n.actorId && canOpenPerson(n.actorId) ? { kind: "person", id: n.actorId } : chat(n),
          });
          break;
        case "reaction":
          rows.push({
            ...base,
            icon: SmilePlus,
            tone: TONE.neutral,
            title: `${first(actor)} reacted ${n.refId ?? ""} to your message`,
            sub: quote(preview(n.messageId)),
          });
          break;
        default:
          break;
      }
    }

    for (const [messageId, g] of groups) {
      const n = g[0];
      const event = events.find((e) => e.id === n.refId);
      const who = g.length === 1 ? first(name(n.actorId)) : `${g.length} people`;
      rows.push({
        key: `event:${messageId}`,
        ids: g.map((x) => x.id),
        type: "event_post",
        unread: g.some((x) => !x.readAt),
        createdAt: g.reduce((a, x) => (x.createdAt > a ? x.createdAt : a), ""),
        icon: CalendarDays,
        tone: TONE.event,
        title: `${who} answered your ${event?.name ?? "event"} post`,
        sub: "From your event post",
        needsYou: false,
        target: { kind: "chat", conversationId: n.conversationId ?? "", messageId },
      });
    }

    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [list, people, convs, messages, drafts, reports, events, access]);
}
