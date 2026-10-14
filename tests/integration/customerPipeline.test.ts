/**
 * Your list and the customer pipeline against the local database: what each
 * role loads, list edits written through, moves going through
 * move_customer_card() (First sale makes the customer, On Ditto marks them),
 * undo, an upline working a downline's list, a crossline kept out, and a name
 * put on the recruiting pipeline too. Needs the local stack running and
 * seeded (`npm run db:reset`); cleans up after itself.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IS_SUPABASE } from "@/lib/config";
import { getSupabase } from "@/lib/supabase";
import { refreshAccount, signOut } from "@/modules/login/auth";
import { useSessionStore } from "@/stores/sessionStore";
import { usePeopleStore } from "@/stores/peopleStore";
import { useCustomerPipelineStore } from "@/data/customerPipeline/store";
import {
  addEntryToRecruiting,
  addListEntry,
  logSale,
  moveCustomerCard,
  removeListEntry,
  updateListEntry,
} from "@/data";
import { useRemoteStore, whenIdle } from "@/data/remote";
import { fetchCustomerPipeline } from "@/data/remote/hydrate";
import { adminClient, must } from "./admin";

const PASSWORD = "levelup-local";
const URL_ = import.meta.env.VITE_SUPABASE_URL as string;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const stamp = Date.now().toString(36);
type Who = "maria" | "anita" | "jamal" | "beau";

const clients: SupabaseClient[] = [];
const cleanup: (() => PromiseLike<unknown>)[] = [];

async function login(name: Who): Promise<SupabaseClient> {
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

async function signInApp(name: Who): Promise<void> {
  await signOut();
  const { error } = await getSupabase().auth.signInWithPassword({
    email: `${name}@levelup.test`,
    password: PASSWORD,
  });
  if (error) throw error;
  await refreshAccount();
  expect(useSessionStore.getState().status).toBe("ready");
  expect(useRemoteStore.getState().phase).toBe("ready");
}

async function cardColumn(c: SupabaseClient, entryId: string) {
  const { data } = await c
    .from("customer_cards")
    .select("column_id")
    .eq("entry_id", entryId)
    .maybeSingle();
  return data?.column_id ?? null;
}

/** Leaves nothing behind: the moves (kept after an entry goes) and activity a test caused. */
function cleanUpEntry(entryId: string, customerIds: () => string[] = () => []) {
  const admin = adminClient();
  cleanup.push(
    () => must(admin.from("customer_moves").delete().eq("entry_id", entryId), "customer moves"),
    () => must(admin.from("list_entries").delete().eq("id", entryId), "list entry"),
    async () => {
      for (const id of customerIds()) {
        await must(admin.from("people").delete().eq("id", id), "customer");
        await must(admin.from("activity").delete().eq("related_person_id", id), "activity");
      }
    },
  );
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
  await signOut();
  await Promise.all(clients.map((c) => c.auth.signOut({ scope: "local" })));
});

describe("what each person loads", () => {
  it("Jamal: his list and Tasha's, his line's steps; not his upline's or a crossline's", async () => {
    const d = await fetchCustomerPipeline(await login("jamal"));
    expect(new Set(d.entries.map((e) => e.ownerId))).toEqual(new Set(["4", "700"]));
    expect(d.steps.map((s) => s.id).sort()).toEqual(["cs-pm2", "cs-sampled", "cs-sbox"]);
    expect(
      d.cards.every((c) => c.entryId.startsWith("le-4-") || c.entryId.startsWith("le-700-")),
    ).toBe(true);
    expect(new Set(d.moves.map((m) => m.ownerId))).toEqual(new Set(["4", "700"]));
    // Tasha's customer stays private, but the name and its link show.
    expect(d.entries.find((e) => e.id === "le-700-20")?.customerId).toBe("c11");
  });

  it("Beau (candidate): no list at all", async () => {
    const d = await fetchCustomerPipeline(await login("beau"));
    expect(d.entries).toHaveLength(0);
    expect(d.cards).toHaveLength(0);
    expect(d.moves).toHaveLength(0);
    expect(d.steps).toHaveLength(0);
  });

  it("signing in fills the store", async () => {
    await signInApp("jamal");
    const s = useCustomerPipelineStore.getState();
    expect(s.entries.some((e) => e.id === "le-700-1")).toBe(true);
    expect(s.steps).toHaveLength(3);
  });
});

