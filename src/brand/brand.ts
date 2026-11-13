/**
 * Brand data. Pure values, NO imports: this file is read by vite.config.ts and
 * scripts/ as well as by app code. Logic that uses these values (page titles,
 * storage keys) lives in src/lib/brand.ts.
 */
export const brand = {
  /** App name: page titles, aria-labels, share text. */
  name: "Heroes LOS",
  /** Text set next to the mark in the sidebar and on the sign-in page. Usually the name; shorten it if the name does not fit the sidebar. */
  wordmark: "Heroes LOS",
  /** Small line under the wordmark and in the sign-in footer. Empty string hides it. */
  orgLine: "Team Heroes",
  /** The team the app is for: "the Heroes team", "Welcome to Heroes chats!". Empty string reads "your team" / "team chats". */
  teamName: "Heroes",
  /** <meta name=description>. */
  description: "Team, customer, and event management for Team Heroes.",
  /** Stable machine id: calendar UIDs etc. Never change it on a live brand. */
  slug: "heroes-los",
  /**
   * Prefix of every localStorage key (`<prefix>.crm`) and IndexedDB name
   * (`<prefix>-chat-media`). Never change it on a live brand: users would lose
   * their saved data.
   */
  storagePrefix: "heroes",
  /** Browser chrome colour: `initial` is the static <meta theme-color>, light/dark match --app-bg. */
  themeColor: { initial: "#142423", light: "#F4EFE3", dark: "#0E1C1A" },
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
    ink: "#142423",
    /** Primary brand tint: PDF top band, the route line on the demo map, the poster gradient end. */
    primary: "#1D5546",
    /** Highlight: the poster's circle and middle bar. */
    highlight: "#E3C271",
    /** Warm accent: the poster's first bar and the end pin on the demo map. */
    accent: "#F07850",
    /** Text on dark artwork (poster subtitle). */
    onDark: "#E7DCC6",
    /** Secondary text in demo PDFs (subtitle). */
    pdfMuted: "#5A6760",
    /** Faint footer text in demo PDFs. */
    pdfFaint: "#8B958E",
    /** Placeholder text lines in demo PDF pages. */
    pdfLine: "#E3DCC9",
    /** Demo map: land, roads, a park/block and the label text. */
    map: { land: "#EFE9DA", road: "#FBF8F1", block: "#DCE6D6", label: "#142423" },
  },
} as const;

export type Brand = typeof brand;
