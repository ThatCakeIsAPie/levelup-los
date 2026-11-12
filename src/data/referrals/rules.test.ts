import { describe, expect, it } from "vitest";
import {
  REFERRAL_ASK_DAYS,
  linksFor,
  newReferralSources,
  referralError,
  referralIndex,
  referralReminders,
  referralSourcesByStep,
  referralWrites,
  referredLine,
  referrerRef,
  type RefEntry,
  type RefPerson,
  type ReferralSourceCard,
} from "./rules";

const person = (id: string, name: string, extra: Partial<RefPerson> = {}): RefPerson => ({
  id,
  name,
  bizClass: "prospect",
  ...extra,
});
const entry = (id: string, name: string, extra: Partial<RefEntry> = {}): RefEntry => ({
  id,
  name,
  ownerId: "1",
  customerId: null,
  prospectId: null,
  referredBy: null,
  referredByEntry: null,
  ...extra,
});
const P = (id: string) => ({ kind: "person" as const, id });
const E = (id: string) => ({ kind: "entry" as const, id });

describe("referrer links", () => {
  it("reads and writes the two link fields", () => {
    expect(referrerRef({ referredBy: "9" })).toEqual(P("9"));
    expect(referrerRef({ referredByEntry: "le-1" })).toEqual(E("le-1"));
    expect(referrerRef({ referredBy: null, referredByEntry: null })).toBeNull();
    expect(linksFor(P("9"))).toEqual({ referredBy: "9", referredByEntry: null });
    expect(linksFor(E("le-1"))).toEqual({ referredBy: null, referredByEntry: "le-1" });
    expect(linksFor(null)).toEqual({ referredBy: null, referredByEntry: null });
  });

  it("words the count", () => {
    expect(referredLine(0)).toBe("No names yet");
    expect(referredLine(1)).toBe("Referred 1 person");
    expect(referredLine(3)).toBe("Referred 3 people");
  });
});

describe("referralIndex", () => {
  it("links a prospect to the person who referred them, both ways", () => {
    const idx = referralIndex(
      [person("s", "Sarah Kim"), person("a", "Ann Lee", { referredBy: "s" }), person("b", "Bo")],
      [],
    );
    expect(idx.referrerOf(P("a"))?.name).toBe("Sarah Kim");
    expect(idx.referrerOf(P("b"))).toBeNull();
    expect(idx.referralsOf(P("s")).map((c) => c.name)).toEqual(["Ann Lee"]);
    expect(idx.count(P("s"))).toBe(1);
    expect(idx.count(P("a"))).toBe(0);
  });

  it("lets a name on a list refer other names and people", () => {
    const idx = referralIndex(
      [person("p1", "Tom Hale", { referredByEntry: "le-s" })],
      [entry("le-s", "Wendy Shaw"), entry("le-1", "Kara Bloom", { referredByEntry: "le-s" })],
    );
    const refs = idx.referralsOf(E("le-s"));
    expect(refs.map((c) => c.name)).toEqual(["Kara Bloom", "Tom Hale"]);
    expect(refs[0].ref).toEqual(E("le-1"));
    expect(refs[1].ref).toEqual(P("p1"));
    expect(idx.referrerOf(P("p1"))?.entryId).toBe("le-s");
  });

  it("treats a name and the people it became as one contact", () => {
    // Kara was referred on the list, then became a customer and a prospect.
    const idx = referralIndex(
      [person("s", "Sarah Kim"), person("c1", "Kara Bloom", { bizClass: "customer" })],
      [
        entry("le-k", "Kara Bloom", { customerId: "c1", prospectId: "p9", referredBy: "s" }),
        // Sarah's own name on a list: her referrals count once.
        entry("le-s", "Sarah Kim", { prospectId: "s" }),
      ],
    );
    expect(idx.referrerOf(P("c1"))?.name).toBe("Sarah Kim");
    expect(idx.referrerOf(E("le-k"))?.personId).toBe("s");
    expect(idx.count(E("le-s"))).toBe(1);
    expect(idx.count(P("s"))).toBe(1);
    const kara = idx.contact(E("le-k"))!;
    expect(kara.ref).toEqual(P("c1"));
    expect(kara.entryId).toBe("le-k");
    expect(kara.bizClass).toBe("customer");
    expect(idx.same(P("c1"), E("le-k"))).toBe(true);
    // Rows: the name first, then the people.
    expect(idx.rows(P("c1"))).toEqual([E("le-k"), P("c1")]);
  });

  it("hides referrers and referred people the viewer can't see", () => {
    // Jamal's prospect referred by Jamal's private customer: his upline sees
    // the prospect, not the customer.
    const idx = referralIndex(
      [person("9", "Carlos", { referredBy: "c8" }), person("21", "Andre", { referredBy: "9" })],
      [],
    );
    expect(idx.referrerOf(P("9"))).toBeNull();
    expect(idx.referrerOf(P("21"))?.name).toBe("Carlos");
    expect(idx.contact(P("c8"))).toBeNull();
    expect(idx.count(P("c8"))).toBe(0);
  });

  it("never counts a contact as its own referral", () => {
    const idx = referralIndex(
      [person("p", "Kim", { referredByEntry: "le-k" })],
      [entry("le-k", "Kim", { prospectId: "p" })],
    );
    expect(idx.referrerOf(P("p"))).toBeNull();
    expect(idx.count(E("le-k"))).toBe(0);
  });
});

