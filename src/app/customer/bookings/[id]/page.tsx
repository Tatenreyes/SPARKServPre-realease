import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MessageSquareText, ReceiptText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import PaymentForm from "@/components/PaymentForm";
import CustomerInspectionControl from "@/components/CustomerInspectionControl";
import CancelBookingControl from "@/components/CancelBookingControl";
import RatingForm from "@/components/RatingForm";
import AssignedTechnicianCard from "@/components/AssignedTechnicianCard";
import { buildTechnicianProfile } from "@/lib/technician-profile";

export default async function CustomerBookingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  // Ownership is asserted here as well as by RLS, exactly like the technician's job
  // page: a customer who guesses another customer's booking id gets a 404, not a page.
  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", params.id)
    .eq("customer_id", user!.id)
    .single();

  if (!booking) notFound();

  const { data: technicianUser } = await supabase
    .from("users")
    .select("id, name, avatar_url")
    .eq("id", booking.technician_id)
    .single();

  const { data: serviceRequest } = await supabase
    .from("service_requests")
    .select("appliance_type, status")
    .eq("id", booking.service_request_id)
    .single();

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: rating } = await supabase
    .from("ratings")
    .select("rating, comment")
    .eq("booking_id", params.id)
    .maybeSingle();

  // Who is coming: the published profile, built from the real ratings plus the
  // technician's own record. The cached `technicians.rating` column has no trigger
  // maintaining it, so the average is derived from the `ratings` rows — and a
  // technician with no reviews shows no rating rather than a permanent zero.
  const { data: technicianRatings } = await supabase
    .from("ratings")
    .select("rating")
    .eq("technician_id", booking.technician_id);

  const { data: technicianRecord } = await supabase
    .from("technicians")
    .select("approved, jobs_completed, experience_years, specializations")
    .eq("id", booking.technician_id)
    .maybeSingle();

  const technicianProfile = buildTechnicianProfile({
    user: technicianUser,
    technician: technicianRecord,
    ratings: technicianRatings,
  });

  // What the customer owes. The technician records `final_cost` when finishing
  // the job; legacy bookings may not have it, so fall back to the accepted
  // estimate — the same amount the payments API will accept.
  const { data: acceptedEstimate } = await supabase
    .from("estimates")
    .select("estimated_cost")
    .eq("service_request_id", booking.service_request_id)
    .eq("status", "accepted")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const amountDue = booking.final_cost ?? acceptedEstimate?.estimated_cost ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">
            Booking with {technicianUser?.name ?? "your technician"}
          </h1>
          <p className="text-sm text-ink/50">
            Scheduled: {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {/* Who is coming. This is the moment a customer decides whether to trust the
          visit, so the card carries the photo, the verification the queue itself
          applies, the rating from real reviews and the technician's record — and no
          contact details, which stay in the booking thread. */}
      {technicianProfile && (
        <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Your technician
          </p>
          <AssignedTechnicianCard technician={technicianProfile} className="mt-3" />
        </section>
      )}

      {/* The job order is the record the customer keeps: the appliance, the work
          performed, the parts, the amount and the verified reference, on one
          printable page. It exists only once the repair is closed, so the link
          appears only then — the receipt route explains itself otherwise. */}
      {booking.status === "completed" && (
        <Link
          href={`/customer/bookings/${booking.id}/receipt`}
          className="flex items-center justify-between gap-3 rounded-card border border-brand-300 bg-brand-soft/60 p-4 shadow-card transition hover:border-brand-400"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand-ink">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-ink">View your job order</span>
              <span className="block text-sm text-ink/50">
                The record of this repair — printable and keepable
              </span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink/35" aria-hidden="true" />
        </Link>
      )}

      {booking.status === "pending" && (
        <CancelBookingControl bookingId={booking.id} scheduledAt={booking.scheduled_at} />
      )}

      {/* Cancelling reopens the request (`quoted`) and keeps the approved estimate
          and the technician, so the customer can simply book another time. */}
      {booking.status === "cancelled" && serviceRequest?.status === "quoted" && (
        <div className="rounded-card border border-line bg-soft p-5">
          <h3 className="font-display text-base font-semibold text-ink">
            This appointment was cancelled
          </h3>
          <p className="mt-1 text-sm text-ink/60">
            Your approved estimate and your technician are unchanged, so you can pick
            another time whenever you are ready.
          </p>
          <Link
            href="/customer/estimates"
            className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
          >
            Book another time
          </Link>
        </div>
      )}

      {booking.status === "awaiting_inspection" && (
        <CustomerInspectionControl
          bookingId={booking.id}
          applianceType={serviceRequest?.appliance_type ?? "appliance"}
        />
      )}

      {/* Payment opens once the customer has confirmed the inspection, and the
          repair completes only when an administrator verifies the reference. A
          booking completed under the old policy still shows its payment record. */}
      {(booking.status === "awaiting_payment" || booking.status === "completed") && (
        <PaymentForm
          bookingId={booking.id}
          existingPayment={payment ?? null}
          amountDue={amountDue}
        />
      )}

      {booking.status === "completed" && (
        <RatingForm
          bookingId={booking.id}
          technicianName={technicianUser?.name ?? "your technician"}
          existingRating={rating ?? null}
        />
      )}

      {/* Messaging lives under Messages, not on this page. The thread used to be
          embedded here, below the payment and rating cards, which put a conversation
          inside a booking workflow and duplicated a destination the sidebar already
          has. This button is the way to it — the conversation itself, with its own
          composer and real-time updates, is at /customer/messages/<booking>. */}
      <Link
        href={`/customer/messages/${booking.id}`}
        className="flex items-center justify-between gap-3 rounded-card border border-ink/8 bg-surface p-4 shadow-card transition hover:border-brand-300"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              Message {technicianUser?.name ?? "your technician"}
            </span>
            <span className="block text-sm text-ink/50">Open the conversation</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink/35" aria-hidden="true" />
      </Link>
    </div>
  );
}
