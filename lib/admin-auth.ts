/**
 * Optional shared-secret protection for admin endpoints.
 *
 * The instance has no human admin (the AI Guardian manages it), so the admin
 * API is only meant for tooling / the operator. When the `ADMIN_TOKEN` secret
 * is configured, requests to admin routes must send `Authorization: Bearer
 * <token>`. Without it, the routes stay open (current behaviour) so existing
 * clients keep working until the operator opts in.
 */

export function requireAdmin(request: Request, env: { ADMIN_TOKEN?: string }): boolean {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return true;

  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;

  // Constant-time-ish comparison is overkill for this use, but avoid
  // leaking length differences trivially.
  return token.length === expected.length && token === expected;
}
