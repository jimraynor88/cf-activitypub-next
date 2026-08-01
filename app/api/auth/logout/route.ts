import { clearAuthCookie } from "@/lib/auth";

export async function POST(): Promise<Response> {
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAuthCookie(),
    },
  });
}
