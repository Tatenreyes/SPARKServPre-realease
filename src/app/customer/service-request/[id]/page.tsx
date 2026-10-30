import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServiceTimezone } from "@/lib/service-time";
import { applianceCoverage } from "@/lib/assignment-coverage";
import { buildTechnicianProfile, type TechnicianProfile } from "@/lib/technician-profile";
import RequestDetailClient from "@/components/RequestDetailClient";

export default async function ServiceRequestDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const serviceTimeZone = await getServiceTimezone(supabase);

  const { data: request } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", params.id)
    .single();

  if (!request) notFound();

  const { data: estimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("service_request_id", params.id)
    .order("created_at", { ascending: true });

  let assignedTechnician: TechnicianProfile | null = null;
  if (request.assigned_technician_id) {
    const technicianId = request.assigned_technician_id;
    // The published profile only — name, photo, verification, rating, workload.
    // The `technicians` row and the ratings are read alongside the user so the card
    // can show real evidence instead of a bare name; each degrades to null rather
    // than inventing a zero.
    const [userResult, technicianResult, ratingsResult] = await Promise.all([
      supabase
        .from("users")
        .select("id, name, avatar_url")
        .eq("id", technicianId)
        .single(),
      supabase
        .from("technicians")
        .select("approved, jobs_completed, experience_years, specializations")
        .eq("id", technicianId)
        .maybeSingle(),
      supabase.from("ratings").select("rating").eq("technician_id", technicianId),
    ]);
    assignedTechnician = buildTechnicianProfile({
      user: userResult.data,
      technician: technicianResult.data,
      ratings: ratingsResult.data,
    });
  }

  // The assignment card must be able to say "nobody covers this appliance yet"
  // rather than the neutral "waiting" copy: the two look identical otherwise, and
  // only one of them is worth waiting for. Asked only while the request has no
  // technician, and `null` (the check could not run) keeps the neutral wording.
  const qualifiedTechnicianAvailable = request.assigned_technician_id
    ? null
    : await applianceCoverage(request.appliance_type);

  return (
    <RequestDetailClient
      request={request}
      initialEstimates={estimates ?? []}
      assignedTechnician={assignedTechnician}
      serviceTimeZone={serviceTimeZone}
      qualifiedTechnicianAvailable={qualifiedTechnicianAvailable}
    />
  );
}
