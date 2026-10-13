/**
 * Library demo seed (browser-storage demo only). Dates are relative to today.
 *
 * - 6 topics, 34 catalog items (lib-1 … lib-36; lib-1 and lib-2 keep the ids
 *   the chat seed's material link cards point at), varied speakers (team
 *   people and one guest), formats, kinds, sources and events.
 * - 6 channels like docs/design/library-mockup.html: Start here, Recruiting A
 *   to Z (3 sections), Sales crash course, Developing leaders (IBOs and
 *   leaders only), Maria's talks (2 new) and Anita's "Booking the first
 *   meeting" for her downline.
 * - Jamal (4) has finished Start here and 5 of 12 lessons of Recruiting A to
 *   Z, is 11:02 into lesson 6 ("Inviting without pressure"), half way through
 *   "Q&A: handling objections" and 1 of 4 into Anita's channel.
 *
 * Media is generated on demand (src/data/library/files.ts): `seed:audio:` and
 * `seed:video:` paths are synthesised WAV at the item's real length, and
 * `seed:pdf:` paths are small generated PDFs, so the repo holds no binaries.
 */
import { addDays } from "date-fns";
import { seedEvents } from "@/data/seed";
import { WORKSPACE_ID } from "@/data/chat/types";
import type {
  CatalogFormat,
  CatalogItem,
  CatalogKind,
  ChannelColor,
  LibraryChannel,
  LibraryData,
  LibraryProgress,
  LibraryTopic,
  LibraryVisibility,
  Speaker,
} from "./types";

