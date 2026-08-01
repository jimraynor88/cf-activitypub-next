import { type NextRequest } from "next/server";
import { getCloudflareContext, json } from "@/lib/cf";
import { getModerationLog } from "@/lib/moderation/log";
import { requireAdmin } from "@/lib/admin-auth";

/**
 * GET /api/v1/admin/moderation_log — audit trail of every automated decision
 * the Guardian (AI) has taken: suspensions, warnings, deletions, approvals,
 * domain blocks, report resolutions, ...
 *
 * Query params: limit, offset, target_type, action, target_id
 */
export async function GET(request: NextRequest): Promise<Response> {
  const { env } = getCloudflareContext();
  if (!requireAdmin(request, env as unknown as { ADMIN_TOKEN?: string })) {
    return json({ error: "Unauthorized" }, 401);
  }

  const params = request.nextUrl.searchParams;
  const entries = await getModerationLog(env.DB, {
    limit: parseInt(params.get("limit") ?? "50", 10),
    offset: parseInt(params.get("offset") ?? "0", 10),
    targetType: params.get("target_type") ?? undefined,
    action: params.get("action") ?? undefined,
    targetId: params.get("target_id") ?? undefined,
  });

  return json({ log: entries });
}
