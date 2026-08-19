// GET /.well-known/host-meta.json (RFC 7033 §4)
//
// JSON representation of the host-meta discovery document.
export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).hostname;
  const baseUrl = `https://${domain}`;

  return new Response(
    JSON.stringify({
      links: [
        {
          rel: "lrdd",
          type: "application/xrd+xml",
          template: `${baseUrl}/.well-known/webfinger?resource={uri}`,
        },
      ],
    }),
    {
      headers: {
        "Content-Type": "application/jrd+json; charset=utf-8",
      },
    }
  );
}