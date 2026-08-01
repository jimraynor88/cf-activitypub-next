import type { D1Database } from "@cloudflare/workers-types";
import { createNotification } from "@/lib/db";
import type { LocalNotification } from "@/lib/types";
import { broadcastNotificationEvent, type DONamespace } from "@/lib/streaming/broadcast";
import { deliverPushSafe } from "@/lib/push";

export interface NotifyEnv {
  DB: D1Database;
  TIMELINE_STREAM?: DONamespace;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_EMAIL?: string;
}

export async function notify(env: NotifyEnv, notif: LocalNotification): Promise<void> {
  await createNotification(env.DB, notif);
  if (env.TIMELINE_STREAM) {
    void broadcastNotificationEvent(env.TIMELINE_STREAM, notif.targetAccountId).catch(() => {});
  }
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_EMAIL) {
    void deliverPushSafe(env.DB, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_EMAIL, notif);
  }
}