describe("referralError", () => {
  const idx = referralIndex(
    [person("s", "Sarah"), person("p", "Kim")],
    [entry("le-k", "Kim", { prospectId: "p" })],
  );
  it("allows anyone the viewer sees", () => {
    expect(referralError(idx, P("p"), P("s"))).toBeNull();
  });
  it("refuses yourself, also through a linked name", () => {
    expect(referralError(idx, P("p"), P("p"))).toMatch(/themselves/);
    expect(referralError(idx, E("le-k"), P("p"))).toMatch(/themselves/);
  });
  it("refuses someone the viewer can't see", () => {
    expect(referralError(idx, P("p"), P("hidden"))).toMatch(/can see/);
  });
  it("refuses someone they referred", () => {
    const i2 = referralIndex([person("s", "Sarah"), person("t", "Ty", { referredBy: "s" })], []);
    expect(referralError(i2, P("s"), P("t"))).toMatch(/Ty was referred by them/);
    expect(referralError(i2, P("t"), P("s"))).toBeNull();
  });
});

describe("referralWrites", () => {
  const none = { referredBy: null, referredByEntry: null };
  it("puts the link on the first row and clears the others", () => {
    const rows = [
      { ref: E("le-k"), links: none },
      { ref: P("p"), links: { referredBy: "x", referredByEntry: null } },
    ];
    expect(referralWrites(rows, P("s"))).toEqual([
      { ref: E("le-k"), links: { referredBy: "s", referredByEntry: null } },
      { ref: P("p"), links: none },
    ]);
  });
  it("leaves rows that are already right, and clears every row for nobody", () => {
    const rows = [{ ref: P("p"), links: { referredBy: "s", referredByEntry: null } }];
    expect(referralWrites(rows, P("s"))).toEqual([]);
    expect(referralWrites(rows, null)).toEqual([{ ref: P("p"), links: none }]);
  });
});

