import { type NextRequest } from "next/server";
import { getCloudflareContext, json } from "@/lib/cf";
import { requireAdmin } from "@/lib/admin-auth";

export async function GET(request: NextRequest): Promise<Response> {
  const { env } = getCloudflareContext();

  if (!requireAdmin(request, env as unknown as { ADMIN_TOKEN?: string })) {
    return json({ error: "Unauthorized" }, 401);
  }

  const rows = await env.DB
    .prepare("SELECT domain FROM domain_blocks GROUP BY domain")
    .all<{ domain: string }>();

  return json(rows.results.map((r, i) => ({
    id: String(i + 1),
    domain: r.domain,
    created_at: new Date().toISOString(),
    severity: "silence",
    reject_media: false,
    reject_reports: false,
    private_comment: null,
    public_comment: null,
    obfuscate: false,
  })));
}