/** ISO timestamp `n` days ago at a local hour (fractional days allowed). */
function tsAgo(n: number, hour = 10, now = new Date()): string {
  const d = addDays(now, -Math.floor(n));
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

const P = (personId: string): Speaker => ({ personId, name: null });
const G = (name: string): Speaker => ({ personId: null, name });

export const TOPIC_IDS = {
  recruiting: "t-recruiting",
  sales: "t-sales",
  customers: "t-customers",
  mindset: "t-mindset",
  plan: "t-plan",
  leadership: "t-leadership",
} as const;
const T = TOPIC_IDS;

/** Channel ids used by the demo (tests and links rely on them). */
export const CHANNEL_IDS = {
  start: "start-here",
  recruiting: "recruiting-a-to-z",
  sales: "sales-crash-course",
  leaders: "developing-leaders",
  maria: "marias-talks",
  anita: "booking-the-first-meeting",
} as const;

type Spec = {
  id: string;
  title: string;
  kind: CatalogKind;
  format: CatalogFormat;
  speakers: Speaker[];
  topics: string[];
  /** Minutes (audio/video) or pages/slides (documents/slides). */
  size: number;
  /** Exact length in seconds (overrides `size` for audio/video). */
  sec?: number;
  createdDaysAgo: number;
  by?: string;
  visibility?: LibraryVisibility;
  event?: string;
  description?: string;
  link?: string;
};

const SPECS: Spec[] = [
  // ---- Start here ----
  {
    id: "lib-3",
    title: "Welcome to the team",
    kind: "video",
    format: "talk",
    speakers: [P("1")],
    topics: [T.mindset],
    size: 6,
    createdDaysAgo: 200,
    description: "A short hello from Maria and what the next few weeks look like.",
  },
  {
    id: "lib-4",
    title: "How our team works",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.plan],
    size: 12,
    createdDaysAgo: 200,
  },
  {
    id: "lib-5",
    title: "Your first week checklist",
    kind: "document",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.plan],
    size: 3,
    createdDaysAgo: 190,
    by: "2",
  },
  {
    id: "lib-6",
    title: "Setting your why",
    kind: "audio",
    format: "talk",
    speakers: [P("3")],
    topics: [T.mindset],
    size: 16,
    createdDaysAgo: 180,
    event: "e2",
  },
  {
    id: "lib-8",
    title: "Using LevelUp LOS",
    kind: "slides",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.plan],
    size: 12,
    createdDaysAgo: 160,
    by: "2",
  },
  // ---- Recruiting A to Z ----
  {
    id: "lib-9",
    title: "Why we build a business",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.recruiting, T.mindset],
    size: 14,
    createdDaysAgo: 150,
    event: "e2",
  },
  {
    id: "lib-10",
    title: "Making your contact list",
    kind: "video",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.recruiting],
    size: 9,
    createdDaysAgo: 150,
    by: "2",
  },
  {
    id: "lib-11",
    title: "Contact list worksheet",
    kind: "document",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.recruiting],
    size: 2,
    createdDaysAgo: 150,
    by: "2",
  },
  {
    id: "lib-12",
    title: "Sharing your story",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.recruiting],
    size: 21,
    createdDaysAgo: 140,
  },
  {
    id: "lib-13",
    title: "Opening the door",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.recruiting],
    size: 17,
    createdDaysAgo: 140,
  },
  {
    id: "lib-1",
    title: "Inviting without pressure",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.recruiting],
    size: 18,
    sec: 18 * 60 + 5,
    createdDaysAgo: 60,
    description: "How to invite so people feel free to say no, and more of them say yes.",
  },
  {
    id: "lib-14",
    title: "Role play: the invite",
    kind: "video",
    format: "workshop",
    speakers: [P("3"), P("7")],
    topics: [T.recruiting],
    size: 12,
    createdDaysAgo: 45,
    event: "e6",
  },
  {
    id: "lib-15",
    title: "Booking the MG1",
    kind: "audio",
    format: "talk",
    speakers: [P("2")],
    topics: [T.recruiting],
    size: 15,
    createdDaysAgo: 55,
    by: "2",
  },
  {
    id: "lib-16",
    title: "What happens at an MG1",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.recruiting, T.plan],
    size: 24,
    createdDaysAgo: 50,
  },
  {
    id: "lib-2",
    title: "How to set up your first home meeting",
    kind: "document",
    format: "workshop",
    speakers: [P("1")],
    topics: [T.recruiting],
    size: 4,
    createdDaysAgo: 31,
  },
  {
    id: "lib-17",
    title: "Q&A: handling objections",
    kind: "audio",
    format: "q_and_a",
    speakers: [P("3")],
    topics: [T.recruiting],
    size: 31,
    createdDaysAgo: 46,
    event: "e6",
    by: "3",
  },
  {
    id: "lib-18",
    title: "Following up after the meeting",
    kind: "audio",
    format: "talk",
    speakers: [P("8")],
    topics: [T.recruiting, T.customers],
    size: 13,
    createdDaysAgo: 40,
  },
  // ---- Sales crash course ----
  {
    id: "lib-19",
    title: "Retail is a people business",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.sales, T.customers],
    size: 42,
    createdDaysAgo: 120,
    event: "e2",
  },
  {
    id: "lib-20",
    title: "Customer follow-up that feels natural",
    kind: "video",
    format: "workshop",
    speakers: [P("8")],
    topics: [T.sales, T.customers],
    size: 22,
    createdDaysAgo: 3,
  },
  {
    id: "lib-21",
    title: "Your first five customers",
    kind: "audio",
    format: "talk",
    speakers: [P("8")],
    topics: [T.sales],
    size: 19,
    createdDaysAgo: 70,
  },
  {
    id: "lib-22",
    title: "Product demo night highlights",
    kind: "video",
    format: "workshop",
    speakers: [P("6")],
    topics: [T.sales],
    size: 25,
    createdDaysAgo: 65,
    link: "https://youtu.be/LvlUpDemo01",
    description: "Unlisted YouTube video (demo link).",
  },
  {
    id: "lib-23",
    title: "Customer care checklist",
    kind: "slides",
    format: "workshop",
    speakers: [P("8")],
    topics: [T.customers],
    size: 15,
    createdDaysAgo: 64,
    link: "https://docs.google.com/presentation/d/levelup-demo-customer-care/edit",
    description: "Google Slides deck (demo link).",
  },
  {
    id: "lib-24",
    title: "Q&A: pricing and value",
    kind: "audio",
    format: "q_and_a",
    speakers: [P("8"), P("6")],
    topics: [T.sales],
    size: 28,
    createdDaysAgo: 19,
    event: "e4",
  },
  {
    id: "lib-26",
    title: "Why consistency wins",
    kind: "audio",
    format: "talk",
    speakers: [G("Sam Ortega")],
    topics: [T.mindset],
    size: 37,
    createdDaysAgo: 88,
    event: "e3",
    description: "Guest speaker at the Summer Conference.",
  },
  // ---- Developing leaders (IBOs and leaders) ----
  {
    id: "lib-27",
    title: "Leaders panel: your first 90 days",
    kind: "video",
    format: "panel",
    speakers: [P("1"), P("2"), P("3")],
    topics: [T.recruiting, T.mindset, T.leadership],
    size: 58,
    createdDaysAgo: 10,
    event: "e4",
  },
  {
    id: "lib-28",
    title: "Running a team meeting",
    kind: "audio",
    format: "workshop",
    speakers: [P("1")],
    topics: [T.leadership],
    size: 26,
    createdDaysAgo: 100,
    visibility: "ibos",
  },
  {
    id: "lib-29",
    title: "Coaching your apprentices",
    kind: "audio",
    format: "talk",
    speakers: [P("2")],
    topics: [T.leadership],
    size: 33,
    createdDaysAgo: 90,
    visibility: "ibos",
    by: "2",
  },
  {
    id: "lib-30",
    title: "Leadership weekend recap",
    kind: "slides",
    format: "workshop",
    speakers: [P("1")],
    topics: [T.leadership],
    size: 20,
    createdDaysAgo: 330,
    event: "e2",
    visibility: "ibos",
  },
  {
    id: "lib-31",
    title: "Interview: building past 100",
    kind: "video",
    format: "interview",
    speakers: [P("1"), G("Dana Whitfield")],
    topics: [T.leadership, T.mindset],
    size: 40,
    createdDaysAgo: 75,
    visibility: "ibos",
    link: "https://vimeo.com/123456789/abcdef1234",
    description: "Unlisted Vimeo video (demo link).",
  },
  {
    id: "lib-32",
    title: "The plan, slide by slide",
    kind: "slides",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.recruiting, T.plan],
    size: 24,
    createdDaysAgo: 18,
    event: "e4",
    by: "2",
  },
  // ---- Maria's talks ----
  {
    id: "lib-33",
    title: "Dream big, start small",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.mindset],
    size: 24,
    createdDaysAgo: 5,
  },
  {
    id: "lib-34",
    title: "Fall weekend keynote",
    kind: "audio",
    format: "talk",
    speakers: [P("1")],
    topics: [T.mindset, T.leadership],
    size: 45,
    createdDaysAgo: 2,
    event: "e2",
  },
  // ---- Anita's downline channel ----
  {
    id: "lib-35",
    title: "Booking calls: my script",
    kind: "audio",
    format: "talk",
    speakers: [P("2")],
    topics: [T.recruiting],
    size: 9,
    createdDaysAgo: 30,
    by: "2",
    visibility: "downline",
  },
  {
    id: "lib-36",
    title: "Calendar tips for busy people",
    kind: "document",
    format: "workshop",
    speakers: [P("2")],
    topics: [T.recruiting],
    size: 2,
    createdDaysAgo: 28,
    by: "2",
    visibility: "downline",
  },
];