describe("an upline working a downline's list", () => {
  it("Jamal adds a name to Tasha's list, moves it to First sale and undoes it", async () => {
    await signInApp("jamal");
    const jamal = await login("jamal");
    const admin = adminClient();
    const r = addListEntry({ ownerId: "700", name: `List Test ${stamp}`, howKnown: "Gym" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.entry.id;
    let customer: string | null = null;
    cleanUpEntry(id, () => (customer ? [customer] : []));
    await whenIdle();
    const row = await jamal.from("list_entries").select("owner_id, added_by").eq("id", id).single();
    expect(row.data).toEqual({ owner_id: "700", added_by: "4" });

    expect(updateListEntry(id, { rating: "hot" })).toEqual({ ok: true });
    await whenIdle();
    const hot = await jamal.from("list_entries").select("rating").eq("id", id).single();
    expect(hot.data?.rating).toBe("hot");

    const start = moveCustomerCard(id, "contact");
    expect(start.ok).toBe(true);
    await whenIdle();
    expect(await cardColumn(jamal, id)).toBe("contact");

    const sale = moveCustomerCard(id, "first_sale");
    expect(sale.ok && sale.becameCustomer).toBe(true);
    if (!sale.ok) return;
    customer = sale.customerId;
    await whenIdle();
    expect(await cardColumn(jamal, id)).toBe("first_sale");
    // The customer is Tasha's: private to her, so only the service role reads it.
    const person = await admin
      .from("people")
      .select("biz_class, owner_id, name")
      .eq("id", customer!)
      .single();
    expect(person.data).toEqual({
      biz_class: "customer",
      owner_id: "700",
      name: `List Test ${stamp}`,
    });
    expect((await jamal.from("people").select("id").eq("id", customer!)).data).toHaveLength(0);
    const linked = await jamal.from("list_entries").select("customer_id").eq("id", id).single();
    expect(linked.data?.customer_id).toBe(customer);

    sale.undo();
    await whenIdle();
    expect(await cardColumn(jamal, id)).toBe("contact");
    expect((await admin.from("people").select("id").eq("id", customer!)).data).toHaveLength(0);
    const unlinked = await jamal.from("list_entries").select("customer_id").eq("id", id).single();
    expect(unlinked.data?.customer_id).toBeNull();

    start.undo();
    await whenIdle();
    expect(await cardColumn(jamal, id)).toBeNull();

    removeListEntry(id);
    await whenIdle();
    expect((await jamal.from("list_entries").select("id").eq("id", id)).data).toHaveLength(0);
  });
});

describe("your own list", () => {
  it("Anita's first sale: her customer, a sale logged, On Ditto; undo takes it all back", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const r = addListEntry({ name: `Own Test ${stamp}`, phone: "555-0199" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.entry.id;
    let customer: string | null = null;
    cleanUpEntry(id, () => (customer ? [customer] : []));

    const sale = moveCustomerCard(id, "first_sale");
    expect(sale.ok && sale.becameCustomer).toBe(true);
    if (!sale.ok) return;
    customer = sale.customerId!;
    // The app shows the customer at once; the database makes it.
    expect(usePeopleStore.getState().people.find((p) => p.id === customer)?.ownerId).toBe("2");
    await whenIdle();
    const person = await anita
      .from("people")
      .select("biz_class, phone")
      .eq("id", customer)
      .single();
    expect(person.data).toEqual({ biz_class: "customer", phone: "555-0199" });

    const logged = logSale({ customerId: customer, product: "Nutrilite" });
    await whenIdle();
    expect((await anita.from("sales").select("id").eq("id", logged.id)).data).toHaveLength(1);

    const ditto = moveCustomerCard(id, "on_ditto");
    expect(ditto.ok && ditto.setDitto).toBe(true);
    if (!ditto.ok) return;
    await whenIdle();
    const on = await anita.from("people").select("ditto_since").eq("id", customer).single();
    expect(on.data?.ditto_since).toBeTruthy();

    ditto.undo();
    await whenIdle();
    const off = await anita.from("people").select("ditto_since").eq("id", customer).single();
    expect(off.data?.ditto_since).toBeNull();
    expect(usePeopleStore.getState().people.find((p) => p.id === customer)?.dittoSince).toBeFalsy();

    sale.undo();
    await whenIdle();
    expect((await anita.from("people").select("id").eq("id", customer)).data).toHaveLength(0);
    expect((await anita.from("sales").select("id").eq("id", logged.id)).data).toHaveLength(0);
    expect(usePeopleStore.getState().people.some((p) => p.id === customer)).toBe(false);
    expect(await cardColumn(anita, id)).toBeNull();
  });

  it("a name can go on the recruiting pipeline too", async () => {
    await signInApp("anita");
    const anita = await login("anita");
    const r = addListEntry({ name: `Both Test ${stamp}` });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const id = r.entry.id;
    cleanUpEntry(id);
    await whenIdle();
    const rec = addEntryToRecruiting(id);
    expect(rec).toBeTruthy();
    const prospect = rec!.person.id;
    const admin = adminClient();
    cleanup.push(
      () => must(admin.from("activity").delete().eq("related_person_id", prospect), "activity"),
      () => must(admin.from("pipeline_moves").delete().eq("person_id", prospect), "moves"),
    );
    await whenIdle();
    const p = await anita
      .from("people")
      .select("biz_class, sponsor_id")
      .eq("id", prospect)
      .single();
    expect(p.data).toEqual({ biz_class: "prospect", sponsor_id: "2" });
    const link = await anita.from("list_entries").select("prospect_id").eq("id", id).single();
    expect(link.data?.prospect_id).toBe(prospect);
    rec!.undo();
    await whenIdle();
    expect((await anita.from("people").select("id").eq("id", prospect)).data).toHaveLength(0);
  });
});

describe("crosslines", () => {
  it("Anita can't read or move David's list", async () => {
    const anita = await login("anita");
    const read = await anita.from("list_entries").select("id").eq("owner_id", "3");
    expect(read.data).toHaveLength(0);
    const moved = await anita.rpc("move_customer_card", { p_entry_id: "le-3-1", p_to: "contact" });
    expect(moved.error?.code).toBe("P0002");
    const added = await anita.from("list_entries").insert({ owner_id: "3", name: "Sneaky" });
    expect(added.error?.code).toBe("42501");
  });
});
