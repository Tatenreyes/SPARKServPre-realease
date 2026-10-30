import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import JobOrderDocument from "@/components/JobOrderDocument";
import PrintButton from "@/components/PrintButton";
import { loadJobOrder } from "@/lib/job-order";

/**
 * The job order for one completed repair — the customer's copy of the record.
 *
 * Three guards, in this order:
 *
 *   1. **Authentication** — no session, no page.
 *   2. **Ownership** — `loadJobOrder()` filters on `customer_id = the caller`, so
 *      another customer's booking id resolves to `null` and this page answers
 *      404. RLS refuses the same read a second time; the query is defence in
 *      depth, not the boundary.
 *   3. **Completion** — a job order is issued only once the repair is closed
 *      (which `confirm_payment()` does in one transaction, after an administrator
 *      verified the payment). Before that the customer gets an explanation and a
 *      way back, never an empty document.
 *
 * Nothing here uses a service-role client: this is the customer's own record.
 */
export default async function JobOrderPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const loaded = await loadJobOrder(supabase, { bookingId: params.id, customerId: user.id });
  if (!loaded) notFound();

  const { booking, jobOrder } = loaded;

  if (booking.status !== "completed") {
    return (
      <div className="space-y-4">
        <BackToBooking bookingId={booking.id} />
        <div className="rounded-card border border-line bg-surface p-6">
          <p className="flex items-center gap-2 font-display text-base font-semibold text-ink">
            <Info className="h-4 w-4 shrink-0 text-brand-ink" aria-hidden="true" />
            The job order is issued when the repair is complete
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            A job order records the appliance serviced, the work performed, the parts used
            and the amount charged, so it is issued only after an administrator has verified
            your payment and the repair is closed. This appointment is currently{" "}
            <span className="font-semibold">{booking.status.replace(/_/g, " ")}</span>.
          </p>
          <Link
            href={`/customer/bookings/${booking.id}`}
            className="mt-4 inline-flex h-11 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600"
          >
            Back to this booking
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <BackToBooking bookingId={booking.id} />
        <PrintButton />
      </div>
      <JobOrderDocument jobOrder={jobOrder} />
    </div>
  );
}

function BackToBooking({ bookingId }: { bookingId: string }) {
  return (
    <Link
      href={`/customer/bookings/${bookingId}`}
      className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Back to this booking
    </Link>
  );
}
