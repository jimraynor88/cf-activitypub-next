// GET /.well-known/host-meta (RFC 6415 / RFC 7033)
//
// XRD document advertising the WebFinger (lrdd) template used to resolve
// acct:user@domain resources on this instance.
export async function GET(request: Request): Promise<Response> {
  const domain = new URL(request.url).hostname;
  const baseUrl = `https://${domain}`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Link rel="lrdd" type="application/xrd+xml" template="${baseUrl}/.well-known/webfinger?resource={uri}">
    <Title>Resource Descriptor</Title>
  </Link>
</XRD>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xrd+xml; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
