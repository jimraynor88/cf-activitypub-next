import { type NextRequest } from "next/server";
import { json, getCloudflareContext } from "@/lib/cf";
import { getObjectById, getObjectEditHistory, getActorById } from "@/lib/db";
import { serializeAccount } from "@/lib/mastodon/serializers";
import { decodeStatusId } from "@/lib/mastodon/statusId";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { env } = getCloudflareContext();
  const { id } = await params;
  const domain = new URL(request.url).hostname;

  const obj = await getObjectById(env.DB, decodeStatusId(id, domain));
  if (!obj) return json([]);

  const actor = await getActorById(env.DB, obj.actorId);
  if (!actor) return json([]);

  const edits = await getObjectEditHistory(env.DB, obj.id);
  const account = serializeAccount(actor, domain);

  return json(
    edits.map((e) => ({
      content: e.content ?? "",
      spoiler_text: e.contentWarning ?? "",
      sensitive: e.sensitive,
      created_at: e.createdAt,
      account,
    }))
  );
}
