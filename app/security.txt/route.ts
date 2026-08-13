// GET /security.txt — canonical redirect to /.well-known/security.txt.
export async function GET(request: Request): Promise<Response> {
  return Response.redirect(new URL("/.well-known/security.txt", request.url).toString(), 302);
}