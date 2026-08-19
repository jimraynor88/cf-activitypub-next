<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# CF ActivityPub — Agent Instructions

A Mastodon-compatible ActivityPub social server that runs entirely on Cloudflare Workers via **Next.js 16 App Router + @opennextjs/cloudflare**. There is no Node.js server, no Docker, no database server — everything is bound to Cloudflare primitives. This file tells an AI (or human) how to work in this repo without breaking the architecture.

## Before you touch anything

- **This is Next.js 16** (see the warning block above). Route handler signatures changed: `{ params }` is now a `Promise` in Next 16 (`{ params }: { params: Promise<{ id: string }> }`) and you must `await params`. Do not assume your training data's API. Read `node_modules/next/dist/docs/`.
- **The runtime is Cloudflare Workers**, not Node. Never use Node-only globals/APIs in runtime code. `nodejs_compat` is enabled, but everything runs inside the Worker sandbox.
- **Do not commit secrets.** Never put real secrets in `wrangler.toml` or in code. Secrets are set with `wrangler secret put` (see README). `wrangler.toml` only holds public vars, bindings, and resource IDs.

## Quick commands

```bash
npm run dev          # local Next.js dev server (plain Next, no CF bindings)
npm run test         # vitest (jsdom)
npm run lint         # eslint (eslint-config-next, core-web-vitals + typescript)
npm run preview      # opennextjs-cloudflare build + wrangler dev (local CF runtime)
npm run deploy       # opennextjs-cloudflare build + wrangler deploy
npm run db:migrate   # wrangler d1 execute schema against the remote D1 DB
```

**Always validate before finishing a task:**

```bash
npx tsc --noEmit && npx eslint . && npx vitest run
```

tsc and eslint are separate from `npm run build` (build is slow and requires CF assets). Run all three after any change and keep the suite green.

## Architecture (the mental model)

| Concern | Where |
|---|---|
| Next.js App Router pages | `app/` (server & client components) |
| REST API routes (Mastodon-compatible `/api/v1/*`) | `app/api/**/route.ts` |
| ActivityPub federation (inbox, actors, security) | `lib/activitypub/` |
| Mastodon serializers + status ID encoding | `lib/mastodon/` |
| D1 row mappers + queries | `lib/db/index.ts`, schema in `lib/db/schema.sql` |
| Types (actors, objects, env, calls) | `lib/types/` |
| AI moderation ("Guardian") | `lib/moderation/` |
| Streaming / WebRTC Durable Objects | `lib/streaming/`, exported from `src/worker.ts` |
| i18n (EN + ES dictionaries) | `lib/i18n.tsx` |
| Cloudflare Worker entry (wrangler `main`) | `src/worker.ts` |
| Edge middleware / rewrites | `middleware.ts` |
| DB migrations (incremental SQL + runner) | `scripts/`, `scripts/upgrade-schema.mjs` |
| Next.js config + custom image loader | `next.config.ts`, `app/image-loader.ts` |

### Cloudflare bindings (`wrangler.toml` → `lib/types/env.ts` → `lib/cf.ts`)

- `DB` — D1 (SQLite) relational store.
- `KV` — cache, sessions/rate-limit markers, WS abuse protection.
- `R2` — media uploads.
- `DELIVERY_QUEUE` — async ActivityPub fan-out with retries + DLQ; consumed by `src/worker.ts`.
- `TIMELINE_STREAM`, `CALL_SIGNALING` — Durable Objects (WebSockets streaming, WebRTC signaling).
- `AI` — Workers AI (LLaVA alt-text, Llama moderation).
- `VECTORIZE` — optional semantic memory for moderation.
- `EMAIL` — Email Workers binding for transactional mail.
- Cron `* * * * *` — scheduled maintenance + Guardian patrol.

**Access env in code like this** (never read `process.env` for bindings):

```ts
import { getCloudflareContext, json, notFound, unauthorized, badRequest } from "@/lib/cf";
const { env } = getCloudflareContext(); // → { DB, KV, R2, DELIVERY_QUEUE, ... }
```

## Code conventions

