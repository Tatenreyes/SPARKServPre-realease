import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, isBookableEstimate } from "@/lib/estimate-costs";
import type { EstimateRow } from "@/types/database";
import { Wrench, Wallet, Star, ShieldCheck, CalendarX2, ArrowRight } from "lucide-react";

/**
 * Past jobs — the technician's own record of finished work.
 *
 * WHY THIS EXISTS. A completed repair used to leave the technician's screens
 * entirely except for one line in My jobs ("Air Conditioner · 29/10/2026"), which is
 * a date, not a record. The customer has had a full repair history page from the
 * beginning; the person who did the work had nothing to look back at, no warranty
 * they could quote, and no way to read what a customer said about them beyond an
 * average on their profile.
 *
 * WHERE THE DATA COMES FROM. `service_history` is the archive `confirm_payment()`
 * writes when a repair completes, and it already carries `technician_id`, the final
 * cost and the warranty (step 19), so the row-level policy "relevant users view
 * service history" already lets a technician read their own rows. No new policy and
 * no migration: this page reads what the technician was always entitled to.
 *
 * WHAT IS DELIBERATELY ABSENT: the customer's name, address and contact details. A
 * technician may not read a customer's `users` row — the select policy is
 * `id = auth.uid() or is_admin()` — so joining for a name would return nothing and
 * render a blank where a name belongs: a silent failure. Publishing the customer to
 * the technician is a policy change, not a query, and this page does not make one.
 * The booking page stays the place to reach them, through the thread.
 *
 * Read-only by construction: a finished repair has nothing to approve, schedule or
 * update, so there is not a single control on this page.
 */
