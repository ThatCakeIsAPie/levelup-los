# src/brand

Everything that makes this app look like one team's app. The rest of the code is brand-neutral: it reads these files and nothing else brand-specific.

A brand branch may change ONLY the files in `src/brand/` and `docs/design/`. Keep it that way and `git merge main` stays conflict-free.

| File                 | What it is                                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brand.ts`           | Pure data (no imports): app name, wordmark, org line, team name, description, slug, storage prefix, theme colours, demo artwork colours. Also read by `vite.config.ts` and `scripts/`. |
| `BrandMark.tsx`      | The logo mark as a bare SVG. It fills the box its caller gives it and need not be square.                                                                                              |
| `tokens.css`         | Every raw colour (light and dark) and `--font-wordmark` (the body font here). Header comment explains each colour's role and the contrast rules.                                       |
| `public/favicon.svg` | Favicon (Vite `publicDir`).                                                                                                                                                            |
| `index.ts`           | Re-exports `brand` and `BrandMark`.                                                                                                                                                    |

Logic that uses these values (`pageTitle`, `storageKey`, `dbName`) lives in `src/lib/brand.ts`, not here.

## Never change on a live brand

- `slug`: the machine id used in calendar UIDs.
- `storagePrefix`: prefix of every localStorage key (`<prefix>.crm`) and IndexedDB name (`<prefix>-chat-media`). Changing it makes existing users lose their saved data.

## Notes

- Keep every token name in `tokens.css`; components depend on them. Only the values change.
- This generic brand ships no custom font: `--font-wordmark` reuses the body font stack. A brand may add a `fonts/` folder (font files plus their licence next to them) and the matching `@font-face` rules in `tokens.css`.
- If `orgLine` is empty, the tagline under the wordmark and in the sign-in footer is hidden.
- The static `<meta name="theme-color">`, title, description and the theme script's storage key in `index.html` come from `brand.ts` through the plugin in `vite.config.ts`.
