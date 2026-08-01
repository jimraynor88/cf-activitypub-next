/**
 * Queue-based delivery helpers for ActivityPub federation.
 *
 * Instead of blocking the request handler while delivering activities to
 * potentially dozens of remote servers, we enqueue delivery jobs and let the
 * Cloudflare Queue consumer worker handle them with automatic retries.
 */

import type { Queue } from "@cloudflare/workers-types";
import type { APActivity } from "@/lib/types";
import { deliverToInbox } from "./federation";

export interface APDeliveryMessage {
  type: "delivery";
  inboxUrl: string;
  activityJson: string; // JSON.stringify(APActivity)
  actorId: string; // local actor whose private key is used to sign
}

/**
 * Enqueue a batch of delivery jobs to a Cloudflare Queue.
 *
 * Falls back to direct, synchronous delivery when the queue binding is missing
 * or `sendBatch` throws (e.g. local dev, queue at capacity). This guarantees the
 * activity still reaches its recipients instead of being silently dropped after
 * the status was already persisted.
 */
export async function enqueueDeliveries(
  queue: Queue<APDeliveryMessage> | undefined | null,
  inboxUrls: string[],
  activityJson: string,
  actorId: string,
  keyId?: string,
  privateKeyPem?: string | null
): Promise<void> {
  const unique = [...new Set(inboxUrls)];
  if (unique.length === 0) return;

  try {
    if (!queue) {
      await deliverDirectly(unique, activityJson, keyId, privateKeyPem);
      return;
    }
    // Cloudflare Queues sendBatch limit: 100 messages per call
    for (let i = 0; i < unique.length; i += 100) {
      const batch = unique.slice(i, i + 100).map((inboxUrl) => ({
        body: {
          type: "delivery" as const,
          inboxUrl,
          activityJson,
          actorId,
        },
      }));
      await queue.sendBatch(batch);
    }
  } catch (err) {
    console.warn("[queue] enqueueDeliveries failed, falling back to direct delivery", err);
    await deliverDirectly(unique, activityJson, keyId, privateKeyPem);
  }
}

async function deliverDirectly(
  inboxUrls: string[],
  activityJson: string,
  keyId?: string,
  privateKeyPem?: string | null
): Promise<void> {
  if (!keyId || !privateKeyPem) return;
  let activity: APActivity;
  try {
    activity = JSON.parse(activityJson) as APActivity;
  } catch {
    return;
  }
  await Promise.allSettled(
    inboxUrls.map((inboxUrl) => deliverToInbox(inboxUrl, activity, keyId, privateKeyPem))
  );
}
