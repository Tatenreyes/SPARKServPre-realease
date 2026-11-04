import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const ROLE_PREFIXES: Record<string, string[]> = {
  "/customer": ["customer", "admin", "super_admin"],
  "/technician": ["technician", "admin", "super_admin"],
  "/admin": ["admin", "super_admin"],
  "/superadmin": ["super_admin"],
};

export async function middleware(request: NextRequest) {
  const { response, user, supabase } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  const matchedPrefix = Object.keys(ROLE_PREFIXES).find((prefix) =>
    pathname.startsWith(prefix)
  );

  if (!matchedPrefix) {
    return response;
  }

  // Not logged in at all → send to login
  if (!user) {
    const authPath = pathname.startsWith("/customer/request-repair")
      ? "/choose"
      : "/login";
    const authUrl = new URL(authPath, request.url);
    authUrl.searchParams.set("redirectTo", pathname);
    return NextResponse.redirect(authUrl);
  }

  // Logged in, check their role against the section they're trying to reach
  const { data: profile } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  const allowedRoles = ROLE_PREFIXES[matchedPrefix];
  if (!profile || !allowedRoles.includes(profile.role)) {
    return NextResponse.redirect(new URL("/unauthorized", request.url));
  }

  // A DEACTIVATED account still holds a valid session, so checking the role alone
  // let it straight into the workspace — where `getCurrentUser()` returns null for
  // an inactive profile and every page's `user!.id` crashed with "Cannot read
  // properties of null (reading 'id')". An administrator deactivating a customer
  // in /admin/users produced exactly that white screen for the customer. The
  // reason is passed so the page can say what actually happened.
  if (!profile.is_active) {
    return NextResponse.redirect(new URL("/unauthorized?reason=inactive", request.url));
  }

  // Maintenance mode gates customers/technicians only, admins still need access
  if (profile.role === "customer" || profile.role === "technician") {
    const { data: setting } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .single();

    if (setting?.value === "true" && !pathname.startsWith("/maintenance")) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/customer/:path*",
    "/technician/:path*",
    "/admin/:path*",
    "/superadmin/:path*",
  ],
};
