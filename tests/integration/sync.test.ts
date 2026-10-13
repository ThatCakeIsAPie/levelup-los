/**
 * The app against the local database: what each person loads, write-through,
 * rollback, realtime, the check-in trigger, chat media and announcement
 * approval. Needs the local stack running and seeded (`npm run db:reset`).
 *
 * The app's own client (src/lib/supabase.ts) runs the real session path
 * (sign in -> refreshAccount -> load -> sync); other people are separate
 * supabase-js clients signed in with their demo logins.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useChatStore } from "@/data/chat/store";
import {
  addEvent,
  approveDraft,
  assignToEvent,
  getPerson,
  logContact,
  pinConversation,
  removeContact,
  removeEvent,
  saveAttachment,
  sendMessage,
  unpinConversation,
  updateAttendance,
  updatePerson,
} from "@/data";
import { useRemoteStore, whenIdle } from "@/data/remote";
import { fetchSnapshot } from "@/data/remote/hydrate";
import { subscribeChanges, type LiveChange } from "@/data/remote/realtime";
import { signedUrl } from "@/data/remote/storage";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);

const clients: SupabaseClient[] = [];
const stops: (() => void)[] = [];
/** Undo steps, run after all tests so the seed stays as `npm run db:test` expects. */
const cleanup: (() => PromiseLike<unknown>)[] = [];
const startedAt = new Date().toISOString();

/** A separate signed-in client for one demo user. */
async function login(name: "maria" | "anita" | "jamal" | "beau"): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await c.auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  clients.push(c);
  return c;
}

/** Sign the app itself in (full session path: get_session, load, sync, realtime). */
async function signInApp(name: "maria" | "anita" | "jamal" | "beau"): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
}