describe("referralReminders", () => {
  const today = "2026-10-16";
  const card = (over: Partial<ReferralSourceCard>): ReferralSourceCard => ({
    board: "recruiting",
    cardId: "s",
    ref: P("s"),
    name: "Sarah Kim",
    ownerId: "1",
    column: "referral_source",
    enteredAt: "2026-10-01T15:00:00.000Z",
    personIds: ["s"],
    ...over,
  });
  const none = () => 0;

  it("asks for names after a week with nobody referred", () => {
    const r = referralReminders([card({})], "1", today, none);
    expect(r).toEqual([
      { board: "recruiting", cardId: "s", ref: P("s"), name: "Sarah Kim", days: 15 },
    ]);
  });

  it(`waits ${REFERRAL_ASK_DAYS} days`, () => {
    const fresh = card({ enteredAt: "2026-10-10T15:00:00.000Z" });
    expect(referralReminders([fresh], "1", today, none)).toEqual([]);
    const week = card({ enteredAt: "2026-10-09T15:00:00.000Z" });
    expect(referralReminders([week], "1", today, none)).toHaveLength(1);
  });

  it("stops once they referred someone", () => {
    expect(referralReminders([card({})], "1", today, () => 1)).toEqual([]);
  });

  it("only the viewer's own cards, still in the column and on the board", () => {
    expect(referralReminders([card({ ownerId: "2" })], "1", today, none)).toEqual([]);
    expect(referralReminders([card({ column: "not_interested" })], "1", today, none)).toEqual([]);
    expect(referralReminders([card({ dropped: true })], "1", today, none)).toEqual([]);
  });

  it("respects Do not contact (a name's customer or prospect included)", () => {
    const c = card({ board: "customer", cardId: "le-1", ref: E("le-1"), personIds: ["c1"] });
    expect(referralReminders([c], "1", today, none, new Set(["c1"]))).toEqual([]);
    expect(referralReminders([c], "1", today, none, new Set(["c2"]))).toHaveLength(1);
  });

  it("puts the longest waiting first", () => {
    const r = referralReminders(
      [
        card({ cardId: "a", name: "Al", enteredAt: "2026-10-08T12:00:00.000Z" }),
        card({ cardId: "b", name: "Bea", enteredAt: "2026-09-20T12:00:00.000Z" }),
      ],
      "1",
      today,
      none,
    );
    expect(r.map((x) => x.cardId)).toEqual(["b", "a"]);
  });
});

describe("conversions", () => {
  const dayOf = (iso: string) => iso.slice(0, 10);
  const move = (personId: string, to: string, day: string, ownerId = "1") => ({
    personId,
    ownerId,
    to,
    movedAt: `${day}T12:00:00.000Z`,
  });
  const reach = (personId: string, milestone: string, day: string, ownerId = "1") => ({
    personId,
    ownerId,
    milestone,
    day,
  });
  const milestones = ["contact", "first_meeting", "first_plan", "registered"];

  it("counts new referral sources once each, in the period and scope", () => {
    const moves = [
      move("a", "referral_source", "2026-10-02"),
      move("a", "contact", "2026-10-03"),
      move("a", "referral_source", "2026-10-04"),
      move("b", "referral_source", "2026-08-01"),
      move("c", "referral_source", "2026-10-05", "9"),
    ];
    expect(newReferralSources(moves, new Set(["1"]), "2026-09-01", "2026-10-16", dayOf)).toBe(1);
    expect(newReferralSources(moves, null, "2026-09-01", "2026-10-16", dayOf)).toBe(2);
  });

  it("says how many of those who stopped at a step passed on names", () => {
    const moves = [
      move("a", "referral_source", "2026-10-05"),
      move("b", "referral_source", "2026-10-06"),
      move("d", "not_interested", "2026-10-06"),
    ];
    const reaches = [
      reach("a", "contact", "2026-10-01"), // stopped after Contact: a referral source
      reach("b", "contact", "2026-10-01"),
      reach("b", "first_meeting", "2026-10-03"), // stopped after the first meeting
      reach("d", "contact", "2026-10-01"), // not interested: not counted
      reach("e", "contact", "2026-10-01"),
      reach("e", "first_meeting", "2026-10-02"),
    ];
    expect(
      referralSourcesByStep(moves, reaches, null, "2026-09-01", "2026-10-16", milestones),
    ).toEqual([1, 1, 0]);
    // Outside the period or the scope: nothing.
    expect(
      referralSourcesByStep(moves, reaches, new Set(["2"]), "2026-09-01", "2026-10-16", milestones),
    ).toEqual([0, 0, 0]);
  });
});
