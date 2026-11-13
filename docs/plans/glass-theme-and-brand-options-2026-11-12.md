# Plan: background image, glass look and team-chosen theme

Status: IN PROGRESS. Phase 1 (the foundation and the Heroes look) is built and in review (pull request "Glass surfaces and a fixed background picture, off by default"). Phase 2 (a team's leader chooses it in Settings) is NOT STARTED: ask the owner before beginning it.

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

## Phase 2: leader chooses in Settings (not started)

Ask the owner first. What it adds, on top of the phase 1 hooks:

- Team settings (leader and deputies): choose the background picture (upload, or pick from a few), glass on or off, the logo, and the brand colours. The `workspaces` table already has `logo_url` and `colors` columns that nothing uses yet; the picture and the glass flag need new columns (or one `appearance` jsonb), a storage bucket for uploads, and RLS so only leaders and deputies write.
- On sign-in the app reads the workspace's appearance and calls `applyAppearance(...)`; colours are applied as the same CSS custom properties `src/brand/tokens.css` defines. A leader's choice overrides the brand's and is checked for contrast before saving, because text must stay readable over any picture in both themes.
- Build on: `applyAppearance`, `useAppearance` and the token set above. A leader-chosen picture also needs a scrim strength and a light and dark glass pair; derive them from the brand's tokens rather than letting a leader type raw values.
- Open questions for the owner: who may change it (leaders only, or deputies too), whether members can turn glass off for themselves (a per-person accessibility choice, separate from the team's), and a size and type limit for uploaded pictures.

## Things checked in phase 1

- Light theme: glass applies in both themes. The light theme is parchment frosted glass over the same picture, with a paler scrim so dark text that sits on the picture itself stays readable.
- Readability: text contrast over the picture in both themes, including tables and the pipeline boards (measured, see the pull request).
- Speed: `backdrop-filter` over many cards on a phone, measured on the pipeline page (see the pull request).
- Feedback snapshots: drawn from a plain clone; names and contact details are still blacked out.
- Any new token or brand field on `main` needs a value on every brand branch in the same piece of work.
