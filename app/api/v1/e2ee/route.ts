import { getCloudflareContext, json, getBaseUrl } from "@/lib/cf";
import { getAuthenticatedActor } from "@/lib/auth";
import {
  getActorById,
  getMlsMessagesByRecipient,
  getMlsKeyPackagesByActor,
  getMlsConversationsByRecipient,
} from "@/lib/db";
import type { NextRequest } from "next/server";

// GET /api/v1/e2ee
//
// View de la pantalla E2EE: mensajes MLS (envelopes cifrados), key packages y
// conversaciones del actor autenticado. Nunca descifra contenido.

export async function GET(request: NextRequest): Promise<Response> {
  const { env } = getCloudflareContext();
  const baseUrl = getBaseUrl(env);

  const actor = await getAuthenticatedActor(request, env.DB);
  if (!actor) return json({ error: "No autorizado" }, 401);

  const messages = await getMlsMessagesByRecipient(env.DB, actor.id, 100);
  const keyPackages = await getMlsKeyPackagesByActor(env.DB, actor.id);
  const conversations = await getMlsConversationsByRecipient(env.DB, actor.id);

  // Resolve sender display info in one pass (mirrors how timeline statuses embed accounts).
  const senderMap = new Map<string, { id: string; username: string; acct: string; displayName: string; avatarUrl: string | null }>();
  const hostname = new URL(baseUrl).hostname;
  const ids = [...new Set(messages.map((m) => m.actorId))];
  for (const id of ids) {
    const sender = await getActorById(env.DB, id);
    senderMap.set(id, sender
      ? {
          id: sender.id,
          username: sender.username,
          acct: sender.isLocal && sender.domain === hostname ? sender.username : `${sender.username}@${sender.domain}`,
          displayName: sender.displayName ?? sender.username,
          avatarUrl: sender.avatarUrl,
        }
      : { id, username: id, acct: id, displayName: id, avatarUrl: null });
  }

  const domain = new URL(baseUrl).hostname;
  return json({
    me: {
      id: actor.id,
      username: actor.username,
      acct: actor.username,
      displayName: actor.displayName ?? actor.username,
      avatarUrl: actor.avatarUrl,
      acctFull: `${actor.username}@${domain}`,
    },
    baseUrl,
    keyPackagesUrl: `${baseUrl}/users/${actor.username}/keyPackages`,
    messagesUrl: `${baseUrl}/users/${actor.username}/messages`,
    messages: messages.map((m) => ({
      id: m.id,
      recipientId: m.recipientId,
      type: m.type,
      objectType: m.objectType,
      actorId: m.actorId,
      sender: senderMap.get(m.actorId) ?? { id: m.actorId, username: m.actorId, acct: m.actorId, displayName: m.actorId, avatarUrl: null },
      conversation: m.conversation,
      content: m.content,
      published: m.published,
    })),
    keyPackages: keyPackages.map((kp) => ({
      id: kp.id,
      objectId: kp.objectId,
      ciphersuite: kp.ciphersuite,
      encoding: kp.encoding,
      content: kp.content,
      isActive: kp.isActive,
      createdAt: kp.createdAt,
    })),
    conversations,
  });
}