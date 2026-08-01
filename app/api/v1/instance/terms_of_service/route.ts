import { getCloudflareContext, json } from "@/lib/cf";

export async function GET(): Promise<Response> {
  const { env } = getCloudflareContext();
  return json({
    content: env.INSTANCE_DESCRIPTION ?? "Terms of service not configured.",
    updated_at: null,
  });
}
