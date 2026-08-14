import { type NextRequest } from "next/server";
import { getCloudflareContext, activityJson, notFound } from "@/lib/cf";
import { getActorByUsername, getActorFields, getMlsKeyPackagesByActor, countMlsMessagesByRecipient, getAllCustomEmojis } from "@/lib/db";
import { buildActor } from "@/lib/activitypub/utils";
import { processStatusContent, localSummaryToPlain, linkifyInline } from "@/lib/activitypub/content";

// GET /users/:username
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ username: string }> }
): Promise<Response> {
  const { env } = getCloudflareContext();
  const { username } = await params;
  const domain = new URL(request.url).hostname;

  const accept = request.headers.get("Accept") ?? "";
  // Redirect HTML requests to profile page
  if (accept.includes("text/html") && !accept.includes("application/activity+json")) {
    return Response.redirect(`https://${domain}/@${username}`, 302);
  }

  const actor = await getActorByUsername(env.DB, username, domain);
  if (!actor || !actor.isLocal) return notFound("Actor not found");

  const fields = await getActorFields(env.DB, actor.id);
  const baseUrl = `https://${domain}`;
  const emojis = await getAllCustomEmojis(env.DB);

  // Local actors store plain-text summaries (escaped, with <br />) and plain
  // field values. Linkify them into federated HTML so remote instances render
  // mentions/hashtags/URLs/custom emoji, mirroring what statuses do.
  const note = actor.summary
    ? processStatusContent(localSummaryToPlain(actor.summary), baseUrl, emojis)
    : { html: "", tags: [] };
  const linkifiedFields = fields.map((f) => ({
    name: f.name,
    value: linkifyInline(f.value, baseUrl, emojis),
  }));

  const keyPackageCount = (await getMlsKeyPackagesByActor(env.DB, actor.id)).length;
  const messageCount = await countMlsMessagesByRecipient(env.DB, actor.id);
  const apActor = buildActor(baseUrl, actor.username, {
    displayName: actor.displayName ?? undefined,
    summary: note.html,
    avatarUrl: actor.avatarUrl,
    headerUrl: actor.headerUrl,
    publicKeyPem: actor.publicKeyPem,
    manuallyApprovesFollowers: actor.manuallyApprovesFollowers,
    discoverable: actor.discoverable,
    isBot: actor.isBot,
    published: actor.createdAt,
    fields: linkifiedFields,
    tags: note.tags,
    alsoKnownAs: actor.alsoKnownAs ?? undefined,
    movedTo: actor.movedTo ?? undefined,
  });

  return activityJson({
    ...apActor,
    // MLS over ActivityPub (RFC 9420 draft) collections.
    keyPackages: {
      type: "Collection",
      totalItems: keyPackageCount,
      id: `${baseUrl}/users/${actor.username}/keyPackages`,
    },
    messages: {
      type: "OrderedCollection",
      totalItems: messageCount,
      id: `${baseUrl}/users/${actor.username}/messages`,
    },
  });
}
