# Plan: background image, glass look and team-chosen theme

Status: NOT STARTED (saved 2026-11-12). The owner decided there is not enough usage yet to build this.

**Before doing any work on this, ask the owner whether to continue with it.** When a new working session on this project starts, raise this plan and ask that question first. Do not start it on your own.

## What the owner asked for

- The app's background is a fixed picture (on the `heroes` brand: the stained-glass artwork from the main page of the owner's personal site), and the app is styled like that site: a "liquid glass" look, where the background stays still and the panels, cards and fields move in front of it as translucent glass.
- This is mainly for the `heroes` brand, but it should exist on `main` so any team can use it: a team chooses its colours, logo and background image, or leaves the background plain and turns the glass look off.

## Where the look comes from

- The personal site's repo is `ThatCakeIsAPie/thatcakeisapie.github.io` (Astro). Its glass recipe is a set of CSS variables in `src/styles/global.css` (`--glass-tint`, `--glass-filter`, `--glass-border`, `--glass-highlight`, `--glass-shadow`, `--glass-sheen`, hover variants) plus a fixed site-wide backdrop with a dark scrim over the artwork.
- The artwork is `public/brand/stained-glass.webp`, with a portrait variant for phones.
- The `heroes` brand already takes its mark and green and gold palette from that site. Keep the two in step.

## Shape of the work (notes for whoever builds it, not decisions)

- Today a brand is fixed at build time in `src/brand/` (name, mark, colour tokens, wordmark font, favicon). This plan adds a background image and a glass on/off switch to that, and glass surface tokens that every brand must define (plain brands map them to their solid surfaces).
- "Choose their colours, logo and background image" can mean two things. Ask the owner which:
  1. per brand, in the brand folder (a developer sets it once per team), or
  2. in the app, by the team's leader in Settings (the `workspaces` table already has `logo_url` and `colors` columns that nothing uses yet).
- Glass is applied in the shared surface components (cards, sheets, dialogs, sidebar, top bar), not page by page.

## Things to check before or while building

- Light theme: the personal site is dark only. Decide whether glass applies in both themes or the image forces a dark look.
- Readability: text contrast over a busy picture, in both themes, including tables and the pipeline boards.
- Speed: `backdrop-filter` over many cards on a phone. Measure on the busiest pages.
- Feedback snapshots: the in-page capture may not draw `backdrop-filter`. Check what the snapshot looks like, and that names and contact details are still blacked out.
- The gold highlight already has weak contrast on the light theme (focus ring, progress fill). Fix that with per-theme tokens on `main` as part of this.
- Per the repo rules: any new token or brand field added on `main` needs a value on every brand branch in the same piece of work.
