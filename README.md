# CF ActivityPub

> A Mastodon-compatible ActivityPub server built for the edge — powered by Cloudflare Workers, D1, and the open web.

## Overview

**CF ActivityPub** is a fully functional social server implementing the [ActivityPub](https://www.w3.org/TR/activitypub/) protocol with [Mastodon REST API](https://docs.joinmastodon.org/api/) compatibility. It runs entirely on [Cloudflare Workers](https://workers.cloudflare.com/) — no traditional servers, no Docker.

- **Zero cold starts** — Cloudflare's V8 isolate model starts instantly in 300+ edge locations
- **Mastodon client compatible** — works with Ivory, Elk, Tusky, Megalodon, and any Mastodon app
- **Federated** — follows, boosts, likes and mentions across the fediverse
- **Cryptographically secure** — HTTP Signatures via Web Crypto API
- **Web Push notifications** — native push to mobile/desktop via VAPID + AES-128-GCM
- **AI-powered** — automatic image alt-text via Workers AI (LLaVA)
- **Fully open source** — MIT licensed

## Architecture

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Next.js 16 App Router via @opennextjs/cloudflare |
| Database | Cloudflare D1 (SQLite) |
| Cache / Sessions | Cloudflare KV |
| Media storage | Cloudflare R2 |
| Async delivery | Cloudflare Queues |
| Realtime streaming | Cloudflare Durable Objects (TimelineStreamDO) |
| WebRTC signaling | Cloudflare Durable Objects (CallSignalingDO) |
| WebRTC ICE | Cloudflare STUN + optional Cloudflare Calls TURN |
| AI inference | Cloudflare Workers AI (LLaVA for media descriptions) |
| Email | Cloudflare Email Workers (via `send_email` binding) |
| Crypto | Web Crypto API (RSASSA-PKCS1-v1_5 + PBKDF2 + ECDH + AES-128-GCM) |
| Styling | Tailwind CSS v4 |

## Environment variables

### Secrets (`wrangler secret put`)

```bash
# Cloudflare Turnstile (bot protection for registration)
wrangler secret put TURNSTILE_SECRET

# Cloudflare Calls TURN (optional — for WebRTC relay behind symmetric NAT)
wrangler secret put CALLS_TURN_KEY_ID
wrangler secret put CALLS_API_TOKEN

# Web Push VAPID private key (generate with the script below)
wrangler secret put VAPID_PRIVATE_KEY
```

### VAPID key generation

Web Push notifications require a VAPID key pair. Generate one with:

```bash
node scripts/generate-vapid-keys.mjs
```

This outputs `VAPID_PUBLIC_KEY` (safe to put in `wrangler.toml` under `[vars]`) and `VAPID_PRIVATE_KEY` (must be set as a secret). Set `VAPID_EMAIL` to a contact address like `mailto:admin@yourdomain.com`.

### Plain-text vars (`[vars]` in `wrangler.toml`)

| Variable | Description |
|---|---|
| `INSTANCE_URL` | Your public domain (e.g. `https://social.example.com`) |
| `INSTANCE_TITLE` | Instance display name |
| `INSTANCE_DESCRIPTION` | Short instance description |
| `INSTANCE_VERSION` | Version string |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key (from `generate-vapid-keys.mjs`) |
| `VAPID_EMAIL` | Contact email for VAPID (`mailto:...`) |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile public site key |
| `FROM_EMAIL` | Sender address for transactional emails (must belong to a domain with Cloudflare Email Routing) |
| `LIBRETRANSLATE_URL` | LibreTranslate instance URL (set empty to disable translation) |
| `NODE_ENV` | `production` |

## Deploy

### Prerequisites

- Node.js 18+, npm
- A [Cloudflare](https://dash.cloudflare.com) account
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 1. Clone and install

```bash
git clone https://github.com/manalejandro/cf-activitypub-next.git
cd cf-activitypub-next
npm install
```

### 2. Create Cloudflare resources

```bash
wrangler login
wrangler d1 create cf-activitypub
wrangler kv namespace create CF_ACTIVITYPUB_KV
wrangler r2 bucket create cf-activitypub-media
wrangler queues create cf-activitypub-delivery
```

Copy the generated IDs into `wrangler.toml`:
- `database_id` under `[[d1_databases]]`
- `id` under `[[kv_namespaces]]`

### 3. Configure your domain

Edit `wrangler.toml` and set:
- `INSTANCE_URL` — your public domain (e.g. `https://social.example.com`)
- `pattern` under `[[routes]]` — your custom domain

### 4. Generate VAPID keys for Web Push

```bash
node scripts/generate-vapid-keys.mjs
```

Add `VAPID_PUBLIC_KEY` and `VAPID_EMAIL` to `wrangler.toml` `[vars]`, then:

```bash
wrangler secret put VAPID_PRIVATE_KEY
```

### 5. Set remaining secrets

```bash
wrangler secret put TURNSTILE_SECRET
```

Optional — only needed if you want TURN relay for WebRTC calling:
```bash
wrangler secret put CALLS_TURN_KEY_ID
wrangler secret put CALLS_API_TOKEN
```

### 6. Run database migrations

```bash
npm run db:migrate
```

To reset the database:
```bash
wrangler d1 execute cf-activitypub --remote --file=lib/db/drop.sql
npm run db:migrate
```

### 7. Deploy

```bash
npm run deploy
```

### Preview locally

```bash
npm run preview
```

Runs the Cloudflare Workers runtime locally via `wrangler dev` (uses remote D1 by default).

## Features

### ActivityPub Federation
- WebFinger actor discovery
- Actor profiles, Inbox/Outbox, Followers/Following collections
- Shared inbox for efficient fan-out
- HTTP Signatures on all federated requests
- Handles: Create, Follow, Accept, Reject, Undo, Like, Announce, Delete, Update
- NodeInfo support

### Mastodon API
- OAuth 2.0 (password + client_credentials)
- Account registration, profile management, follow/unfollow
- Status create/delete, favourite, reblog, polls
- Home and public timelines, hashtag timelines
- Notifications (follow, mention, favourite, reblog, poll, update)
- Media uploads (R2-backed)
- Blocks, domain blocks, follow requests

### Realtime
- Streaming timelines via Durable Objects

### Web Push Notifications
- VAPID-authenticated push to all major push services (Apple, Google, Mozilla)
- AES-128-GCM encrypted payloads
- Subscription lifecycle management (auto-cleanup on 410/404)
- Fires for: follow, favourite, reblog, mention, poll results, status edits

### AI Image Descriptions
- Automatic alt-text generation via Cloudflare Workers AI (LLaVA model)
- Triggered on media upload when no description is provided

### WebRTC Calling
- Voice and video calls between users on the same instance or across federated instances
- Per-call `CallSignalingDO` Durable Object relays SDP offer/answer and ICE candidates
- Cross-instance signaling via ActivityPub (`CallOffer`, `CallAnswer`, `CallIceCandidate`, `CallHangup`)
- Incoming call overlay with accept/decline, active call panel with mute/camera/hangup controls
- ICE server configuration: Cloudflare STUN (`stun:stun.cloudflare.com:3478`) by default; optional TURN via Cloudflare Calls API

#### Optional TURN (Cloudflare Calls)
To enable TURN relay for users behind symmetric NAT:
```bash
wrangler secret put CALLS_TURN_KEY_ID
wrangler secret put CALLS_API_TOKEN
```
Credentials at [dash.cloudflare.com](https://dash.cloudflare.com) → Realtime → Calls → TURN.

### Scheduled tasks
- Cron trigger runs every minute for polling, auto-delete, and other maintenance tasks

## License

MIT