/** Poll until `fn` returns something truthy. */
async function until<T>(fn: () => T | Promise<T>, what: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as NonNullable<T>;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Follow the live tables as one person; resolves once subscribed. */
async function follow(c: SupabaseClient, name: string): Promise<LiveChange[]> {
  const seen: LiveChange[] = [];
  await new Promise<void>((resolve, reject) => {
    const stop = subscribeChanges(c, `it-${name}-${stamp}`, {
      onChange: (ch) => seen.push(ch),
      onSubscribed: () => resolve(),
      onError: (status, err) => reject(err ?? new Error(status)),
    });
    stops.push(stop);
  });
  return seen;
}

beforeAll(() => {
  expect(IS_SUPABASE).toBe(true);
});

afterAll(async () => {
  for (const step of cleanup.reverse()) {
    try {
      await step();
    } catch (e) {
      console.warn("[integration cleanup]", e);
    }
  }
  stops.forEach((s) => s());
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
  getSupabase().removeAllChannels();
  clients.forEach((c) => c.removeAllChannels());
});

describe("loading what each person may see", () => {
  it("Jamal loads himself, his downline and his own customer: 19 people", async () => {
    const snap = await fetchSnapshot(await login("jamal"), "4");
    const ids = new Set(snap.crm.people.map((p) => p.id));
    expect(snap.crm.people).toHaveLength(19);
    expect(ids.has("4")).toBe(true);
    expect(ids.has("1")).toBe(false); // not his upline
    const customers = snap.crm.people.filter((p) => p.bizClass === "customer");
    expect(customers.map((c) => c.ownerId)).toEqual(["4"]);
    expect(snap.crm.attendances.every((a) => ids.has(a.personId))).toBe(true);
    expect(snap.crm.events.length).toBeGreaterThan(0);
    // Chat: his conversations, and names for authors outside his CRM view.
    expect(snap.chat.conversations.length).toBe(6);
    expect(snap.directory.some((d) => d.personId === "1" && d.name === "Maria Reyes")).toBe(true);
  });

  it("Beau (a candidate) loads only himself and no chat", async () => {
    const snap = await fetchSnapshot(await login("beau"), "20");
    expect(snap.crm.people.map((p) => p.id)).toEqual(["20"]);
    expect(snap.chat.conversations).toHaveLength(0);
    expect(snap.chat.messages).toHaveLength(0);
    expect(snap.directory).toHaveLength(0);
    expect(snap.crm.events.length).toBeGreaterThan(0); // everyone sees the event list
  });

  it("signing in fills the stores before the app is ready", async () => {
    await signInApp("jamal");
    expect(useRemoteStore.getState().phase).toBe("ready");
    expect(usePeopleStore.getState().people).toHaveLength(19);
    expect(getPerson("4")?.name).toBe("Jamal Brown");
    expect(useChatStore.getState().conversations.length).toBe(6);
  });
});

describe("write-through", () => {
  it("CRM changes reach the database and deletes cascade", async () => {
    await signInApp("maria");
    const maria = await login("maria");
    const original = await maria.from("people").select("notes").eq("id", "9").single();
    cleanup.push(() =>
      maria
        .from("people")
        .update({ notes: original.data?.notes ?? null })
        .eq("id", "9"),
    );

    const ev = addEvent({ name: `IT meeting ${stamp}`, type: "team_meeting", date: "2026-12-01" });
    const att = assignToEvent(ev.id, "4");
    updateAttendance(att.id, { hasTicket: true, desireToAttend: "yes" });
    const contact = logContact({ personId: "2", note: `IT ${stamp}` });
    updatePerson("9", { notes: `IT note ${stamp}` });
    await whenIdle();

    const event = await maria.from("events").select("name").eq("id", ev.id).single();
    expect(event.data?.name).toBe(`IT meeting ${stamp}`);
    const row = await maria
      .from("attendances")
      .select("has_ticket, desire_to_attend")
      .eq("id", att.id)
      .single();
    expect(row.data).toEqual({ has_ticket: true, desire_to_attend: "yes" });
    const saved = await maria
      .from("contacts")
      .select("by_id, source")
      .eq("id", contact.id)
      .single();
    expect(saved.data).toEqual({ by_id: "1", source: "manual" });
    const person = await maria.from("people").select("notes").eq("id", "9").single();
    expect(person.data?.notes).toBe(`IT note ${stamp}`);
    const log = await maria.from("activity").select("kind").eq("related_event_id", ev.id);
    expect(log.data?.map((a) => a.kind)).toEqual(
      expect.arrayContaining(["created", "assigned_event", "ticket_purchased"]),
    );

    removeEvent(ev.id);
    removeContact(contact.id);
    await whenIdle();
    const gone = await maria.from("attendances").select("id").eq("id", att.id);
    expect(gone.data).toHaveLength(0); // by foreign-key cascade
    const noEvent = await maria.from("events").select("id").eq("id", ev.id);
    expect(noEvent.data).toHaveLength(0);
    const noContact = await maria.from("contacts").select("id").eq("id", contact.id);
    expect(noContact.data).toHaveLength(0);
  });

  it("a write the database refuses is rolled back in the store", async () => {
    await signInApp("jamal");
    const before = getPerson("4")?.sponsorId;
    updatePerson("4", { sponsorId: "9" }); // nobody re-sponsors themselves
    expect(getPerson("4")?.sponsorId).toBe("9"); // optimistic
    await whenIdle();
    expect(getPerson("4")?.sponsorId).toBe(before);
    const row = await (
      await login("jamal")
    )
      .from("people")
      .select("sponsor_id")
      .eq("id", "4")
      .single();
    expect(row.data?.sponsor_id).toBe(before);
  });
});

describe("chat", () => {
  it("chat pins are personal: Maria's pins are saved for her only", async () => {
    await signInApp("maria");
    const maria = await login("maria");
    const anita = await login("anita");
    const pinnedAt = async (c: SupabaseClient, conv: string, person: string) =>
      (
        await c
          .from("conversation_members")
          .select("pinned_at")
          .eq("conversation_id", conv)
          .eq("person_id", person)
          .single()
      ).data?.pinned_at ?? null;
    const mainBefore = await pinnedAt(maria, "main", "1");
    expect(mainBefore).not.toBeNull(); // team chats start pinned
    cleanup.push(() =>
      maria
        .from("conversation_members")
        .update({ pinned_at: mainBefore })
        .match({ conversation_id: "main", person_id: "1" }),
    );
    cleanup.push(() =>
      maria
        .from("conversation_members")
        .update({ pinned_at: null })
        .match({ conversation_id: "carpool", person_id: "1" }),
    );

    expect(pinConversation("carpool")).toEqual({ ok: true });
    expect(unpinConversation("main")).toBe(true);
    await whenIdle();
    expect(await pinnedAt(maria, "carpool", "1")).not.toBeNull();
    expect(await pinnedAt(maria, "main", "1")).toBeNull();
    expect(await pinnedAt(anita, "carpool", "2")).toBeNull();
    expect(await pinnedAt(anita, "main", "2")).not.toBeNull();
    // The store kept the change (nothing was rolled back).
    const mine = useChatStore
      .getState()
      .conversationMembers.find((m) => m.conversationId === "carpool" && m.personId === "1");
    expect(mine?.pinnedAt).not.toBeNull();
  });

  it("a message sent by Maria reaches Anita live, and Anita's reaches Maria's app", async () => {
    const anita = await login("anita");
    const seenByAnita = await follow(anita, "anita");
    await signInApp("maria");

    const sent = sendMessage({ conversationId: "main", body: `Hello team ${stamp}` });
    expect(sent).not.toBeNull();
    const maria = await login("maria");
    cleanup.push(() => maria.from("messages").delete().eq("id", sent!.message.id));
    await whenIdle();
    const got = await until(
      () => seenByAnita.find((c) => c.table === "messages" && c.row?.id === sent!.message.id),
      "Anita to receive Maria's message",
    );
    expect(got.row?.author_id).toBe("1");

    // The other way: Anita posts; Maria's app merges it into the chat store.
    const id = `it-a-${stamp}`;
    cleanup.push(() => anita.from("messages").delete().eq("id", id));
    const { error } = await anita
      .from("messages")
      .insert({ id, conversation_id: "main", body: `Hi Maria ${stamp}` });
    expect(error).toBeNull();
    const merged = await until(
      () => useChatStore.getState().messages.find((m) => m.id === id),
      "Maria's app to merge Anita's message",
    );
    expect(merged.authorId).toBe("2");
  });

  it("a DM in both directions logs a check-in for both people (database trigger)", async () => {
    const maria = await login("maria");
    const anita = await login("anita");
    const pair = "and(person_id.eq.2,by_id.eq.1),and(person_id.eq.1,by_id.eq.2)";
    // At most one check-in per pair per day: clear today's so the test can repeat.
    await maria.from("contacts").delete().eq("source", "message").or(pair);

    const a = await anita
      .from("messages")
      .insert({ conversation_id: "dm-1-2", body: "Got a minute?" })
      .select("id")
      .single();
    expect(a.error).toBeNull();
    const m = await maria
      .from("messages")
      .insert({ conversation_id: "dm-1-2", body: "Sure, call me" })
      .select("id")
      .single();
    expect(m.error).toBeNull();
    cleanup.push(
      () => anita.from("messages").delete().eq("id", a.data!.id),
      () => maria.from("messages").delete().eq("id", m.data!.id),
      () =>
        maria
          .from("contacts")
          .delete()
          .eq("source", "message")
          .or(pair)
          .gte("created_at", startedAt),
    );

    const contacts = await maria
      .from("contacts")
      .select("person_id, by_id, source")
      .eq("source", "message")
      .or(pair);
    expect(contacts.data).toHaveLength(2);
    const notes = await maria
      .from("notifications")
      .select("actor_id")
      .eq("type", "checkin_logged")
      .eq("conversation_id", "dm-1-2")
      .order("created_at", { ascending: false })
      .limit(1);
    expect(notes.data?.[0]?.actor_id).toBe("2");
  });

  it("a photo goes to the chat-media bucket and is read through a signed URL", async () => {
    await signInApp("maria");
    // A 1x1 PNG.
    const bytes = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      ),
      (ch) => ch.charCodeAt(0),
    );
    const png = new Blob([bytes], { type: "image/png" });
    const { storagePath } = await saveAttachment(png);
    expect(storagePath.startsWith("pending:")).toBe(true);
    const sent = sendMessage({
      conversationId: "main",
      attachments: [
        { kind: "image", storagePath, mime: "image/png", size: png.size, width: 1, height: 1 },
      ],
    });
    expect(sent).not.toBeNull();
    const uploaded = await until(
      () =>
        useChatStore
          .getState()
          .attachments.find(
            (a) => a.messageId === sent!.message.id && !a.storagePath.startsWith("pending:"),
          ),
      "the upload",
    );
    expect(uploaded.storagePath).toMatch(/^main\/[0-9a-f-]{36}\.png$/);
    await whenIdle();
    const maria = await login("maria");
    cleanup.push(
      () => maria.from("messages").delete().eq("id", sent!.message.id),
      () => maria.storage.from("chat-media").remove([uploaded.storagePath]),
    );

    const jamal = await login("jamal");
    const row = await until(
      async () =>
        (await jamal.from("attachments").select("storage_path").eq("message_id", sent!.message.id))
          .data?.[0],
      "the attachment row",
    );
    expect(row.storage_path).toBe(uploaded.storagePath);
    const url = await signedUrl(jamal, uploaded.storagePath);
    expect(url).toBeTruthy();
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    // Not in the chat: no URL.
    expect(await signedUrl(await login("beau"), uploaded.storagePath)).toBeNull();
  });

  it("approving an announcement posts it as the author and tells them", async () => {
    const jamal = await login("jamal");
    const draftId = `it-draft-${stamp}`;
    const { error } = await jamal
      .from("announcement_drafts")
      .insert({ id: draftId, conversation_id: "announcements", body: `Bowling Friday ${stamp}` });
    expect(error).toBeNull();
    const seenByJamal = await follow(jamal, "jamal");
    const leader = await login("maria");
    cleanup.push(() => leader.from("announcement_drafts").delete().eq("id", draftId));

    await signInApp("maria");
    const posted = approveDraft(draftId);
    expect(posted?.authorId).toBe("4");
    cleanup.push(() => jamal.from("messages").delete().eq("id", posted!.id));

    const maria = await login("maria");
    const message = await until(
      async () =>
        (await maria.from("messages").select("author_id, body").eq("id", posted!.id)).data?.[0],
      "the approved post",
    );
    expect(message).toEqual({ author_id: "4", body: `Bowling Friday ${stamp}` });
    const draft = await maria
      .from("announcement_drafts")
      .select("status, reviewer_id")
      .eq("id", draftId)
      .single();
    expect(draft.data).toEqual({ status: "approved", reviewer_id: "1" });
    const told = await until(
      () =>
        seenByJamal.find(
          (c) =>
            c.table === "notifications" &&
            c.row?.type === "announcement_posted" &&
            c.row?.ref_id === draftId,
        ),
      "Jamal's 'your announcement was posted' notification",
    );
    expect(told.row?.message_id).toBe(posted!.id);
  });
});
