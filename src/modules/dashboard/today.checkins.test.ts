import { describe, expect, it } from "vitest";
import { addDays, addMonths } from "date-fns";
import type { CrmPerson } from "@/data";
import { DEFAULT_CHECK_IN_MONTHS } from "@/data/pipeline/checkIns";
import { localDate } from "@/lib/dates";
import { buildTodayItems, groupToday, type TodayInput } from "./today";

const NOW = new Date(2026, 10, 16, 9, 0, 0); // 16 Nov 2026
const ago = (days: number) => localDate(addDays(NOW, -days));

const person = (id: string, bizClass: CrmPerson["bizClass"] = "prospect"): CrmPerson => ({
  id,
  name: `Person ${id}`,
  bizClass,
  sponsorId: "me",
  joinedDate: ago(900),
});
const card = (
  personId: string,
  column: string,
  rating: "hot" | "warm" | "cold" | null,
  droppedAt: string | null = null,
) => ({ personId, column, rating, droppedAt });

// One prospect of each kind, a registered team member and a customer.
const KINDS = [
  { id: "hot", card: card("hot", "first_meeting", "hot") },
  { id: "warm", card: card("warm", "first_meeting", "warm") },
  { id: "cold", card: card("cold", "contact", "cold") },
  { id: "unrated", card: card("unrated", "contact", null) },
  { id: "nocard", card: undefined },
  { id: "notint", card: card("notint", "not_interested", "hot") },
  { id: "dropped", card: card("dropped", "first_plan", "hot", "2026-10-01T00:00:00Z") },
  { id: "dnc", card: card("dnc", "do_not_contact", "hot") },
  { id: "referral", card: card("referral", "referral_source", "hot") },
];
const people: CrmPerson[] = [
  person("me", "ibo"),
  ...KINDS.map((k) => person(k.id)),
  person("mate", "apprentice"),
  { ...person("cust", "customer"), ownerId: "me" },
];

const input = (last: number, over: Partial<TodayInput> = {}): TodayInput => ({
  viewerId: "me",
  role: "ibo",
  people,
  lastContact: new Map(people.filter((p) => p.id !== "me").map((p) => [p.id, ago(last)])),
  settings: { teamDays: 14, customerDays: 30 },
  checkIns: DEFAULT_CHECK_IN_MONTHS,
  cards: KINDS.flatMap((k) => (k.card ? [k.card] : [])),
  doNotContact: new Set(["dnc"]),
  events: [],
  attendances: [],
  sales: [],
  now: NOW,
  ...over,
});
const prospects = (items: ReturnType<typeof buildTodayItems>) =>
  items
    .filter((i) => i.kind === "prospect")
    .map((i) => i.person.id)
    .sort();
/** What the old rule (every prospect after `teamDays`, whatever the column or rating) listed. */
const before = (last: number) =>
  KINDS.map((k) => k.id)
    .filter((id) => id !== "dnc" && last > 14)
    .sort();

