import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";
import type { UserRole } from "@/types/database";

const VALID_ROLES: UserRole[] = ["customer", "technician", "admin", "super_admin"];

/** Codes that mean "the function is not in this database yet". */
const MISSING_FUNCTION = new Set([
  "42883", // undefined_function
  "PGRST202", // PostgREST: function not found in the schema cache
]);

/**
 * PATCH /api/users/:id/role, super_admin only, full system control over roles.
 *
 * The change goes through `set_user_role()` (`supabase/migration_set_user_role.sql`)
 * instead of a bare update, because `public.users.role` and the `technicians` row have
 * to move together: the profile is what every guard reads, and the `technicians` row is
 * what `/admin/technicians` lists and what approval acts on. Written separately they
 * drift — a promoted customer with no row cannot be approved by anybody — which is the
 * gap `POST /api/admin/technicians/repair` exists to close after the fact.
 *
 * The caller's own client is used deliberately, exactly as `admin_queue_override` is
 * called: the function re-checks `super_admin` inside, and that check reads the caller
 * from `auth.uid()`, which only a user-scoped client provides.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(["super_admin"]);

    const { role } = await request.json();
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("set_user_role", {
      p_user_id: params.id,
      p_role: role,
    });

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);

    // A deployment can be ahead of its database: `set_user_role()` is added by
    // `supabase/migration_set_user_role.sql`, applied by hand in the SQL Editor. Until
    // it is, the RPC is absent and this used to be a bare 500 that named nothing — the
    // administrator would see a role that simply would not change. So that one class of
    // failure says which file to run, with the `SERVICE_SETUP_REQUIRED` code
    // `PATCH /api/support-tickets/[id]` already uses for a schema gap.
    if (MISSING_FUNCTION.has((err as { code?: string })?.code ?? "")) {
      return NextResponse.json(
        {
          error:
            "This database is missing the transactional role change. Apply supabase/migration_set_user_role.sql, then change the role again.",
          code: "SERVICE_SETUP_REQUIRED",
        },
        { status: 503 }
      );
    }

    // `P0001` is `raise exception`, which here means the DATABASE refused the change by
    // one of its own rules — changing your own role away from super_admin, or removing
    // the last active super administrator. Those are decisions, not failures, and the
    // message is the whole point of them, so it is passed through as a 400 rather than
    // swallowed into "Internal server error". The strings are static and carry no data.
    if ((err as { code?: string })?.code === "P0001" && typeof (err as { message?: string })?.message === "string") {
      return NextResponse.json({ error: (err as { message: string }).message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
