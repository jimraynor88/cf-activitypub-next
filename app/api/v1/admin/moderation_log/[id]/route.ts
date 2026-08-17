import { type NextRequest } from "next/server";
import { getCloudflareContext, json, notFound } from "@/lib/cf";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * DELETE /api/v1/admin/moderation_log/:id — remove a single moderation_log row.
 * Allows an admin to prune the audit trail (e.g. noisy heuristic entries or
 * entries recorded for test accounts) without touching the rest of the log.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { env } = getCloudflareContext();
  if (!(await requireAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { id } = await params;
  const res = await env.DB.prepare("DELETE FROM moderation_log WHERE id = ?").bind(id).run();
  if (res.meta.changes === 0) return notFound();

  return json({ ok: true });
}
