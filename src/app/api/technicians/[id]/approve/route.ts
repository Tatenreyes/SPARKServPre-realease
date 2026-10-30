import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";
import { rematchWaitingRequests } from "@/lib/assignment";
import { notify } from "@/lib/notifications";

// PATCH /api/technicians/:id/approve — admin/super_admin approves a pending technician
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole(["admin", "super_admin"]);

    const body = await request.json().catch(() => ({}));
    const approve = body.approve ?? true;

    // service-role client: approving a technician crosses role boundaries,
    // which is exactly the kind of action normal RLS policies are meant to block
    // for everyone except an authenticated admin — enforced above via requireRole.
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("technicians")
      .update({
        approved: approve,
        approved_at: approve ? new Date().toISOString() : null,
        approved_by: approve ? admin.id : null,
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    // A newly-approved technician might be the missing eligible technician
    // for requests previously stuck "waiting" with nobody qualified.
    if (approve) {
      await rematchWaitingRequests(supabase);
    }

    // The technician is told either way. Approval is the one event that turns a
    // signed-up account into one that can actually receive work, so it is worth a
    // notification; a refusal is worth one too, because otherwise the technician
    // sees an empty queue and has no idea why.
    try {
      await notify(supabase, {
        userId: params.id,
        type: approve ? "technician_approved" : "technician_not_approved",
        title: approve ? "Your account is verified" : "Your account was not approved",
        body: approve
          ? "You are now in the rotation for the appliances you service, and offers will arrive here."
          : "An administrator reviewed your application and did not approve it. Contact support if you believe this is a mistake.",
        link: "/technician/dashboard",
      });
    } catch (notifyError) {
      console.error("Technician approval notification failed", notifyError);
    }

    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