- **Path alias**: `@/*` → repo root (`tsconfig.json` + vitest alias). Always import with `@/`.
- **API routes** are plain exported async functions (`GET`, `POST`, `PUT`, `DELETE`) in `app/api/**/route.ts`, typed `(request: NextRequest, { params }: { params: Promise<{ id: string }> })`. Use the `json()`/`notFound()`/`unauthorized()` helpers from `@/lib/cf`.
- **Admin API auth**: import `requireAdmin(request, env)` from `@/lib/admin-auth`. It accepts a role check (`admin`/`moderator` on the actor) plus an optional `ADMIN_TOKEN` bearer fallback.
- **Authenticated actor**: `getAuthenticatedActor(request, env.DB)` from `@/lib/auth`. Client-side auth uses `getToken()` from `@/lib/client-api` (cookie `auth_token`, falls back to localStorage).
- **i18n**: the dictionaries live in `lib/i18n.tsx`. `t` from `useLocale()` is a **plain translation OBJECT, not a function** — use `t.some_key` (or `t[key as keyof Translations]` for dynamic keys). The instance is **bilingual (EN + ES)**. Every key must exist in **both** `EN` and `ES` with identical key sets (`Translations = typeof EN`, `ES: typeof EN`). For interpolated strings use `.replace("{var}", value)` (see `components/StatusCard.tsx` poll expiry). New UI text must be added as a key to both dictionaries — never hardcode English in components.
- **Images**: a custom loader (`app/image-loader.ts` in `next.config.ts`) lets `next/image` serve any remote URL — no `remotePatterns` needed. **Prefer `next/image` components over plain `<img>`/HTML tags.** When sizing non-square remote avatars, force `width`/`height` in an inline `style` plus `objectFit: "cover"` — Tailwind preflight's `img { height: auto }` overrides the HTML `width`/`height` attributes and causes misalignment.
- **DB access**: write raw SQL via `env.DB.prepare(sql).bind(...)`. D1 returns snake_case columns; convert to camelCase via the row mappers in `lib/db/index.ts` (`rowToActor`, etc.). Wrap legacy-format queries in `try/catch` with a comment pointing to the migration when columns may be missing in an old DB.
- **Federation**: outbound activity is JSON-signed (`lib/activitypub/security.ts`) and delivered through the `DELIVERY_QUEUE` (`enqueueDeliveries`), never by `fetch`ing inboxes inline. Inbound goes through `app/inbox/route.ts` / `lib/activitypub/inbox.ts`. Always SSRF-check URLs (`validateOutboundUrl`).
- **Remote content rendering**: linkify/process remote object text via `renderRemoteContent` in `lib/mastodon/serializers.ts` (HTML → sanitize + `linkifyHtmlText`; plain text → `processStatusContent(...)`), using helpers in `lib/activitypub/content.ts`. Don't render raw remote HTML.
- **Testing**: vitest with jsdom and `globals: true`. API-route tests mock `@/lib/cf`'s `getCloudflareContext` (returning a fake `{ env: { DB: mockDb } }`), the DB chain (`prepare().bind().all()/.first()/.run()`), and dependencies with `vi.hoisted`. Tests live next to lib code under `lib/__tests__/`. Match the existing mock style exactly.
- **DB schema**: `lib/db/schema.sql` is the full, idempotent schema (`CREATE TABLE IF NOT EXISTS`). Incremental changes go in a numbered SQL file under `scripts/` and must be added to `scripts/upgrade-schema.mjs`. Always create both the full schema change AND the incremental migration.
- **Code style**: no comments unless they explain *why* (non-obvious decisions). TypeScript strict. Prefer functional style with `useCallback`/`useEffect` in client components. Keep the existing naming: `setX`, `handleX`, `fetchX`.
- **Scheduling/cron**: the cron worker phase drifts (a `* * * * *` cron keeps the phase it had at deploy). `executeScheduled` in `src/worker.ts` aligns to the top of the minute before doing time-sensitive work. Don't rely on `:00` firing exactly.

## Gotchas that have bitten before

- `middleware.ts` must stay **Edge-compatible** (only `next/server`). A file named `proxy.ts` would run on the Node runtime — don't rename it.
- `src/worker.ts` is wrangler's `main`: it wraps the OpenNext handler, exports the Durable Object classes, and adds the queue consumer + streaming WebSocket upgrade handling + cron. WebSocket upgrades for `/api/v1/streaming` and `/api/v1/calls/:id/ws` are intercepted **before** falling through to `openNextDefault.fetch`.
- Never deliver federated activity synchronously in a request handler — always enqueue.
- The `objects` table needs an explicit `updated_at` on insert (its `DEFAULT` stores `datetime('now')` in a different format than the ISO `published`, which would misreport new posts as "edited").
- Removing local accounts must also clean `oauth_tokens`, `activities` and `moderation_log` (they reference the actor without FKs) and, for local actors with a private key, federate a `Delete` tombstone to followers (see `app/api/v1/admin/accounts/[id]/route.ts` DELETE and `app/api/v1/accounts/delete/route.ts`).
- Admin sections (nav + page titles) use emoji prefixes — keep that style when adding new admin pages.
- Never re-ingest already-stored objects to change rendering — serializers read `objects.raw`, so rendering fixes are backward-compatible without migration.
