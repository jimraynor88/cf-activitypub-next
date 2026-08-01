import { type NextRequest } from "next/server";
import { getCloudflareContext, json, notFound } from "@/lib/cf";
import { getActorById } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { env } = getCloudflareContext();

  if (!requireAdmin(request, env as unknown as { ADMIN_TOKEN?: string })) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { id } = await params;
  const actor = await getActorById(env.DB, id);
  if (!actor) return notFound();

  await env.DB.prepare("DELETE FROM actors WHERE id = ?").bind(id).run();

  return json({});
}
