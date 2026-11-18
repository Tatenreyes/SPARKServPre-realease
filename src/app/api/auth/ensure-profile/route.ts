import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

// Fallback for deployments where the auth-user-created database trigger is absent.
// The caller must have a valid Supabase session; never accept a user ID from input.
export async function POST() {
  try {
    const sessionClient = createClient();
    const { data: { user }, error: userError } = await sessionClient.auth.getUser();

    if (userError || !user || !user.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createServiceRoleClient();
    const { data: existingProfile, error: lookupError } = await supabase
      .from("users")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();

    if (lookupError) throw lookupError;

    // Never change the role of an existing profile from this fallback endpoint.
    // Signup metadata may specify a new technician application, but it must not
    // be allowed to promote an existing customer or administrator.
    if (!existingProfile) {
      const role = user.user_metadata?.role === "technician" ? "technician" : "customer";
      const name = String(user.user_metadata?.name ?? user.email.split("@")[0]);

      const { error: insertError } = await supabase.from("users").upsert(
        { id: user.id, name, email: user.email, role },
        { onConflict: "id", ignoreDuplicates: true }
      );
      if (insertError) throw insertError;
    }

    // Re-read the persisted role, including in case another request inserted it.
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profileError) throw profileError;

    if (profile.role === "technician") {
      const { error: technicianError } = await supabase
        .from("technicians")
        .upsert({ id: user.id }, { onConflict: "id", ignoreDuplicates: true });
      if (technicianError) throw technicianError;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Unable to ensure account profile", error);
    return NextResponse.json({ error: "Unable to create account profile" }, { status: 500 });
  }
}
