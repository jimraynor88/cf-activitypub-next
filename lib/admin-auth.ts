/**
 * Admin endpoint authentication.
 *
 * Admin routes are authorized by the authenticated actor's role stored in the
 * database (`admin` or `moderator`). A shared `ADMIN_TOKEN` secret remains
 * supported as a fallback for operator tooling that cannot log in as a user —
 * when it is configured, presenting it also grants access.
 */

import { getAuthenticatedActor } from "@/lib/auth";

export interface AdminAuthEnv {
  ADMIN_TOKEN?: string;
  DB: D1Database;
}

export async function requireAdmin(request: Request, env: AdminAuthEnv): Promise<boolean> {
  // Fallback: shared operator secret. When set, a matching bearer token grants
  // access regardless of the actor's role.
  const expected = env.ADMIN_TOKEN;
  if (expected) {
    const auth = request.headers.get("Authorization") ?? "";
    if (auth.startsWith("Bearer ")) {
      const token = auth.slice(7).trim();
      if (token && token.length === expected.length && token === expected) return true;
    }
  }

  // Primary path: the authenticated user must hold an admin/moderator role.
  const actor = await getAuthenticatedActor(request, env.DB);
  if (!actor) return false;
  if (actor.role === "admin" || actor.role === "moderator") return true;

  try {
    const row = await env.DB
      .prepare("SELECT role FROM actors WHERE id = ?")
      .bind(actor.id)
      .first<{ role: string }>();
    if (row && (row.role === "admin" || row.role === "moderator")) return true;
  } catch {
    // Missing role column — treat as non-admin.
  }

  return false;
}