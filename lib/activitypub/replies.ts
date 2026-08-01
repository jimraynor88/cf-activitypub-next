/**
 * Reply threading helpers.
 *
 * Mastodon notifies the participants of a conversation when a reply is posted,
 * even if the reply text does not name anyone: the replied-to author and every
 * account mentioned anywhere in the thread are treated as mentions. This module
 * collects those participants so the status route can:
 *   - prepend their @handles to the reply content,
 *   - add Mention tags to the ActivityPub Note,
 *   - address them in `to` / `cc`,
 *   - and deliver the Create activity to their inboxes.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { APTag } from "@/lib/types";
import { getActorById, getObjectById } from "@/lib/db";

export interface ReplyParticipant {
  iri: string;
  username: string | null;
  domain: string | null;
  /**
   * Handle to insert into the reply text (e.g. `@alice` for local accounts or
   * `@alice@example.com` for remote ones). `null` when the actor could not be
   * resolved — the account is still addressed via a Mention tag + to/cc.
   */
  handle: string | null;
}

/** Minimal thread node shape — accepts stored LocalObject or a fetched APNote. */
export interface ThreadNode {
  actorId?: string | null;
  inReplyToId?: string | null;
  raw?: string;
  mentions?: APTag[];
}

/** Collect the Mention tags from a thread node (raw AP JSON or pre-parsed tags). */
function mentionsOf(node: ThreadNode): APTag[] {
  if (Array.isArray(node.mentions)) return node.mentions;
  if (!node.raw) return [];
  try {
    const parsed = JSON.parse(node.raw);
    return Array.isArray(parsed.tag) ? (parsed.tag as APTag[]) : [];
  } catch {
    return [];
  }
}

/** Parse a webfinger handle (`@alice` or `@alice@example.com`) into parts. */
export function parseHandle(name: string | undefined | null): { username: string | null; domain: string | null } {
  if (!name) return { username: null, domain: null };
  const cleaned = name.replace(/^@/, "");
  if (!cleaned) return { username: null, domain: null };
  const parts = cleaned.split("@");
  return {
    username: parts[0] ? parts[0].toLowerCase() : null,
    domain: parts[1] ? parts[1].toLowerCase() : null,
  };
}

/**
 * Walk up the reply chain starting from `parent` and collect every participant:
 * the author of each status plus everyone mentioned in it. Bounded traversal to
 * avoid runaway thread walks.
 */
export async function collectThreadParticipants(
  db: D1Database,
  parent: ThreadNode,
  baseUrl: string,
  opts: { maxDepth?: number } = {}
): Promise<ReplyParticipant[]> {
  const maxDepth = opts.maxDepth ?? 10;
  const localDomain = new URL(baseUrl).hostname;

  const byIri = new Map<string, { name?: string }>();
  let current: ThreadNode | null = parent;
  let depth = 0;

  while (current && depth < maxDepth) {
    if (current.actorId) {
      if (!byIri.has(current.actorId)) byIri.set(current.actorId, {});
    }
    for (const tag of mentionsOf(current)) {
      if (tag.type !== "Mention" || !tag.href) continue;
      const existing = byIri.get(tag.href);
      if (existing) {
        existing.name ??= tag.name;
      } else {
        byIri.set(tag.href, { name: tag.name });
      }
    }
    if (!current.inReplyToId) break;
    current = await getObjectById(db, current.inReplyToId);
    depth++;
  }

  const participants: ReplyParticipant[] = [];
  for (const [iri, info] of byIri) {
    participants.push(await resolveParticipant(db, iri, info.name, localDomain));
  }
  return participants;
}

async function resolveParticipant(
  db: D1Database,
  iri: string,
  tagName: string | undefined,
  localDomain: string
): Promise<ReplyParticipant> {
  let username: string | null = null;
  let domain: string | null = null;

  let hostname: string | null = null;
  try {
    hostname = new URL(iri).hostname;
  } catch {
    return { iri, username: null, domain: null, handle: null };
  }

  const cached = await getActorById(db, iri);
  if (cached) {
    username = cached.username;
    domain = cached.domain;
  } else {
    const parsed = parseHandle(tagName);
    username = parsed.username;
    domain = parsed.domain ?? hostname;
  }

  if (!username || !domain) {
    return { iri, username: null, domain: null, handle: null };
  }

  const handle = domain === localDomain ? `@${username}` : `@${username}@${domain}`;
  return { iri, username, domain, handle };
}

export interface ReplyMentions {
  /** Text to prepend to the reply content (space-separated @handles), or "". */
  text: string;
  /** Mention tags for participants that could not be rendered in text. */
  tags: APTag[];
}

/**
 * Decide which conversation participants to auto-mention in a reply.
 *
 * `alreadyMentionedKeys` should contain the normalized keys (`username@domain`)
 * already present in the user's text so we don't duplicate mentions. `selfId`
 * (the replying account) is always excluded.
 */
export async function buildReplyMentions(
  db: D1Database,
  parent: ThreadNode,
  baseUrl: string,
  selfId: string,
  alreadyMentionedKeys: ReadonlySet<string>,
  opts: { maxDepth?: number } = {}
): Promise<ReplyMentions> {
  const participants = await collectThreadParticipants(db, parent, baseUrl, opts);

  const text: string[] = [];
  const tags: APTag[] = [];
  const seen = new Set<string>();

  for (const p of participants) {
    if (p.iri === selfId) continue;
    const key = p.username && p.domain ? `${p.username}@${p.domain}` : p.iri.toLowerCase();
    if (seen.has(key) || alreadyMentionedKeys.has(key)) continue;
    seen.add(key);

    if (p.handle) {
      text.push(p.handle);
    } else {
      tags.push({ type: "Mention", href: p.iri });
    }
  }

  return { text: text.join(" "), tags };
}

/** Extract a normalized mention key from a content Mention tag (for dedup). */
export function mentionKey(tag: APTag): string | null {
  if (tag.type !== "Mention" || !tag.href) return null;
  if (tag.name) {
    const parsed = parseHandle(tag.name);
    if (parsed.username) {
      const domain = parsed.domain ?? new URL(tag.href).hostname;
      return `${parsed.username}@${domain}`.toLowerCase();
    }
  }
  try {
    return new URL(tag.href).hostname + tag.href;
  } catch {
    return tag.href;
  }
}
