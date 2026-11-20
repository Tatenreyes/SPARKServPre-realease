import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ServiceConcernsClient from "@/components/ServiceConcernsClient";

export default async function TechnicianSupportPage() {
  const user = await requireUser();
  const supabase = createClient();
  const { data: tickets, error } = await supabase
    .from("support_tickets")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Support</h1>
        <p className="mt-1 text-sm text-muted">Send a concern to the admin team and see their resolution here.</p>
      </div>
      <ServiceConcernsClient initialTickets={tickets ?? []} />
    </div>
  );
}
