import { json } from "@/lib/cf";

export async function GET(): Promise<Response> {
  return json({
    source: ["en", "es"],
    target: ["en", "es"],
  });
}