const slug = (s: string) => encodeURIComponent(s);

function buildItem(s: Spec, n: number, eventDates: Map<string, string>, now: Date): CatalogItem {
  const media = s.kind === "audio" || s.kind === "video";
  const durationSec = media ? (s.sec ?? s.size * 60) : null;
  const pageCount = media ? null : s.size;
  const createdAt = tsAgo(s.createdDaysAgo, 12, now);
  const link = s.link ?? null;
  const storagePath = link
    ? null
    : media
      ? `seed:${s.kind}:${durationSec}:${n + 1}`
      : `seed:pdf:${pageCount}:${s.kind === "slides" ? "l" : "p"}:${slug(s.title)}`;
  // Recorded at its event, else a couple of days before it was added.
  const recordedOn = s.event
    ? (eventDates.get(s.event) ?? null)
    : localDay(addDays(now, -s.createdDaysAgo - 2));
  return {
    id: s.id,
    workspaceId: WORKSPACE_ID,
    title: s.title,
    description: s.description ?? null,
    kind: s.kind,
    source: link ? "link" : "upload",
    storagePath,
    mime: link
      ? null
      : media
        ? s.kind === "audio"
          ? "audio/wav"
          : "video/mp4"
        : "application/pdf",
    sizeBytes: link ? null : media ? (durationSec ?? 0) * 16_000 : (pageCount ?? 1) * 40_000,
    fileName: link
      ? null
      : `${s.title
          .replace(/[^\w ]+/g, "")
          .replace(/ +/g, "-")
          .toLowerCase()}.${media ? (s.kind === "audio" ? "m4a" : "mp4") : "pdf"}`,
    linkUrl: link,
    linkProvider: link
      ? link.includes("youtu")
        ? "youtube"
        : link.includes("vimeo")
          ? "vimeo"
          : "google_slides"
      : null,
    durationSec,
    pageCount,
    speakers: s.speakers,
    format: s.format,
    topicIds: s.topics,
    eventId: s.event ?? null,
    recordedOn,
    createdBy: s.by ?? "1",
    permissionConfirmed: true,
    visibility: s.visibility ?? "team",
    createdAt,
    updatedAt: createdAt,
  };
}

