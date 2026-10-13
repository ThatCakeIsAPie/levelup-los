import { Link } from "@tanstack/react-router";
import { Bell, MessageCircle, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/brand";
import { Button } from "@/components/ui/button";
import type { ChatAccess } from "@/data";

/**
 * Shown at /chats to people without chat (candidates and prospects): a
 * friendly explanation instead of an empty list. They still have the Inbox.
 */
export function ChatGate({ access }: { access: ChatAccess }) {
  return (
    <div className="mx-auto grid w-full max-w-2xl content-start gap-5 px-4 py-5 lg:px-[26px] lg:py-[22px]">
      <PageHeader title="Chats" logButton={false} />
      <section className="grid gap-5 overflow-hidden rounded-card border border-line bg-surface">
        <div className="grid gap-3 bg-event px-5 py-6 text-event-fg sm:px-7">
          <span className="grid size-12 place-items-center rounded-xl bg-white/10">
            <MessageCircle className="size-6" aria-hidden="true" />
          </span>
          <h2 className="text-lg font-extrabold">
            Team chats open up when you start your business
          </h2>
          <p className="max-w-prose text-[13.5px] text-event-muted">
            {access.reason === "candidate"
              ? "Chats are where apprentices, IBOs and leaders run the team day to day. Once you register and become an apprentice, you'll join the team chats automatically."
              : "Chats are for apprentices, IBOs and leaders. When you become an apprentice you'll join the team chats automatically."}
          </p>
        </div>
        <ul className="grid gap-4 px-5 pb-6 sm:px-7">
          <Point
            icon={Sparkles}
            title="What you'll get"
            body="Announcements, the Main team chat, Daily wins, High signal for important questions, and direct messages with your team."
          />
          <Point
            icon={Bell}
            title="Until then"
            body="Your sponsor keeps in touch with you directly, and anything meant for you lands in your Inbox."
          />
          <Point
            icon={ShieldCheck}
            title="Private by design"
            body="The app only records that people talked, never what they said."
          />
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4 sm:px-7">
          <Button asChild>
            <Link to="/inbox">Open Inbox</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Back to Home</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function Point({ icon: Icon, title, body }: { icon: typeof Bell; title: string; body: string }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-3">
      <span className="grid size-8 place-items-center rounded-[9px] bg-primary-soft text-primary-ink">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div>
        <p className="text-[13.5px] font-bold">{title}</p>
        <p className="text-[13px] text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
