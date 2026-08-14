import { type NextRequest } from "next/server";
import { getCloudflareContext, json, unauthorized } from "@/lib/cf";
import { getAuthenticatedActor } from "@/lib/auth";

// DELETE /api/v1/announcements/:id — Delete an announcement (admin/moderator only).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { env } = getCloudflareContext();

  const actor = await getAuthenticatedActor(request, env.DB);
  if (!actor) return unauthorized();

  const roleRow = await env.DB
    .prepare("SELECT role FROM actors WHERE id = ?")
    .bind(actor.id)
    .first<{ role: string }>();
  const role = roleRow?.role ?? "user";
  if (role !== "admin" && role !== "moderator") {
    return json({ error: "Only admins can delete announcements" }, 403);
  }

  const { id } = await params;
  const existing = await env.DB
    .prepare("SELECT id FROM announcements WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) return json({ error: "Announcement not found" }, 404);

  await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(id).run();
  return json({ success: true });
}