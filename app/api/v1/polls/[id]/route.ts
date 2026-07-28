import { type NextRequest } from "next/server";
import { getCloudflareContext, json, notFound } from "@/lib/cf";
import { getPollById, getPollOptions, getPollVotesByActor, getObjectById, getActorById } from "@/lib/db";
import { getAuthenticatedActor } from "@/lib/auth";
import { serializePoll } from "@/lib/mastodon/serializers";
import { generateId } from "@/lib/activitypub/utils";
import { notify } from "@/lib/notify";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { env } = getCloudflareContext();
  const { id } = await params;

  const poll = await getPollById(env.DB, id);
  if (!poll) return notFound("Poll not found");

  const options = await getPollOptions(env.DB, id);
  const actor = await getAuthenticatedActor(request, env.DB);
  const ownVotes = actor ? await getPollVotesByActor(env.DB, id, actor.id) : [];

  // If poll has expired, notify the status author (only once via INSERT OR IGNORE)
  if (poll.expiresAt && new Date(poll.expiresAt) <= new Date()) {
    const obj = await getObjectById(env.DB, poll.objectId);
    if (obj) {
      const author = await getActorById(env.DB, obj.actorId);
      if (author) {
        await notify(env, {
          id: generateId(),
          type: "poll",
          accountId: obj.actorId,
          targetAccountId: obj.actorId,
          objectId: obj.id,
          read: false,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return json(serializePoll(poll, options, ownVotes.length > 0, ownVotes));
}
