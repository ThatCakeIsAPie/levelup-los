# Plan: background image, glass look and team-chosen theme

Status: BUILT (2026-11-13). Phase 1 (the foundation and the first brand look) and phase 2 (a team's leader chooses it in Settings) are merged to `main` and carried down to every brand branch. Still open, for the owner to decide: on a light theme the brand picture is mostly washed out by the light frosted glass (more of the picture means lower text contrast, or a separate picture for the light theme). Not yet tried by hand on a hosted database: saving an appearance as a real leader.

## What the owner asked for

- The app's background is a fixed picture (on the `heroes` brand: the stained-glass artwork from the main page of the owner's personal site), and the app is styled like that site: a "liquid glass" look, where the background stays still and the panels, cards and fields move in front of it as translucent glass.
- This is mainly for the `heroes` brand, but it exists on `main` so any team can use it: a team chooses its colours, logo and background image, or leaves the background plain and turns the glass look off.

## Decisions (owner, 2026-11-13)

- Heroes LOS gets the stained-glass background of the main page of https://coleholistics.us and that site's "liquid glass" styling: the picture is fixed to the viewport and never moves; panels, cards, the sidebar, bars, sheets and dialogs are translucent blurred glass that scrolls in front of it.
- The light/dark switch STAYS. Dark mode: dark glass like the site. Light mode: a light frosted glass over the same picture.
- A team may instead keep a plain background with no glass. That is what `main`'s generic brand and the other plain brand do.
- A second phase lets a team's leader choose the background image, glass on or off, the logo and the colours in Settings at runtime. Phase 1 is built so that needs no rework: the picture, glass on/off and every glass value are CSS custom properties plus a root attribute that can change at runtime; no component branches on the brand or the build.

## Where the look comes from

- The personal site's repo is `ThatCakeIsAPie/thatcakeisapie.github.io` (Astro). Its glass recipe is a set of CSS variables in `src/styles/global.css` (`--glass-tint`, `--glass-filter`, `--glass-border`, `--glass-highlight`, `--glass-shadow`, `--glass-sheen`, a denser "reading" variant) plus a fixed site-wide backdrop with a dark scrim over the artwork.
- The artwork is `public/brand/stained-glass.webp` with a portrait variant for phones; both now live in the `heroes` brand's `src/brand/public/`.
- The `heroes` brand already takes its mark and green and gold palette from that site. Keep the two in step.

## Phase 1: foundation and Heroes look (this work)

Built on `main` (plain brands unchanged, pixel for pixel) with one prepared branch per brand (`glass-brand-<brand>`, `src/brand/**` only) to merge into each brand branch after the pull request lands.