describe("Today: prospect check-ins by rating", () => {
  it("20 days after the last contact, no prospect is listed (before: all but Do not contact)", () => {
    expect(before(20)).toHaveLength(8);
    expect(prospects(buildTodayItems(input(20)))).toEqual([]);
  });

  it("a hot prospect last contacted 20 days ago is no longer listed; one 4 months ago is", () => {
    expect(prospects(buildTodayItems(input(20)))).not.toContain("hot");
    expect(prospects(buildTodayItems(input(130)))).toContain("hot");
  });

  it("about 4 months after: only the Hot ones are due (before: all eight)", () => {
    expect(before(130)).toHaveLength(8);
    expect(prospects(buildTodayItems(input(130)))).toEqual(["hot", "referral"]); // the hot-rated Referral source too
  });

  it("7 months after: Hot, Warm, no rating and no card, and the Referral source (hot) are due", () => {
    expect(prospects(buildTodayItems(input(215)))).toEqual(
      ["hot", "nocard", "referral", "unrated", "warm"].sort(),
    );
  });

  it("13 months after: every kind but Do not contact", () => {
    expect(prospects(buildTodayItems(input(400)))).toEqual(
      ["cold", "dropped", "hot", "nocard", "notint", "referral", "unrated", "warm"].sort(),
    );
  });

  it("Not interested and a card taken off the board use the Not interested interval, whatever the rating", () => {
    // Hot rated: due at 3 months in a column, not until 12 months in Not interested.
    const at = (last: number) => prospects(buildTodayItems(input(last)));
    expect(at(130)).toContain("hot");
    expect(at(130)).not.toContain("notint");
    expect(at(130)).not.toContain("dropped");
    expect(at(366)).toEqual(expect.arrayContaining(["notint", "dropped"]));
    // A longer Not interested interval pushes it further out.
    const longer = prospects(
      buildTodayItems(input(366, { checkIns: { ...DEFAULT_CHECK_IN_MONTHS, notInterested: 24 } })),
    );
    expect(longer).not.toContain("notint");
    expect(longer).toContain("cold"); // Cold is 12 months
  });

  it("Do not contact is never listed, even a year later", () => {
    expect(prospects(buildTodayItems(input(800)))).not.toContain("dnc");
    expect(prospects(buildTodayItems(input(800, { doNotContact: undefined })))).not.toContain(
      "dnc",
    );
  });

  it("uses the viewer's own four intervals", () => {
    const mine = { hot: 1, warm: 2, cold: 24, notInterested: 36 };
    // 70 days: Hot (1 month) and Warm / no rating (2 months) are due; Cold is not.
    expect(prospects(buildTodayItems(input(70, { checkIns: mine })))).toEqual(
      ["hot", "nocard", "referral", "unrated", "warm"].sort(),
    );
    expect(prospects(buildTodayItems(input(70, { checkIns: DEFAULT_CHECK_IN_MONTHS })))).toEqual(
      [],
    );
  });

  it("is due on the day, not the day after", () => {
    const hot = [card("hot", "first_meeting", "hot")];
    const run = (last: string) =>
      prospects(
        buildTodayItems(
          input(0, {
            people: [person("me", "ibo"), person("hot")],
            lastContact: new Map([["hot", last]]),
            cards: hot,
          }),
        ),
      );
    expect(run("2026-08-16")).toEqual(["hot"]); // 3 months to the day
    expect(run("2026-08-17")).toEqual([]);
  });

  it("counts never-contacted prospects from the day they were added", () => {
    const run = (joined: string) =>
      prospects(
        buildTodayItems(
          input(0, {
            people: [person("me", "ibo"), { ...person("hot"), joinedDate: joined }],
            lastContact: new Map(),
            cards: [card("hot", "first_meeting", "hot")],
          }),
        ),
      );
    expect(run("2026-08-16")).toEqual(["hot"]);
    expect(run("2026-08-17")).toEqual([]);
  });

  it("the row says the interval, the days it is counted in and scores by it", () => {
    const hot = buildTodayItems(input(184)).find((i) => i.person.id === "hot");
    expect(hot).toMatchObject({
      kind: "prospect",
      filter: "pipeline",
      sub: "recruiting",
      months: 3,
      basis: "hot",
      days: 184,
      never: false,
      threshold: 92, // 16 Nov - 3 months: May 16 to Aug 16 is 92 days
      score: 200,
    });
    const nocard = buildTodayItems(input(400)).find((i) => i.person.id === "nocard");
    expect(nocard).toMatchObject({ months: 6, basis: "unrated" });
  });

  it("lists prospects under Pipeline › Recruiting", () => {
    const groups = groupToday(buildTodayItems(input(130)));
    const pipeline = groups.find((g) => g.filter === "pipeline");
    expect(pipeline?.subs?.map((s) => s.sub)).toEqual(["recruiting"]);
  });
});

describe("Today: registered team members and customers are unchanged", () => {
  const rest = (last: number, over: Partial<TodayInput> = {}) =>
    buildTodayItems(input(last, over))
      .filter((i) => i.kind === "team" || i.kind === "customer")
      .map((i) => `${i.kind}:${i.person.id}:${i.score}`)
      .sort();

  it("team members use teamDays, customers use customerDays, whatever the check-in intervals", () => {
    expect(rest(20)).toEqual(["team:mate:143"]); // 20 days over 14; customer under 30
    expect(rest(40)).toEqual(["customer:cust:133", "team:mate:286"]);
    expect(rest(10)).toEqual([]);
    const wild = { hot: 36, warm: 36, cold: 36, notInterested: 36 };
    expect(rest(40, { checkIns: wild })).toEqual(rest(40));
    expect(rest(20, { settings: { teamDays: 7, customerDays: 30 } })).toEqual(["team:mate:286"]);
  });
});

describe("the same check-in a month later (when the clock moves)", () => {
  it("a cold prospect becomes due a year after the last contact", () => {
    const last = "2025-11-17";
    const run = (now: Date) =>
      prospects(
        buildTodayItems(
          input(0, {
            people: [person("me", "ibo"), person("cold")],
            lastContact: new Map([["cold", last]]),
            cards: [card("cold", "contact", "cold")],
            now,
          }),
        ),
      );
    expect(run(new Date(2026, 10, 16))).toEqual([]);
    expect(run(addMonths(new Date(2025, 10, 17), 12))).toEqual(["cold"]);
  });
});
