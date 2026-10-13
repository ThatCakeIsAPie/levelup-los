import { describe, expect, it } from "vitest";
import { invoicesFor, splitCost, type SharedCost } from "@/stores/opsStore";
import { seedOps, seedPeople } from "./seed";
import { opsWithoutEvent, opsWithoutPerson, rosterWithout, type OpsData } from "./cascade";
import { downlineIds } from "./access";

const people = seedPeople();

describe("rosterWithout", () => {
  it("moves the direct downline and owned customers to the removed person's sponsor", () => {
    // Jamal (4) is sponsored by Anita (2); 9 and 21 are his, c8 is his customer.
    const r = rosterWithout(people, "4");
    const byId = new Map(r.people.map((p) => [p.id, p]));
    expect(byId.has("4")).toBe(false);
    expect(r.heirId).toBe("2");
    expect(byId.get("9")?.sponsorId).toBe("2");
    expect(byId.get("21")?.sponsorId).toBe("2");
    expect(byId.get("c8")?.ownerId).toBe("2");
    expect(r.moved).toEqual(expect.arrayContaining(["9", "21"]));
    expect(r.reassigned).toEqual(["c8"]);
  });

  it("keeps everyone below the removed person in their upline's downline", () => {
    const before = downlineIds(people, "2");
    const after = downlineIds(rosterWithout(people, "4").people, "2");
    before.delete("4");
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("leaves people untouched when the id is unknown", () => {
    const r = rosterWithout(people, "nobody");
    expect(r.people).toBe(people);
    expect(r.removed).toBeUndefined();
  });

  it("removing a customer moves nobody", () => {
    const r = rosterWithout(people, "c8");
    expect(r.moved).toEqual([]);
    expect(r.reassigned).toEqual([]);
    expect(r.people).toHaveLength(people.length - 1);
  });
});

const cost = (o: Partial<SharedCost> = {}): SharedCost => ({
  id: "k1",
  eventId: "e1",
  name: "Van",
  total: 600,
  ownerId: "1",
  members: ["1", "2", "4"],
  overrides: {},
  ...o,
});

describe("opsWithoutPerson", () => {
  const ops: OpsData = {
    ...seedOps(),
    costs: [cost({ ownerId: "4", overrides: { "4": 100 } }), cost({ id: "k2", eventId: "e5" })],
    payments: {
      "k1:4": { paidAt: "x", ref: "r", amount: 100 },
      "k1:2": { paidAt: "x", ref: "r" },
    },
  };

  it("drops their travel plans, memberships, overrides and payments", () => {
    const out = opsWithoutPerson(ops, "4", "2");
    expect(Object.keys(out.logistics).some((k) => k.endsWith(":4"))).toBe(false);
    expect(out.logistics["e1:2"]).toBeDefined();
    expect(out.costs.every((c) => !c.members.includes("4") && !("4" in c.overrides))).toBe(true);
    expect(Object.keys(out.payments)).toEqual(["k1:2"]);
  });

  it("hands costs they organized to the heir without opting the heir in", () => {
    const out = opsWithoutPerson(ops, "4", "2");
    expect(out.costs[0].ownerId).toBe("2");
    expect(out.costs[0].members).toEqual(["1", "2"]);
    expect(out.costs[1].ownerId).toBe("1");
  });
});

describe("opsWithoutEvent", () => {
  it("drops the event's travel plans, shared costs and their payments", () => {
    const ops: OpsData = {
      ...seedOps(),
      logistics: {
        ...seedOps().logistics,
        "e5:1": { ticket: "bought", mode: "drive", carpool: "solo" },
      },
      costs: [cost(), cost({ id: "k2", eventId: "e5" })],
      payments: { "k1:1": { paidAt: "x", ref: "r" }, "k2:1": { paidAt: "x", ref: "r" } },
    };
    const out = opsWithoutEvent(ops, "e1");
    expect(Object.keys(out.logistics)).toEqual(["e5:1"]);
    expect(out.costs.map((c) => c.id)).toEqual(["k2"]);
    expect(Object.keys(out.payments)).toEqual(["k2:1"]);
  });
});

describe("shared cost payments", () => {
  it("paid members keep the amount they paid; the rest split what's left", () => {
    const c = cost({ members: ["1", "2", "4", "7"] });
    expect(splitCost(c, { "4": 200 })).toEqual({ "1": 133.33, "2": 133.33, "4": 200, "7": 133.33 });
  });

  it("an invoice shows the stored paid amount and name even after shares change", () => {
    const c = cost({ name: "Team van (updated)", overrides: { "4": 50 } });
    const payments = { "k1:4": { paidAt: "x", ref: "r", amount: 200, costName: "Team van" } };
    const [paid] = invoicesFor([c], payments, "4");
    expect(paid).toMatchObject({ status: "paid", amount: 200, costName: "Team van" });
    const [owed] = invoicesFor([c], payments, "2");
    expect(owed).toMatchObject({ status: "owed", amount: 200 });
  });
});