- Brand fields (`src/brand/brand.ts`): `backgroundImage`, `backgroundImagePortrait` (file names in the brand's `public/`, or null) and `glass` (default on or off). Generic: no picture, glass off.
- Tokens (`src/brand/tokens.css`, every brand, both themes): `--glass-tint`, `--glass-tint-reading`, `--glass-tint-inset`, `--glass-tint-side`, `--glass-filter`, `--glass-filter-reading`, `--glass-border`, `--glass-track`, `--glass-highlight`, `--glass-shadow`, `--glass-sheen`, `--scrim`; plus `--focus-ring` and `--progress-fill` (per theme; they default to the brand's highlight, so plain brands did not change). This fixes the weak contrast of a light highlight on a light theme: Heroes uses a deeper gold in its light theme.
- Runtime hooks that phase 2 calls (`src/lib/appearance.ts`): `applyAppearance({ glass?, backgroundImage?, backgroundImagePortrait? })` (changes the look now, no reload), `getAppearance()`, `useAppearance()`, `imageUrl(file)`. They drive `<html data-glass="on|off">`, `<html data-backdrop="on|off">`, `--backdrop-image` and `--backdrop-image-portrait`; `AppBackdrop` (root route) draws the fixed picture, or nothing.
- Glass is applied in the shared layer, not page by page: the "Glass" block in `src/styles.css` (surface utilities read `--surface-fill` and friends, outer layers blur, nested layers are demoted) and the `glass` / `glass-reading` / `glass-dark` / `glass-bar` classes in the shared components (see `docs/frontend-guide.md`, "Glass and the background picture").
- Fallbacks: no `backdrop-filter` support and `prefers-reduced-transparency` give near-opaque tints from the solid tokens.
- Feedback snapshots are taken from a plain clone (no picture, no blur, solid surfaces); redaction is unchanged.
- Docs: `src/brand/README.md`, `docs/frontend-guide.md`, `AGENTS.md`.

## Phase 2: leader chooses in Settings (built)

Owner's decision: the team's LEADER (not deputies, not anyone else) picks the background picture, glass on or off, the logo and the colours in Settings, for the whole team; the light/dark switch stays each person's own; a team can keep a plain background with no glass; free colour choice has guard rails so text never becomes unreadable.

### What a leader can change (Settings > Team > Appearance)

- Background: Default (the brand's own: a picture for a brand that ships one, none otherwise), None, or Picture (upload). Glass: on or off; it only means something over a picture, so with no picture it is off and the control is disabled.
- Logo: Default (the brand mark) or an uploaded image shown in place of the mark wherever `Logo` renders for a signed-in member; the wordmark text stays.
- Colours: Default or custom Main (buttons, links, selected state), Highlight (progress, focus ring, accents) and Sidebar (the dark navigation and dark cards): a colour input plus a hex field each. When a colour had to be adjusted the picker shows the colour actually used next to the chosen one.
- Changes show on the leader's own screen while editing; Save stores them for the team, Cancel restores what was saved, Reset to default clears every choice.

### How it works

- Data (one migration, `20261019000100_team_appearance.sql`): typed columns on `workspaces` (`background_mode`, `background_path`, `glass`, `logo_path` renamed from the unused `logo_url`, and the unused `colors` jsonb reused for the three colours), so no column is left half used. Written only by `set_workspace_appearance()` (SECURITY DEFINER, `search_path = ''`, leader only, validates everything); direct updates of these columns are revoked. Pictures live in the public `team-appearance` bucket under `<workspace id>/<bg|logo>-<32 random hex>.<ext>`, leader-managed. Details and the policies: `docs/backend.md`, "Team appearance".
- Colours: `src/lib/teamColors.ts` derives every dependent token for both themes from the three chosen colours (only lightness moves, to keep the contrast rules of `src/brand/tokens.css`; hue is only nudged to stay clear of good/warn/danger). Property-tested on 2 x 2,500 random choices of all three colours, plus edge cases and exact snapshots.
- Pictures: `src/lib/pictureFiles.ts` accepts PNG, JPEG and WebP by their first bytes (never SVG), resizes and re-encodes in the browser (background <= 2560 px and about 600 KB; logo <= 512 px and about 200 KB). A team's own picture gets a denser scrim and tint (`data-backdrop-source="team"`) than a brand's tuned one.
- Applying: one module, `src/lib/teamLook.ts`, merges the team's look over the brand and applies it (derived colours in one `<style id="team-look">`, background and glass through `applyAppearance`); the last applied look is cached per signed-in person so the next load paints it before data arrives; signed out and the sign-in page always show the brand. Demo mode keeps the same thing in the browser stores. Frontend guide: "Team appearance".

### Phase 2 leftovers settled

- Heroes: muted, faint and table text now reach 4.5:1 on all 25 scenes (tokens only: darker muted/faint text, denser glass tints and scrim, a darker `--ok`, a less opaque dark `--glass-track`).
- The "+N" overflow avatar on the dark event card was unreadable on every brand (light text on a light chip): fixed once in `AvatarStack` (`onDark`).
- On narrow screens the sign-in form gets a glass panel when a picture is behind it.

### What is left

- Members cannot turn glass off for themselves (a per-person accessibility choice); `prefers-reduced-transparency` already makes glass near-opaque.
- No realtime: a member sees a changed look on the next load or the periodic refresh.
- Only one background picture per team (no gallery of presets), and no separate light/dark pictures or per-picture crop.
- Colour choices are three roles; the semantic colours (good, warn, danger) keep the brand's values.
- Orphan files: if removing a replaced picture fails, the file stays in the bucket (unlinked and unguessable); a cleanup job could remove them.
- The hosted Supabase path (storage policies, the function) is covered by pgTAP and the integration test in CI, not by a browser run.

## Things checked in phase 1

- Light theme: glass applies in both themes. The light theme is parchment frosted glass over the same picture, with a paler scrim so dark text that sits on the picture itself stays readable.
- Readability: text contrast over the picture in both themes, including tables and the pipeline boards (measured, see the pull request).
- Speed: `backdrop-filter` over many cards on a phone, measured on the pipeline page (see the pull request).
- Feedback snapshots: drawn from a plain clone; names and contact details are still blacked out.
- Any new token or brand field on `main` needs a value on every brand branch in the same piece of work.

## Base layer: the picture is blurred behind every page (built)

- What changed: the background picture is no longer shown sharp anywhere. `.app-backdrop` is blurred by a static `filter` (`--backdrop-blur`, 28px) and tinted by `--scrim`, so the page background is the picture seen through one sheet of coloured glass and every panel sits on top; full-screen overlays paint the same layer through a `::before`, a team's own picture gets it too, and the text halo is gone.
- Why: the owner wanted the team map grid, and then every page, to look like liquid glass (the art visible but blurred, under one layer of the theme's colour), and with nothing on sharp artwork the Heroes panels no longer need to be near-opaque (tints 0.84-0.94 became 0.36-0.7), so the art's colour glows through them.
