import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getServiceTimezone } from "@/lib/service-time";
import AvailabilityManager from "@/components/AvailabilityManager";

/**
 * When the technician can work: the three inputs the queue actually reads.
 *
 * Split out of `/technician/profile`, which had grown into two jobs. This is the
 * half the rotation depends on — weekly windows, time off and service areas — so
 * it is the half that earns a place in the sidebar, under the name a technician
 * looks for. "Profile" then keeps its one meaning: who they are (name, photo,
 * specialisations), reached from the topbar avatar menu.
 *
 * Times are entered in the SERVICE timezone, so it is resolved here on the server
 * and handed down; `AvailabilityManager` explains why that matters.
 */
export default async function TechnicianAvailabilityPage() {
  const supabase = createClient();
  const serviceTimeZone = await getServiceTimezone(supabase);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink">
          Availability
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-ink">When you can work</h1>
        <p className="mt-2 text-sm text-muted">
          Control which jobs reach you. SPARKServ&apos;s queue only offers work you are qualified
          for, free for, and able to travel to.
        </p>
      </div>

      <AvailabilityManager serviceTimeZone={serviceTimeZone} />

      {/* The other half of "will this job reach me?" is which appliances you
          service, and that lives on the profile. One sentence here is cheaper than
          a technician wondering why an empty schedule still lets work through. */}
      <p className="text-xs leading-relaxed text-muted">
        Which appliances you service is on your{" "}
        <Link
          href="/technician/profile"
          className="font-semibold text-brand-ink underline-offset-2 hover:underline"
        >
          profile
        </Link>
        . Both are needed to receive offers: a specialisation puts you at the end of that
        appliance&apos;s rotation, and these windows decide which of its jobs you are free for.
      </p>
    </div>
  );
}
