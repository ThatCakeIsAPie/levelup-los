/**
 * Brand data. Pure values, NO imports: this file is read by vite.config.ts and
 * scripts/ as well as by app code. Logic that uses these values (page titles,
 * storage keys) lives in src/lib/brand.ts.
 */
export const brand = {
  /** App name: page titles, aria-labels, share text. */
  name: "Network Marketing CRM",
  /** Text set next to the mark in the sidebar and on the sign-in page. Usually the name; shorten it if the name does not fit the sidebar. */
  wordmark: "Network CRM",
  /** Small line under the wordmark and in the sign-in footer. Empty string hides it. */
  orgLine: "",
  /** The team the app is for: "the Acme team", "Welcome to Acme chats!". Empty string reads "your team" / "team chats". */
  teamName: "",
  /** <meta name=description>. */
  description: "Team, customer, and event management for network marketing teams.",
  /** Stable machine id: calendar UIDs etc. Never change it on a live brand. */
  slug: "network-marketing-crm",
  /**
   * Prefix of every localStorage key (`<prefix>.crm`) and IndexedDB name
   * (`<prefix>-chat-media`). Never change it on a live brand: users would lose
   * their saved data.
   */
  storagePrefix: "nmcrm",
  /** Browser chrome colour: `initial` is the static <meta theme-color>, light/dark match --app-bg. */
  themeColor: { initial: "#181E2B", light: "#F5F6FA", dark: "#0E1118" },
  /**
   * Fixed background picture, as a file name in src/brand/public (served from the
   * site's base path). The picture never moves; the app scrolls in front of it.
   * null = no picture: the page keeps its plain --app-bg colour.
   */
  backgroundImage: null as string | null,
  /** Picture for phones and portrait windows (same rules). null = reuse backgroundImage. */
  backgroundImagePortrait: null as string | null,
  /**
   * Glass look on by default: cards, bars, sheets, dialogs and menus become
   * translucent blurred glass over the page (the --glass-* tokens in tokens.css).
   * false = plain solid surfaces. Works with or without a background picture.
   */
  glass: false as boolean,
  /**
   * Colours for generated demo artwork (placeholder thumbnails, the demo map,
   * demo PDFs). They are baked into images and files, so they are not theme
   * tokens.
   */
  art: {
    /** Deep ink: title text in demo PDFs, the start pin on the demo map, the poster gradient start. */
    ink: "#1B2230",
    /** Primary brand tint: PDF top band, the route line on the demo map, the poster gradient end. */
    primary: "#4F46E5",
    /** Highlight: the poster's circle and middle bar. */
    highlight: "#8F98F7",
    /** Warm accent: the poster's first bar and the end pin on the demo map. */
    accent: "#F2A93B",
    /** Text on dark artwork (poster subtitle). */
    onDark: "#C5CBD8",
    /** Secondary text in demo PDFs (subtitle). */
    pdfMuted: "#5A6272",
    /** Faint footer text in demo PDFs. */
    pdfFaint: "#8A93A4",
    /** Placeholder text lines in demo PDF pages. */
    pdfLine: "#E1E4EC",
    /** Demo map: land, roads, a park/block and the label text. */
    map: { land: "#EEF0F6", road: "#FFFFFF", block: "#DDE1F5", label: "#1B2230" },
  },
} as const;

export type Brand = typeof brand;
