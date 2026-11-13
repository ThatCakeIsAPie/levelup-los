# src/brand

Everything that makes this app look like one team's app. The rest of the code is brand-neutral: it reads these files and nothing else brand-specific.

A brand branch may change ONLY the files in `src/brand/` and `docs/design/`. Keep it that way and `git merge main` stays conflict-free.

| File                 | What it is                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.ts`           | Pure data (no imports): app name, wordmark, org line, team name, description, slug, storage prefix, theme colours, demo artwork colours. Also read by `vite.config.ts` and `scripts/`. |
| `BrandMark.tsx`      | The logo mark as a bare SVG. It fills the box its caller gives it and need not be square.                                                                                              |
| `tokens.css`         | Every raw colour (light and dark), the wordmark `@font-face` and `--font-wordmark`. Header comment explains each colour's role and the contrast rules.                                 |
| `fonts/`             | The wordmark font files and their licence.                                                                                                                                             |
| `public/favicon.svg` | Favicon (Vite `publicDir`).                                                                                                                                                            |
| `index.ts`           | Re-exports `brand` and `BrandMark`.                                                                                                                                                    |

Logic that uses these values (`pageTitle`, `storageKey`, `dbName`) lives in `src/lib/brand.ts`, not here.

## Never change on a live brand

- `slug`: the machine id used in calendar UIDs.
- `storagePrefix`: prefix of every localStorage key (`<prefix>.crm`) and IndexedDB name (`<prefix>-chat-media`). Changing it makes existing users lose their saved data.

## Notes

- Keep every token name in `tokens.css`; components depend on them. Only the values change.
- If `orgLine` is empty, the tagline under the wordmark and in the sign-in footer is hidden.
- The static `<meta name="theme-color">`, title, description and the theme script's storage key in `index.html` come from `brand.ts` through the plugin in `vite.config.ts`.
- `tokens.css` also holds the focus ring and progress fill (`--focus-ring`, `--progress-fill`; default `--brand-sky`) and the glass tokens (`--glass-*`, `--scrim`). A brand whose highlight is too light on its light theme sets deeper focus and progress values under `:root` (3:1 on `--surface`, `--surface-2` and `--track`, and for the ring on the dark sidebar too).

## Background picture and glass

Both are off for a plain brand (`backgroundImage: null`, `glass: false` in `brand.ts`) and the app looks as if they did not exist. `src/lib/appearance.ts` applies the brand's choice at startup and can change it at runtime (`applyAppearance`); see "Glass and the background picture" in `docs/frontend-guide.md`.

- `backgroundImage` / `backgroundImagePortrait`: file names in `public/` (for example `stained-glass.webp`, a landscape picture around 2560x1600, and a portrait one around 1200x1900 for phones). Keep each under about 250 KB (webp). The portrait one is optional.
- `glass`: `true` turns the shared surfaces into translucent blurred glass; it works with or without a picture.
- `tokens.css` MUST define every `--glass-*` token and `--scrim` in both themes, even for a brand that keeps glass off (a team can switch it on at runtime): `--glass-tint` (panels), `--glass-tint-reading` (denser: dialogs, menus, cards inside panels, fields), `--glass-tint-inset`, `--glass-tint-side` (dark glass in both themes: sidebar, event card), `--glass-filter`, `--glass-filter-reading`, `--glass-border`, `--glass-track`, `--glass-highlight`, `--glass-shadow`, `--glass-sheen`, `--scrim`. Pick them so body, muted and table text reach 4.5:1 over the brightest part of the picture in each theme.

A team's leader can also choose their own picture, glass, logo and colors in Settings (`docs/frontend-guide.md`, "Team appearance"). Nothing in this folder changes for that: the team's choices are merged over these tokens at runtime. The brand's `--surface`, `--surface-2`, `--track`, `--app-bg`, `--side`, `--ok`, `--amber-strong`, `--danger` and `--glass-tint-side` (its alpha) are read to keep the team's colors readable, so keep them real colors (hex or `rgb()`), not `var()` chains to other roles of the three that can be changed.
