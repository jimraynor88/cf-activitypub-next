import { json } from "@/lib/cf";

export async function GET(): Promise<Response> {
  return json({
    content: "Privacy policy not configured.",
    updated_at: null,
  });
}
