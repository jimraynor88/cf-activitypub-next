import type { NextRequest } from "next/server";

// Builds an RFC 8288 Link header for Mastodon-style pagination, preserving the
// original query parameters (e.g. `local=true`) while swapping in the cursor.
export function buildPaginationLinks(
  request: NextRequest,
  oldestId: string,
  newestId?: string
): string {
  const next = new URL(request.url);
  next.searchParams.delete("max_id");
  next.searchParams.delete("min_id");
  next.searchParams.delete("since_id");
  next.searchParams.set("max_id", oldestId);
  let link = `<${next.toString()}>; rel="next"`;
  if (newestId) {
    const prev = new URL(request.url);
    prev.searchParams.delete("max_id");
    prev.searchParams.delete("min_id");
    prev.searchParams.delete("since_id");
    prev.searchParams.set("min_id", newestId);
    link += `, <${prev.toString()}>; rel="prev"`;
  }
  return link;
}