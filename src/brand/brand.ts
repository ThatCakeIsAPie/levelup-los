/**
 * Brand data. Pure values, NO imports: this file is read by vite.config.ts and
 * scripts/ as well as by app code. Logic that uses these values (page titles,
 * storage keys) lives in src/lib/brand.ts.
 */
export const brand = {
  /** App name: page titles, wordmark, aria-labels, share text. */
  name: "LevelUp LOS",
  /** Small line under the wordmark and in the sign-in footer. Empty string hides it. */
  orgLine: "LevelUp Leadership · LTD",
  /** The team the app is for: "the LevelUp team", "Welcome to LevelUp chats!". Empty string reads "your team" / "team chats". */
  teamName: "LevelUp",
  /** <meta name=description>. */
  description: "Team, customer, and event management for direct sales leaders.",
  /** Stable machine id: calendar UIDs etc. Never change it on a live brand. */
  slug: "levelup-los",
  /**
   * Prefix of every localStorage key (`<prefix>.crm`) and IndexedDB name
   * (`<prefix>-chat-media`). Never change it on a live brand: users would lose
   * their saved data.
   */
  storagePrefix: "levelup",
  /** Browser chrome colour: `initial` is the static <meta theme-color>, light/dark match --app-bg. */
  themeColor: { initial: "#1A1E1C", light: "#F4F5F3", dark: "#101411" },
  /**
   * Colours for generated demo artwork (placeholder thumbnails, the demo map,
   * demo PDFs). They are baked into images and files, so they are not theme
   * tokens.
   */
  art: {
    /** Deep ink: title text in demo PDFs, the start pin on the demo map, the poster gradient start. */
    ink: "#1A365D",
    /** Primary brand tint: PDF top band, the route line on the demo map, the poster gradient end. */
    primary: "#067781",
    /** Highlight: the poster's circle and middle bar. */
    highlight: "#199BD7",
    /** Warm accent: the poster's first bar and the end pin on the demo map. */
    accent: "#F2A93B",
    /** Text on dark artwork (poster subtitle). */
    onDark: "#BFCDE0",
    /** Secondary text in demo PDFs (subtitle). */
    pdfMuted: "#5C697A",
    /** Faint footer text in demo PDFs. */
    pdfFaint: "#8791A1",
    /** Placeholder text lines in demo PDF pages. */
    pdfLine: "#E3DED6",
    /** Demo map: land, roads, a park/block and the label text. */
    map: { land: "#EAF3EE", road: "#FFFFFF", block: "#D6EBDD", label: "#13243D" },
  },
} as const;

export type Brand = typeof brand;
