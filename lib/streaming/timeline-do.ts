/**
 * TimelineStreamDO — Cloudflare Durable Object for real-time ActivityPub
 * timeline streaming using the WebSocket Hibernation API.
 *
 * A single instance is created per zone (name = "timeline").  WebSocket
 * clients connect through the Worker fetch handler, which upgrades the
 * connection and forwards it here.
 *
 * Channels:
 *   "public"          — all public statuses (federated / global timeline)
 *   "public:local"    — public statuses from local actors only
 *   "home:{username}" — home feed for a specific authenticated actor
 *   "hashtag:{tag}"   — public statuses tagged with a given hashtag
 *
 * WebSocket clients may send JSON messages to subscribe/unsubscribe from
 * additional channels after the initial connection:
 *   { "type": "subscribe",   "stream": "public" }
 *   { "type": "unsubscribe", "stream": "hashtag", "tag": "cats" }
 *
 * Abuse protection (connection caps per client IP, tracked durably so they
 * survive isolate eviction):
 *   - Anonymous connections (public / hashtag streams) are capped at 1 socket
 *     per IP and are force-closed after ANON_SOCKET_TTL_MS via a storage alarm,
 *     so nobody can keep an unauthenticated socket reading the instance forever.
 *   - Authenticated connections (home / notification / direct / list) are
 *     capped at AUTH_MAX_CONNS_PER_IP per IP.
 */

import { DurableObject as CFDurableObject } from "cloudflare:workers";

const ANON_MAX_CONNS_PER_IP = 1;
const AUTH_MAX_CONNS_PER_IP = 20;
/** Anonymous public streams are time-boxed to this session length. */
const ANON_SOCKET_TTL_MS = 5 * 60 * 1000;
/** How long a stale connection record may linger before being cleaned up. */
const ANON_RECORD_MAX_AGE_MS = ANON_SOCKET_TTL_MS + 60_000;
const AUTH_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Map a Mastodon stream name + optional tag/list to an internal channel name. */
function resolveStreamToChannel(stream: string, tag?: string | null, listId?: string | null): string | null {
  switch (stream) {
    case "public":
    case "public:media":
      return "public";
    case "public:local":
    case "public:local:media":
      return "public:local";
    case "public:remote":
    case "public:remote:media":
      return "public:remote";
    case "hashtag":
      return tag ? `hashtag:${tag.toLowerCase()}` : null;
    case "hashtag:local":
      return tag ? `hashtag:local:${tag.toLowerCase()}` : null;
    case "list":
      return listId ? `list:${listId}` : null;
    // user, user:notification, direct are server-resolved before connecting;
    // clients may also subscribe to them dynamically via subscribe message.
    // We accept them but can only serve if the initial connection was already authenticated.
    case "user":
    case "user:notification":
    case "direct":
      return null; // can't resolve without user context here
    default:
      return null;
  }
}

type SocketAttachment = {
  channels?: string[];
  initialChannel?: string;
  ip?: string;
  socketId?: string;
  anon?: boolean;
  anonCreatedAt?: number;
};

export class TimelineStreamDO extends CFDurableObject {
  readonly state: DurableObjectState;