function localDay(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function channel(
  id: string,
  title: string,
  description: string,
  icon: string,
  color: ChannelColor,
  sections: [string | null, string[]][],
  opts: { by?: string; visibility?: LibraryVisibility; createdDaysAgo: number; now: Date },
): LibraryChannel {
  const createdAt = tsAgo(opts.createdDaysAgo, 9, opts.now);
  return {
    id,
    workspaceId: WORKSPACE_ID,
    title,
    description,
    icon,
    color,
    createdBy: opts.by ?? "1",
    visibility: opts.visibility ?? "team",
    sections: sections.map(([t, itemIds], i) => ({ id: `${id}-s${i + 1}`, title: t, itemIds })),
    createdAt,
    updatedAt: createdAt,
  };
}

export function seedLibrary(now = new Date()): LibraryData {
  const eventDates = new Map(seedEvents().map((e) => [e.id, e.date]));
  const items = SPECS.map((s, i) => buildItem(s, i, eventDates, now));
  const byId = new Map(items.map((i) => [i.id, i]));

  const topics: LibraryTopic[] = [
    ["recruiting", "Recruiting"],
    ["sales", "Sales"],
    ["customers", "Customers"],
    ["mindset", "Mindset"],
    ["plan", "The plan"],
    ["leadership", "Leadership"],
  ].map(([key, name]) => ({
    id: `t-${key}`,
    workspaceId: WORKSPACE_ID,
    name,
    createdBy: "1",
    createdAt: tsAgo(400, 9, now),
  }));

  const C = CHANNEL_IDS;
  const channels: LibraryChannel[] = [
    channel(
      C.start,
      "Start here",
      "Your first steps on the team: who we are, how we work and how to use the app.",
      "flag",
      "navy",
      [[null, ["lib-3", "lib-4", "lib-5", "lib-6", "lib-8", "lib-9"]]],
      { createdDaysAgo: 200, now },
    ),
    channel(
      C.recruiting,
      "Recruiting A to Z",
      "From your first contact list to a first plan. Short lessons in order.",
      "user-plus",
      "teal",
      [
        ["Basics", ["lib-9", "lib-10", "lib-11"]],
        ["Inviting", ["lib-12", "lib-13", "lib-1", "lib-14"]],
        ["The first meeting", ["lib-15", "lib-16", "lib-2", "lib-17", "lib-18"]],
      ],
      { createdDaysAgo: 150, now },
    ),
    channel(
      C.sales,
      "Sales crash course",
      "Everything to make your first five sales and keep those customers happy.",
      "shopping-bag",
      "amber",
      [[null, ["lib-19", "lib-21", "lib-20", "lib-22", "lib-23", "lib-24", "lib-18", "lib-26"]]],
      { createdDaysAgo: 120, now },
    ),
    channel(
      C.leaders,
      "Developing leaders",
      "For IBOs and leaders: building a team that builds itself.",
      "sprout",
      "green",
      [[null, ["lib-27", "lib-28", "lib-29", "lib-30", "lib-31", "lib-32"]]],
      { createdDaysAgo: 100, now, visibility: "ibos" },
    ),
    channel(
      C.maria,
      "Maria's talks",
      "Maria's talks from team meetings and conferences.",
      "mic",
      "sky",
      [[null, ["lib-34", "lib-33", "lib-19", "lib-9", "lib-12", "lib-13"]]],
      { createdDaysAgo: 90, now },
    ),
    channel(
      C.anita,
      "Booking the first meeting",
      "My way of getting the first meeting on the calendar, for my team.",
      "calendar-check",
      "mist",
      [[null, ["lib-35", "lib-15", "lib-36", "lib-2"]]],
      { createdDaysAgo: 30, now, by: "2", visibility: "downline" },
    ),
  ];

  // ---- Progress ----
  const progress: LibraryProgress[] = [];
  const done = (personId: string, itemId: string, daysAgo: number) => {
    const at = tsAgo(daysAgo, 20, now);
    progress.push({
      personId,
      itemId,
      positionSec: byId.get(itemId)?.durationSec ?? 0,
      completedAt: at,
      loggedAt: at,
      updatedAt: at,
    });
  };
  const partial = (personId: string, itemId: string, positionSec: number, hoursAgo: number) => {
    const at = new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
    progress.push({
      personId,
      itemId,
      positionSec,
      completedAt: null,
      loggedAt: null,
      updatedAt: at,
    });
  };
  // Jamal: Start here done; Recruiting 5 of 12, 11:02 into lesson 6.
  done("4", "lib-3", 26);
  done("4", "lib-4", 25);
  done("4", "lib-5", 24);
  done("4", "lib-6", 23);
  done("4", "lib-8", 22);
  done("4", "lib-9", 11);
  done("4", "lib-10", 10);
  done("4", "lib-11", 10);
  done("4", "lib-12", 5);
  done("4", "lib-13", 3);
  done("4", "lib-19", 30);
  done("4", "lib-35", 7);
  partial("4", "lib-1", 662, 20);
  partial("4", "lib-17", 930, 6 * 24);
  // Anita: a few talks, one in progress.
  done("2", "lib-9", 60);
  done("2", "lib-19", 50);
  done("2", "lib-26", 40);
  partial("2", "lib-27", 1250, 30);
  // Maria: her panel in progress.
  done("1", "lib-26", 80);
  partial("1", "lib-20", 400, 50);
  // Beau (candidate): started the first steps.
  done("20", "lib-3", 4);
  partial("20", "lib-4", 300, 52);

  return { items, topics, channels, progress };
}
