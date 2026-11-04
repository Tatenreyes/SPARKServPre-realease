import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { UserRole, UserRow } from "@/types/database";

/**
 * Fetches the currently authenticated user's full profile row
 * (including role) inside a Server Component / Route Handler.
 * Returns null if nobody is logged in.
 */
export async function getCurrentUser(): Promise<UserRow | null> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.is_active) return null;

  return profile as UserRow;
}

/**
 * The signed-in user for a PAGE, or a redirect to the sign-in screen.
 *
 * WHY THIS EXISTS. `getCurrentUser()` answers a question — "who is this?" — and
 * `null` is a legitimate answer: no session, no profile row, or a DEACTIVATED
 * account (`!profile.is_active`). Page components were treating that answer as
 * impossible, with `user!.id`, so the moment it was null the page crashed:
 *
 *   Error: Cannot read properties of null (reading 'id')
 *   src/app/customer/dashboard/page.tsx (36:32)
 *
 * That was not hypothetical. Deactivating a customer from `/admin/users` kept
 * their session valid, the middleware checked only the account's ROLE and let
 * them through, and every customer page then dereferenced a null user — a white
 * screen where the customer should have been told their account was closed.
 * The middleware now refuses an inactive account as well; this function is the
 * second layer, so a session that expires between the middleware and the render
 * redirects instead of crashing.
 *
 * Use it in a page / Server Component, where the answer to "no user" is to send
 * them to sign in. Route handlers keep `getCurrentUser()` (returns null) or
 * `requireRole()` (throws a 401/403 the route answers with), because a redirect
 * makes no sense for JSON.
 */
export async function requireUser(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Throws if the current user isn't logged in or isn't one of the allowed
 * roles. Use inside API routes as a guard clause:
 *
 *   const user = await requireRole(["admin", "super_admin"]);
 */
export async function requireRole(allowedRoles: UserRole[]): Promise<UserRow> {
  const user = await getCurrentUser();

  if (!user) {
    throw new AuthError("Not authenticated", 401);
  }

  if (!allowedRoles.includes(user.role)) {
    throw new AuthError("Not authorized for this action", 403);
  }

  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
