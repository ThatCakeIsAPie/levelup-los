# Network Marketing CRM

A CRM for network marketing teams. It tracks people and the sponsorship tree, the recruiting and customer pipelines, events and attendance, team chats, a training library and a learning path. The UI is a single-page app built with React 19, TypeScript, Vite, Tailwind CSS v4 and TanStack Router. Data lives in Supabase (Postgres with row-level security, auth, storage and realtime), or in the browser for the demo mode.

## Quick start

Requires Node 22 or newer and npm.

```sh
npm ci
npm run dev
```

With no Supabase settings the app runs in browser-storage demo mode: pick a demo user on the login page, and everything is saved in this browser only. To use a real database, copy `.env.example` to `.env.local` and follow `docs/backend.md`.

| Command                             | What it does                                              |
| ----------------------------------- | --------------------------------------------------------- |
| `npm run dev`                       | Vite dev server                                           |
| `npm run build` / `npm run preview` | Production build / serve it                               |
| `npm run typecheck`                 | `tsc --noEmit`                                            |
| `npm run lint`                      | ESLint                                                    |
| `npm test`                          | Vitest unit tests                                         |
| `npm run test:integration`          | Integration tests against local Supabase                  |
| `npm run db:start` / `db:stop`      | Start / stop local Supabase (needs Docker)                |
| `npm run db:seed` / `db:reset`      | Regenerate `supabase/seed.sql` / reset the local database |
| `npm run db:test`                   | pgTAP database tests                                      |
| `npm run db:types`                  | Regenerate `src/data/remote/database.types.ts`            |
| `npm run format`                    | Prettier                                                  |

`BASE_PATH` sets the URL base for builds served from a sub-path, and `VITE_DATA_SOURCE=local|supabase` forces the data source.

More detail: `docs/frontend-guide.md` (code layout, page conventions, design tokens) and `docs/backend.md` (schema, RLS, seed users, tests).

## Branches and brands

- `main` is the unbranded upstream.
- Each brand is a long-lived branch (`levelup`, `heroes`) that differs from `main` only in `src/brand/**` and `docs/design/**`.
- Feature work goes to `main`. A brand branch picks it up with `git merge main`, which stays conflict-free as long as nobody edits other files on the brand branch.
- To start a new brand, branch from `main` and replace the files in `src/brand/` (name, colours, logo mark, wordmark font, favicon, storage prefix). `src/brand/README.md` describes each file.

The GitHub Pages workflow (`.github/workflows/pages.yml`) publishes one brand's demo; its comments say which and how to change it.
