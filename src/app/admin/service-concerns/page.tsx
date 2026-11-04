import { createServiceRoleClient } from "@/lib/supabase/server";
import AdminServiceConcernsClient from "@/components/AdminServiceConcernsClient";

/**
 * Service concerns.
 *
 * THE PRODUCT CALLS THEM CONCERNS; THE TABLE IS STILL `support_tickets`. A
 * concern is anything a customer raises that is not a repair job: a complaint
 * about one, an account or platform problem, a warranty question, feedback.
 * Renaming the table would be a migration plus RLS plus every query, for no
 * user-visible gain, so the mapping lives here and in DATABASE.md.
 *
 * The route moved from `/admin/support-tickets`, which now redirects here so old
 * links, bookmarks and quick actions keep working.
 */
export default async function AdminServiceConcernsPage() {
  const supabase = createServiceRoleClient();

  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("*")
    .order("created_at", { ascending: false });

  const userIds = Array.from(new Set((tickets ?? []).map((t) => t.user_id)));
  const { data: users } = userIds.length
    ? await supabase.from("users").select("id, name, email").in("id", userIds)
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Service concerns</h1>
      <p className="mt-1 text-sm text-ink/70">
        Complaints, account problems, warranty questions and feedback, in one queue.
      </p>
      <AdminServiceConcernsClient
        initialTickets={tickets ?? []}
        userInfo={Object.fromEntries((users ?? []).map((u) => [u.id, u]))}
      />
    </div>
  );
}
