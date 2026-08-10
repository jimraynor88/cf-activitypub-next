import { getCloudflareContext, json, getBaseUrl } from "@/lib/cf";
import { getActorById, getMlsKeyPackagesByActor } from "@/lib/db";
import { validateOutboundUrl } from "@/lib/activitypub/federation";
import type { NextRequest } from "next/server";

// GET /api/v1/e2ee/keypackage?iri=<actorIri>
//
// Returns the recipient's latest active KeyPackage (as the MLS draft keyPackages
// collection would) so the client can encrypt a message to its init_key. The
// server never sees the plaintext — it only hands out the public key package.

export async function GET(request: NextRequest): Promise<Response> {
  const iri = (request.nextUrl.searchParams.get("iri") ?? "").trim();
  if (!iri) return json({ error: "iri parameter required" }, 422);

  const { env } = getCloudflareContext();
  const baseUrl = getBaseUrl(env);

  // Local actor → read its keyPackages collection from the database.
  if (iri.startsWith(baseUrl + "/")) {
    const actor = await getActorById(env.DB, iri);
    if (!actor) return json({ error: "Actor not found" }, 404);
    const kps = await getMlsKeyPackagesByActor(env.DB, actor.id, true);
    const kp = kps[0];
    if (!kp) return json({ error: "No active key package for this actor" }, 404);
    return json({
      objectId: kp.objectId,
      ciphersuite: kp.ciphersuite,
      mediaType: kp.mediaType,
      encoding: kp.encoding,
      content: kp.content,
    });
  }

  // Remote actor → fetch `${iri}/keyPackages` collection per the draft.
  const collectionUrl = `${iri.replace(/\/$/, "")}/keyPackages?page=true`;
  const val = validateOutboundUrl(collectionUrl);
  if (!val.valid) return json({ error: "Invalid IRI" }, 422);
  try {
    const res = await fetch(collectionUrl, {
      headers: { Accept: "application/activity+json, application/ld+json, application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return json({ error: "Could not fetch remote keyPackages" }, 404);
    const coll = (await res.json()) as { items?: { content?: string; id?: string }[] };
    const item = coll.items?.find((i) => i.content) ?? coll.items?.[0];
    if (!item?.content) return json({ error: "Remote actor has no key packages" }, 404);
    return json({
      objectId: item.id ?? null,
      ciphersuite: null,
      mediaType: "message/mls",
      encoding: "base64",
      content: item.content,
    });
  } catch {
    return json({ error: "Could not fetch remote keyPackages" }, 502);
  }
}