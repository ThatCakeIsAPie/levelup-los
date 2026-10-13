import { describe, expect, it } from "vitest";
import { addDays, format } from "date-fns";
import { parseDate } from "@/lib/dates";
import type { CrmEvent, EventType } from "@/stores/eventsStore";
import type { Attendance, MissedEventNote } from "@/stores/attendanceStore";
import { missedEventStreaks, openMissedFollowUps, type MissedInput } from "./missed";

const TODAY = "2026-10-13";
const day = (n: number) => format(addDays(parseDate(TODAY), n), "yyyy-MM-dd");

const ev = (id: string, type: EventType, offset: number, endOffset?: number): CrmEvent => ({
  id,
  name: id,
  type,
  date: day(offset),
  ...(endOffset !== undefined ? { endDate: day(endOffset) } : {}),
});

let n = 0;
const row = (eventId: string, personId: string, o: Partial<Attendance> = {}): Attendance => ({
  id: `r${n++}`,
  eventId,
  personId,
  hasTicket: false,
  leadershipQualified: false,
  specialEventQualified: false,
  ...o,
});
const came = (eventId: string, personId: string, mode: Attendance["mode"] = "in_person") =>
  row(eventId, personId, { attended: true, mode });

// Weekly Night Owls, three weeks back to last week, and next week's.
const owls = [
  ev("o1", "night_owls", -21),
  ev("o2", "night_owls", -14),
  ev("o3", "night_owls", -7),
  ev("o4", "night_owls", 7),
];

const run = (o: Partial<MissedInput>) =>
  missedEventStreaks({
    events: owls,
    attendances: [],
    contacts: [],
    notes: [],
    today: TODAY,
    ...o,
  });