  constructor(state: DurableObjectState, env: never) {
    super(state, env);
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      return this.handleConnect(request, url);
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      return this.handleBroadcast(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ─── WebSocket upgrade ────────────────────────────────────────────────────

  private async handleConnect(request: Request, url: URL): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const channel = url.searchParams.get("channel") ?? "public";
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    // Public/hashtag streams are anonymous unless the worker resolved a valid
    // token (logged-in users viewing the public timeline) and flagged the
    // connection as authenticated.
    const authed = url.searchParams.get("authed") === "1";
    const isAnon = !authed && (channel.startsWith("public") || channel.startsWith("hashtag"));
    // IPs are encodeURIComponent'd so the ":"-separated key stays parseable
    // even for IPv6 addresses.
    const ipKey = encodeURIComponent(ip);

    // Per-IP connection cap. Counts live in durable storage so they survive
    // isolate eviction; stale records are pruned by age as a safety net.
    const prefix = `stream_conn:${ipKey}:`;
    const activeKeys = await this.state.storage.list({ prefix, limit: 100 });

    let active = 0;
    for (const [key] of activeKeys) {
      const rec = (await this.state.storage.get<{ k: "anon" | "auth"; c: number }>(key)) ?? {
        k: "auth",
        c: 0,
      };
      const maxAgeMs = rec.k === "anon" ? ANON_RECORD_MAX_AGE_MS : AUTH_RECORD_MAX_AGE_MS;
      if (Date.now() - rec.c > maxAgeMs) {
        this.state.waitUntil(this.state.storage.delete(key));
        continue;
      }
      active++;
    }

    const maxConns = isAnon ? ANON_MAX_CONNS_PER_IP : AUTH_MAX_CONNS_PER_IP;
    if (active >= maxConns) {
      return new Response(
        JSON.stringify({ error: "Too many concurrent streaming connections from this address" }),
        { status: 429, headers: { "Content-Type": "application/json" } }
      );
    }

    const socketId = crypto.randomUUID();
    await this.state.storage.put(`${prefix}${socketId}`, {
      k: isAnon ? "anon" : "auth",
      c: Date.now(),
    });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    // Tag the hibernated socket with the channel name so we can fan-out by tag.
    // Also store the initial channel in the attachment for dynamic subscription tracking.
    this.state.acceptWebSocket(server, [channel]);
    server.serializeAttachment({
      channels: [],
      initialChannel: channel,
      ip,
      socketId,
      ...(isAnon ? { anon: true, anonCreatedAt: Date.now() } : {}),
    } satisfies SocketAttachment);

    // Time-box anonymous public streams so an unauthenticated socket cannot
    // idle forever and read the instance without limit.
    if (isAnon) {
      await this.state.storage.setAlarm(Date.now() + ANON_SOCKET_TTL_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── Broadcast endpoint ───────────────────────────────────────────────────

  private async handleBroadcast(request: Request): Promise<Response> {
    let body: { channel: string; event: string; payload: string };
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    const { channel, event, payload } = body;
    if (!channel || !event) {
      return new Response("Missing channel or event", { status: 400 });
    }

    // Mastodon streaming wire format
    const message = JSON.stringify({ stream: [channel], event, payload });

    // 1. Send to sockets whose initial channel tag matches
    const taggedSockets = new Set(this.state.getWebSockets(channel));
    for (const ws of taggedSockets) {
      try { ws.send(message); } catch { /* disconnected — hibernation handles cleanup */ }
    }

    // 2. Also send to sockets that subscribed to this channel dynamically
    //    via a subscribe message after the initial connection.
    for (const ws of this.state.getWebSockets()) {
      if (taggedSockets.has(ws)) continue; // already sent above
      const attachment = (ws.deserializeAttachment() ?? {}) as SocketAttachment;
      if (attachment.channels?.includes(channel)) {
        try { ws.send(message); } catch { /* disconnected */ }
      }
    }

    return new Response(null, { status: 204 });
  }

  // ─── WebSocket Hibernation callbacks ──────────────────────────────────────

  /**
   * Storage alarm — wakes the hibernated DO to force-close anonymous public
   * stream sockets that have reached ANON_SOCKET_TTL_MS, then reschedules for
   * the nearest remaining expiry (if any anonymous sockets are still open).
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    let nextExpiry = Infinity;

    for (const ws of this.state.getWebSockets()) {
      const att = (ws.deserializeAttachment() ?? {}) as SocketAttachment;
      if (att.anon && att.anonCreatedAt != null) {
        const age = now - att.anonCreatedAt;
        if (age >= ANON_SOCKET_TTL_MS) {
          try { ws.close(1000, "public stream session expired"); } catch { /* already closed */ }
        } else {
          nextExpiry = Math.min(nextExpiry, att.anonCreatedAt + ANON_SOCKET_TTL_MS);
        }
      }
    }

    if (nextExpiry !== Infinity) {
      await this.state.storage.setAlarm(nextExpiry);
    }
  }

  /** Release this socket's per-IP connection slot. */
  private removeConnection(ws: WebSocket): void {
    const att = (ws.deserializeAttachment() ?? {}) as SocketAttachment;
    if (att.ip && att.socketId) {
      this.state.waitUntil(
        this.state.storage.delete(`stream_conn:${encodeURIComponent(att.ip)}:${att.socketId}`)
      );
    }
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string") return;
    const text = message.trim();

    // Keep-alive ping
    if (text === "ping") {
      ws.send("pong");
      return;
    }

    // Mastodon subscribe / unsubscribe messages
    try {
      const msg = JSON.parse(text) as { type?: string; stream?: string; tag?: string; list?: string };
      if (!msg.type || !msg.stream) return;

      let channel = resolveStreamToChannel(msg.stream, msg.tag, msg.list);
      if (!channel) {
        // Authenticated streams (user, user:notification, direct) are resolved by
        // the worker before connecting. If the client subscribes to one dynamically,
        // fall back to the initial channel the socket was tagged with.
        const authStreams = ["user", "user:notification", "direct"];
        if (authStreams.includes(msg.stream)) {
          const attachment = (ws.deserializeAttachment() ?? {}) as SocketAttachment;
          channel = attachment.initialChannel ?? null;
        }
      }
      if (!channel) {
        // Per Mastodon spec: send error JSON over the socket for unknown streams
        ws.send(JSON.stringify({ error: "Unknown stream type", status: 400 }));
        return;
      }

      const attachment = ((ws.deserializeAttachment() ?? {}) as SocketAttachment);
      const channels = new Set(attachment.channels ?? []);

      if (msg.type === "subscribe") {
        channels.add(channel);
        ws.serializeAttachment({ channels: Array.from(channels) } satisfies SocketAttachment);
      } else if (msg.type === "unsubscribe") {
        channels.delete(channel);
        ws.serializeAttachment({ channels: Array.from(channels) } satisfies SocketAttachment);
      }
    } catch {
      // Not valid JSON — ignore silently
    }
  }

  webSocketClose(ws: WebSocket): void {
    this.removeConnection(ws);
    ws.close();
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error("[TimelineStreamDO] WebSocket error:", error);
    this.removeConnection(ws);
    ws.close();
  }
}