export default async function PastJobsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: history } = await supabase
    .from("service_history")
    .select("*")
    .eq("technician_id", user!.id)
    .order("completed_at", { ascending: false });

  const bookingIds = (history ?? []).map((entry) => entry.booking_id);

  const { data: historyBookings } = bookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, service_request_id, estimate_id, scheduled_at")
        .in("id", bookingIds)
    : { data: [] };

  const requestIds = [
    ...new Set((historyBookings ?? []).map((booking) => booking.service_request_id)),
  ];

  const { data: requests } = requestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, problem_description, issue_category")
        .in("id", requestIds)
    : { data: [] };

  // The price the repair was agreed at. `service_history.final_cost` is what was
  // actually charged; the approved estimate is the fallback, so a record is never
  // shown with no figure at all and never with an invented one.
  const { data: estimates } = requestIds.length
    ? await supabase.from("estimates").select("*").in("service_request_id", requestIds)
    : { data: [] };

  const { data: ratings } = bookingIds.length
    ? await supabase.from("ratings").select("booking_id, rating, comment").in("booking_id", bookingIds)
    : { data: [] };

  // Cancelled appointments. They are NOT in `service_history` (nothing was
  // completed), so without this section a cancelled job would vanish from the
  // technician's view the moment it was cancelled.
  const { data: cancelled } = await supabase
    .from("bookings")
    .select("id, service_request_id, scheduled_at")
    .eq("technician_id", user!.id)
    .eq("status", "cancelled")
    .order("scheduled_at", { ascending: false });

  const cancelledRequestIds = [
    ...new Set((cancelled ?? []).map((booking) => booking.service_request_id)),
  ];
  const { data: cancelledRequests } = cancelledRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, problem_description")
        .in("id", cancelledRequestIds)
    : { data: [] };

  const bookingById = new Map((historyBookings ?? []).map((booking) => [booking.id, booking]));
  const requestById = new Map((requests ?? []).map((request) => [request.id, request]));
  const cancelledRequestById = new Map(
    (cancelledRequests ?? []).map((request) => [request.id, request])
  );
  const ratingByBooking = new Map((ratings ?? []).map((rating) => [rating.booking_id, rating]));

  /** The approved estimate a finished repair was agreed at, or null. */
  function approvedEstimateFor(bookingId: string): EstimateRow | null {
    const booking = bookingById.get(bookingId);
    if (!booking) return null;

    const mine = (estimates ?? []).filter(
      (estimate) => estimate.service_request_id === booking.service_request_id
    );

    return (
      mine.find((estimate) => estimate.id === booking.estimate_id) ??
      mine.find((estimate) => isBookableEstimate(estimate)) ??
      null
    );
  }

  const totalJobs = history?.length ?? 0;
  const totalEarned = (history ?? []).reduce((sum, entry) => sum + (entry.final_cost ?? 0), 0);
  const rated = (ratings ?? []).filter((rating) => Number.isFinite(rating.rating));
  const averageRating = rated.length
    ? Math.round((rated.reduce((sum, rating) => sum + rating.rating, 0) / rated.length) * 10) / 10
    : null;
  const covered = (history ?? []).filter(
    (entry) => entry.warranty_until && new Date(entry.warranty_until) >= new Date()
  ).length;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Past jobs</h1>
      <p className="mt-1 text-sm text-ink/70">
        Every repair you have completed through SPARKServ, with the warranty each one carries.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          icon={<Wrench className="h-4 w-4" />}
          label="Repairs completed"
          value={String(totalJobs)}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total charged"
          value={formatMoney(totalEarned)}
        />
        <SummaryCard
          icon={<Star className="h-4 w-4" />}
          label="Average rating"
          value={averageRating === null ? "No ratings yet" : averageRating.toFixed(1)}
        />
        <SummaryCard
          icon={<ShieldCheck className="h-4 w-4" />}
          label="Still under warranty"
          value={String(covered)}
        />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Completed repairs</h2>

        {!history?.length ? (
          <p className="text-sm text-ink/70">
            No completed repairs yet. A finished job is archived here the moment its payment is
            verified.
          </p>
        ) : (
          <div className="space-y-3">
            {history.map((entry) => {
              const booking = bookingById.get(entry.booking_id);
              const request = booking ? requestById.get(booking.service_request_id) : undefined;
              const estimate = approvedEstimateFor(entry.booking_id);
              const rating = ratingByBooking.get(entry.booking_id);
              const amount = entry.final_cost ?? estimate?.estimated_cost ?? null;
              const warrantyEnded =
                Boolean(entry.warranty_until) && new Date(entry.warranty_until!) < new Date();

              return (
                <div
                  key={entry.id}
                  className="rounded-card border border-line bg-surface p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium capitalize text-ink">
                        {entry.appliance_type.replace(/_/g, " ")}
                      </p>
                      {request?.problem_description && (
                        <p className="mt-0.5 text-sm text-ink/70">{request.problem_description}</p>
                      )}
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-ink">
                      {amount === null ? "No amount recorded" : formatMoney(amount)}
                    </p>
                  </div>

                  <p className="mt-2 text-xs text-ink/70">
                    Completed {new Date(entry.completed_at).toLocaleDateString()}
                  </p>

                  {entry.summary && (
                    <p className="mt-2 rounded-xl bg-soft/50 px-3 py-2 text-xs leading-relaxed text-ink/80">
                      {entry.summary}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* The warranty this repair carries. Printed only when the archive
                        actually holds a date, never promised from the platform default. */}
                    {entry.warranty_until ? (
                      <p
                        className={`flex items-center gap-1.5 text-xs font-medium ${
                          warrantyEnded ? "text-muted" : "text-signal-ink"
                        }`}
                      >
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {warrantyEnded
                          ? `Warranty ended ${new Date(entry.warranty_until).toLocaleDateString()}`
                          : `${entry.warranty_days}-day warranty · valid until ${new Date(
                              entry.warranty_until
                            ).toLocaleDateString()}`}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">No warranty recorded for this repair</p>
                    )}

                    {rating ? (
                      <span className="flex items-center gap-1.5 text-xs text-ink/70">
                        <span className="flex items-center gap-0.5" aria-hidden="true">
                          {[1, 2, 3, 4, 5].map((step) => (
                            <Star
                              key={step}
                              className={`h-3.5 w-3.5 ${
                                step <= rating.rating ? "fill-warn-ink text-warn-ink" : "text-line"
                              }`}
                            />
                          ))}
                        </span>
                        {rating.rating}/5
                        {rating.comment ? ` · “${rating.comment}”` : ""}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Not rated yet</span>
                    )}
                  </div>

                  <Link
                    href={`/technician/bookings/${entry.booking_id}`}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
                  >
                    Open this job
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {cancelled?.length ? (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            Cancelled appointments
          </h2>
          <p className="mb-3 text-xs text-ink/70">
            These were never completed, so they are not in the archive above. A cancellation does
            not consume your queue turn.
          </p>
          <div className="space-y-2">
            {cancelled.map((booking) => {
              const request = cancelledRequestById.get(booking.service_request_id);
              return (
                <div
                  key={booking.id}
                  className="flex items-center justify-between rounded-card border border-line bg-surface p-3 shadow-card"
                >
                  <div className="min-w-0">
                    <p className="font-medium capitalize text-ink">
                      {request?.appliance_type.replace(/_/g, " ") ?? "Job"}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/70">
                      Was scheduled {new Date(booking.scheduled_at).toLocaleDateString()}
                    </p>
                  </div>
                  <CalendarX2 className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-line bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/70">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}


