import { describe, expect, it } from "vitest";
import type { CrmPerson } from "@/stores/peopleStore";
import type { PipelineCard } from "./types";
import { canSeeTags, personKindOf, tagsPatch, visibleTags } from "./rules";

// Maria sponsors Anita, Anita sponsors Jamal. Tags are stored on each person.
const person = (id: string, tags?: string[]) =>
  ({ id, name: id, bizClass: "ibo", tags }) as CrmPerson;
const maria = person("maria", ["Mentor"]);
const anita = person("anita", ["Needs encouragement", "Referral source"]);
const jamal = person("jamal");

describe("visibleTags: nobody sees their own tags", () => {
  it("the viewer looking at themselves sees none", () => {
    expect(visibleTags(anita, "anita")).toEqual([]);
    expect(canSeeTags(anita, "anita")).toBe(false);
  });

  it("an upline looking at you still sees your tags", () => {
    expect(visibleTags(anita, "maria")).toEqual(["Needs encouragement", "Referral source"]);
    expect(canSeeTags(anita, "maria")).toBe(true);
  });

  it("you looking at a downline see theirs", () => {
    expect(visibleTags(anita, "jamal")).toEqual(["Needs encouragement", "Referral source"]);
    expect(visibleTags(maria, "anita")).toEqual(["Mentor"]);
  });

  it("a person with no tags has an empty list for everyone", () => {
    expect(visibleTags(jamal, "jamal")).toEqual([]);
    expect(visibleTags(jamal, "maria")).toEqual([]);
  });

  it("no signed-in viewer hides nothing", () => {
    expect(visibleTags(anita, undefined)).toEqual(["Needs encouragement", "Referral source"]);
  });
});

describe("tagsPatch: a tag edit on your own person writes nothing", () => {
  it("adds the new list for someone else, and leaves `tags` out for yourself", () => {
    expect(tagsPatch(anita, "maria", ["Gym"])).toEqual({ tags: ["Gym"] });
    expect(tagsPatch(anita, "maria", [])).toEqual({ tags: undefined });
    const own = tagsPatch(anita, "anita", []);
    expect(own).toEqual({});
    expect("tags" in own).toBe(false);
    expect("tags" in tagsPatch(anita, "anita", ["Gym"])).toBe(false);
  });
});

describe("personKindOf with a viewer: no Referral source on your own person", () => {
  const cards = [
    { personId: "colcard", column: "referral_source", droppedAt: null },
    { personId: "meeting", column: "first_meeting", droppedAt: null },
  ] as PipelineCard[];
  const kindOf = personKindOf(cards, [], new Set(["onlist"]), "me");

  it("a stored tag on your own person is not a badge; on anyone else it is", () => {
    expect(kindOf({ id: "me", bizClass: "ibo", tags: ["Referral source"] }).referralSource).toBe(
      false,
    );
    expect(kindOf({ id: "x", bizClass: "ibo", tags: ["referral SOURCE"] }).referralSource).toBe(
      true,
    );
  });

  it("a card in the Referral source column is not a badge on your own person either", () => {
    const mine = personKindOf(cards, [], new Set(), "colcard");
    expect(mine({ id: "colcard", bizClass: "ibo" }).referralSource).toBe(false);
    expect(kindOf({ id: "colcard", bizClass: "ibo" }).referralSource).toBe(true);
  });

  it("a name on the customer board's Referral source column is not a badge on your own person", () => {
    const mine = personKindOf(cards, [], new Set(["onlist"]), "onlist");
    expect(mine({ id: "onlist", bizClass: "customer" }).referralSource).toBe(false);
    expect(kindOf({ id: "onlist", bizClass: "customer" }).referralSource).toBe(true);
  });

  it("the type is not a tag and stays", () => {
    const mine = personKindOf(cards, [], new Set(), "meeting");
    expect(mine({ id: "meeting", bizClass: "prospect" }).type).toBe("prospect");
  });
});