describe("missedEventStreaks", () => {
  it("flags someone who came last week but not this week (weekly Night Owls)", () => {
    const s = run({ attendances: [came("o2", "tasha"), came("o3", "jamal"), came("o2", "jamal")] });
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ personId: "tasha", type: "night_owls", key: "tasha:night_owls" });
    expect(s[0].lastAttended.id).toBe("o2");
    expect(s[0].latest.id).toBe("o3");
    expect(s[0].missed.map((e) => e.id)).toEqual(["o3"]);
    expect(s[0].handled).toBeUndefined();
  });

  it("leaves people who never came to that type alone", () => {
    const s = run({ attendances: [came("o3", "jamal"), row("o3", "beau", { attended: false })] });
    expect(s).toEqual([]);
  });

  it("makes one follow-up about the latest when several are missed in a row", () => {
    const s = run({ attendances: [came("o1", "tasha"), came("o2", "jamal"), came("o3", "jamal")] });
    expect(s).toHaveLength(1);
    expect(s[0].latest.id).toBe("o3");
    expect(s[0].missed.map((e) => e.id)).toEqual(["o2", "o3"]);
    expect(s[0].lastAttended.id).toBe("o1");
  });

  it("ignores events in the future and ones still going on today", () => {
    const events = [
      ev("t1", "training", -10),
      ev("t2", "training", 0), // today: not finished yet
      ev("t3", "training", 5),
      ev("c1", "conference", -3, 1), // multi-day, ends tomorrow
      ev("c0", "conference", -40),
    ];
    const s = run({
      events,
      attendances: [
        came("t1", "tasha"),
        came("t2", "jamal"),
        came("t3", "jamal"),
        came("c0", "tasha"),
        came("c1", "jamal"),
      ],
    });
    expect(s).toEqual([]);
  });

  it("doesn't count an event nobody has logged attendance for yet", () => {
    // o3 happened but has no recorded attendance: o2 stays the latest counted one.
    const s = run({
      attendances: [came("o2", "tasha"), row("o3", "tasha", { desireToAttend: "yes" })],
    });
    expect(s).toEqual([]);
  });

  it("counts an event where only no-shows were recorded", () => {
    const s = run({ attendances: [came("o2", "tasha"), row("o3", "jamal", { attended: false })] });
    expect(s.map((x) => x.personId)).toEqual(["tasha"]);
  });

  it("ends the streak when they come again, and counts virtual attendance", () => {
    const events = [
      ev("i1", "info_session", -20),
      ev("i2", "info_session", -12),
      ev("i3", "info_session", -4),
    ];
    const s = run({
      events,
      attendances: [came("i1", "tasha"), came("i2", "jamal"), came("i3", "tasha", "virtual")],
    });
    // Tasha came back (virtually) to i3; Jamal came to i2 and missed i3.
    expect(s.map((x) => x.personId)).toEqual(["jamal"]);
  });

  it("works out each type on its own", () => {
    const events = [...owls, ev("t1", "training", -20), ev("t2", "training", -6)];
    const s = run({
      events,
      attendances: [
        came("o2", "tasha"),
        came("o3", "tasha"),
        came("t1", "tasha"),
        came("t2", "jamal"),
      ],
    });
    expect(s.map((x) => x.key)).toEqual(["tasha:training"]);
  });

  it("drops misses older than the window", () => {
    const events = [ev("m1", "monthly_meeting", -75), ev("m2", "monthly_meeting", -45)];
    expect(run({ events, attendances: [came("m1", "tasha"), came("m2", "jamal")] })).toEqual([]);
    expect(
      run({ events, attendances: [came("m1", "tasha"), came("m2", "jamal")], windowDays: 60 }),
    ).toHaveLength(1);
  });

  it("is handled by a contact from someone else on or after the first missed day", () => {
    const attendances = [came("o1", "tasha"), came("o2", "jamal"), came("o3", "jamal")];
    const contact = (id: string, date: string, byId: string) => ({
      id,
      personId: "tasha",
      date,
      byId,
    });
    // Before the first miss (o2, day -14): still open.
    expect(
      run({ attendances, contacts: [contact("k1", day(-15), "jamal")] })[0].handled,
    ).toBeUndefined();
    // Logged by Tasha herself: still open.
    expect(
      run({ attendances, contacts: [contact("k2", day(-1), "tasha")] })[0].handled,
    ).toBeUndefined();
    // On the day of the first miss, by her upline: handled.
    const s = run({
      attendances,
      contacts: [contact("k3", day(-14), "jamal"), contact("k1", day(-15), "maria")],
    });
    expect(s[0].handled).toEqual({
      kind: "contact",
      date: day(-14),
      byId: "jamal",
      contactId: "k3",
    });
  });

  it("is handled by a note on any of the missed events", () => {
    const attendances = [came("o1", "tasha"), came("o2", "jamal"), came("o3", "jamal")];
    const note = (id: string, eventId: string, createdAt: string): MissedEventNote => ({
      id,
      personId: "tasha",
      eventId,
      note: "Talked at the gym, she was sick",
      byId: "anita",
      createdAt,
    });
    // A note on the event she came to doesn't count.
    expect(
      run({ attendances, notes: [note("n0", "o1", "2026-09-23T10:00:00Z")] })[0].handled,
    ).toBeUndefined();
    const s = run({
      attendances,
      notes: [note("n1", "o2", "2026-09-30T10:00:00Z"), note("n2", "o3", "2026-10-07T10:00:00Z")],
      contacts: [{ id: "k", personId: "tasha", date: day(-1), byId: "jamal" }],
    });
    expect(s[0].handled).toMatchObject({ kind: "note", note: { id: "n2" } });
    expect(s[0].notes.map((x) => x.id)).toEqual(["n2", "n1"]);
  });
});

describe("openMissedFollowUps", () => {
  const streaks = run({
    attendances: [
      came("o2", "tasha"),
      came("o2", "jamal"),
      came("o2", "lead"),
      came("o3", "maria"),
    ],
    contacts: [{ id: "k", personId: "lead", date: day(-2), byId: "maria" }],
  });

  it("never gives someone their own follow-up", () => {
    const team = new Set(["tasha", "jamal", "lead"]);
    expect(openMissedFollowUps(streaks, "jamal", team).map((s) => s.personId)).toEqual(["tasha"]);
  });

  it("only shows people on the viewer's team, and only open ones", () => {
    const open = openMissedFollowUps(streaks, "maria", new Set(["tasha", "lead"]));
    expect(open.map((s) => s.personId)).toEqual(["tasha"]);
  });
});
