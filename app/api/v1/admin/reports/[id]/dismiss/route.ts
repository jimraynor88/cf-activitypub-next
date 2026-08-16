import { type NextRequest } from "next/server";
import { getCloudflareContext, json, notFound } from "@/lib/cf";
import { getReportById } from "@/lib/db";
import { requireAdmin } from "@/lib/admin-auth";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { env } = getCloudflareContext();

  if (!(await requireAdmin(request, env))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { id } = await params;
  const report = await getReportById(env.DB, id);
  if (!report) return notFound();

  await env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();

  return json({ id, action_taken: false, dismissed: true });
}
