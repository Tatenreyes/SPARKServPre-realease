import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";

/** Supabase's admin API lists users in pages of 1000; the walk stops before 20 000. */
const PER_PAGE = 1000;
const MAX_PAGES = 20;

/**
 * POST /api/admin/technicians/repair — the explicit, administrator-only repair of the
 * rows a missing `on_auth_user_created` trigger would have left behind.
 *
 * WHY THIS EXISTS. `/admin/technicians` used to perform this repair *while rendering*:
 * it listed every auth user whose `user_metadata.role` was `technician` and promoted
 * each one to the `technician` role with the service role. Metadata is writable by the
 * account holder, and the trigger that refuses self-promotion (`prevent_role_change()`)
 * exempts the service role — so any customer could claim the role by editing their own
 * metadata and waiting for an administrator to open the page. A page render is not a
 * decision, so the repair moved here, where it is one.
 *
 * WHAT IT DOES — and the two boundaries that make it unable to escalate anybody:
 *
 *   1. `public.users` is written ONLY where the row is MISSING, and from the same
 *      two-value whitelist the signup trigger uses (`technician`, else `customer`).
 *      An existing profile is never touched, so `user_metadata.role` cannot promote
 *      an existing account — not through this endpoint, and (since the fallback
 *      endpoint applies the same rule) not through `POST /api/auth/ensure-profile`
 *      either. Promoting an existing customer stays a deliberate super-administrator
 *      action: `PATCH /api/users/[id]/role`.
 *   2. a `technicians` row is created only where the role is ALREADY `technician` in
 *      the database, and it starts unapproved. Approval — the step that lets somebody
 *      receive work — remains `PATCH /api/technicians/[id]/approve`. That second pass
 *      is also what makes a newly promoted technician visible on this screen after a
 *      role change, since it reads the persisted role and never the metadata.
 *
 * Deactivated accounts are skipped, in both passes. The endpoint is idempotent, it
 * reports what it changed, and it is the only place that heals a missing signup row for
 * somebody else's account — `POST /api/auth/ensure-profile` heals your own.
 */
export async function POST() {
  try {
    await requireRole(["admin", "super_admin"]);
    const supabase = createServiceRoleClient();

    /* 1. Signed up as a technician, but has no profile row at all. --------------------------------- */
    let profilesCreated = 0;

    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PER_PAGE });
      if (error) throw error;
      const authUsers = data?.users ?? [];

      for (const authUser of authUsers) {
        if (authUser.user_metadata?.role !== "technician" || !authUser.email) continue;

        const { data: profile, error: lookupError } = await supabase
          .from("users")
          .select("id")
          .eq("id", authUser.id)
          .maybeSingle();
        if (lookupError) throw lookupError;

        // The whole point: an account that already exists is left exactly as it is.
        if (profile) continue;

        // Mirrors `handle_new_user()` and `ensure-profile`: two values, nothing else.
        const role = authUser.user_metadata?.role === "technician" ? "technician" : "customer";
        const name = String(authUser.user_metadata?.name ?? authUser.email.split("@")[0]);

        const { error: insertError } = await supabase
          .from("users")
          .upsert(
            { id: authUser.id, name, email: authUser.email, role },
            { onConflict: "id", ignoreDuplicates: true }
          );
        if (insertError) throw insertError;
        profilesCreated += 1;
      }

      if (authUsers.length < PER_PAGE) break;
    }

    /* 2. Role is `technician` in the database, but the technicians row is missing. ----------------- */
    const { data: technicianProfiles, error: technicianProfilesError } = await supabase
      .from("users")
      .select("id, is_active")
      .eq("role", "technician");
    if (technicianProfilesError) throw technicianProfilesError;

    const { data: existingRows, error: existingRowsError } = await supabase
      .from("technicians")
      .select("id");
    if (existingRowsError) throw existingRowsError;
    const hasTechnicianRow = new Set((existingRows ?? []).map((row) => row.id));

    let technicianRowsCreated = 0;
    let inactiveNotRepaired = 0;

    for (const profile of technicianProfiles ?? []) {
      if (hasTechnicianRow.has(profile.id)) continue;
      if (!profile.is_active) {
        // Recreating a row for a closed account would put it back in front of
        // administrators as a pending application. Opening an account is a separate,
        // deliberate decision (`PATCH /api/users/[id]/status`).
        inactiveNotRepaired += 1;
        continue;
      }

      const { error } = await supabase
        .from("technicians")
        .upsert({ id: profile.id }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw error;
      technicianRowsCreated += 1;
    }

    return NextResponse.json({
      data: {
        profiles_created: profilesCreated,
        technician_rows_created: technicianRowsCreated,
        inactive_not_repaired: inactiveNotRepaired,
      },
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Technician record repair failed", err);
    return NextResponse.json({ error: "Unable to repair the technician records" }, { status: 500 });
  }
}
